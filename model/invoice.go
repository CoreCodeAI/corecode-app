package model

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Where an invoice application stands.
const (
	InvoiceStatusPendingPayment = "pending_payment"
	InvoiceStatusPendingReview  = "pending_review"
	InvoiceStatusIssued         = "issued"
	InvoiceStatusRejected       = "rejected"
	InvoiceStatusCancelled      = "cancelled"
)

var InvoiceStatuses = []string{
	InvoiceStatusPendingPayment,
	InvoiceStatusPendingReview,
	InvoiceStatusIssued,
	InvoiceStatusRejected,
	InvoiceStatusCancelled,
}

const (
	// InvoiceTypeNormal is a general VAT invoice, the only type offered.
	InvoiceTypeNormal = "normal"

	InvoiceTitleCompany  = "company"
	InvoiceTitlePersonal = "personal"

	InvoiceOrderTopUp        = "topup"
	InvoiceOrderSubscription = "subscription"

	// How the tax surcharge is paid: from the wallet, or through epay.
	InvoiceTaxBalance = "balance"
	InvoiceTaxAlipay  = "alipay"
	InvoiceTaxWxpay   = "wxpay"
)

// invoiceableProviders are the gateways whose orders brought money in.
// A plan bought with balance spent a top-up that is invoiced on its own, and
// a redemption code carries no payment, so neither is listed.
var invoiceableProviders = []string{
	PaymentProviderEpay,
	PaymentProviderStripe,
	PaymentProviderNowPayments,
}

// The errors reach the console, so they carry message keys.
var (
	ErrInvoiceDisabled         error = common.NewMessage("Invoicing is not available")
	ErrInvoiceOrderUnavailable error = common.NewMessage("Some selected orders cannot be invoiced. Refresh the order list and try again.")
	ErrInvoiceStatusChanged    error = common.NewMessage("The application status has changed. Refresh and try again.")
	ErrInvoiceNotFound         error = common.NewMessage("Invoice application not found")
	ErrInvoiceFileMissing      error = common.NewMessage("Upload the invoice file before confirming it is issued")
	ErrInvoiceTaxQuotaInvalid  error = common.NewMessage("The tax cannot be converted to balance. Check the top-up price setting.")
)

// ErrInvoiceTradeNoUnknown is returned for a tax payment whose trade number
// names no application.
var ErrInvoiceTradeNoUnknown = errors.New("invoice tax trade number names no application")

// Invoice is a customer's application to have paid orders invoiced. Amounts
// are in fen (CNY cents); the invoice amount is the order amount, and the tax
// is a surcharge on it.
type Invoice struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"index;not null"`
	Status      string `json:"status" gorm:"type:varchar(20);not null;index"`
	InvoiceType string `json:"invoice_type" gorm:"type:varchar(16);not null"`
	TitleType   string `json:"title_type" gorm:"type:varchar(16);not null"`
	Title       string `json:"title" gorm:"type:varchar(100);not null"`
	TaxNo       string `json:"tax_no" gorm:"type:varchar(30)"`
	Category    string `json:"category" gorm:"type:varchar(100);not null"`
	Email       string `json:"email" gorm:"type:varchar(100);not null"`
	OrderCents  int64  `json:"order_cents" gorm:"not null"`
	// TaxRate is the percent charged when the application was submitted.
	TaxRate  float64 `json:"tax_rate" gorm:"not null"`
	TaxCents int64   `json:"tax_cents" gorm:"not null"`
	// TaxMethod is how the tax was paid, or was last asked for while it is
	// unpaid; empty when there is no tax.
	TaxMethod string `json:"tax_method" gorm:"type:varchar(16)"`
	// TaxTradeNo is the epay trade number that paid the tax, or the latest
	// one started while it is unpaid.
	TaxTradeNo string `json:"tax_trade_no" gorm:"type:varchar(64);index"`
	// TaxQuota is the balance deducted when the tax was paid from the wallet.
	TaxQuota     int64  `json:"tax_quota" gorm:"not null;default:0"`
	TaxPaidTime  int64  `json:"tax_paid_time" gorm:"bigint;not null;default:0"`
	RejectReason string `json:"reject_reason" gorm:"type:varchar(500)"`
	ReviewedBy   int    `json:"reviewed_by" gorm:"not null;default:0"`
	IssuedTime   int64  `json:"issued_time" gorm:"bigint;not null;default:0"`
	// The uploaded invoice file; its bytes live in invoice_files.
	FileName     string         `json:"file_name" gorm:"type:varchar(255)"`
	FileMime     string         `json:"file_mime" gorm:"type:varchar(100)"`
	FileSize     int            `json:"file_size" gorm:"not null;default:0"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint;index"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeleteReason string         `json:"-" gorm:"type:varchar(500)"`
	DeletedBy    int            `json:"-" gorm:"not null;default:0"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index"`
}

// InvoiceItem is one order in an application.
type InvoiceItem struct {
	Id          int    `json:"id"`
	InvoiceId   int    `json:"invoice_id" gorm:"index;not null"`
	UserId      int    `json:"-" gorm:"index;not null"`
	OrderType   string `json:"order_type" gorm:"type:varchar(16);not null"`
	OrderId     int    `json:"order_id" gorm:"not null"`
	TradeNo     string `json:"trade_no" gorm:"type:varchar(255)"`
	AmountCents int64  `json:"amount_cents" gorm:"not null"`
	PaidTime    int64  `json:"paid_time" gorm:"bigint"`
	// ClaimKey is "order_type:order_id" while the application holds the
	// order, and NULL once it is cancelled, rejected or deleted. Its unique
	// index keeps an order in one live application at a time, whichever
	// server takes the request.
	ClaimKey *string `json:"-" gorm:"type:varchar(64);uniqueIndex"`
}

// InvoiceFile holds the bytes of an issued invoice. Invoices are small PDFs
// or images, and the database is the one store both release colors share.
type InvoiceFile struct {
	InvoiceId   int    `gorm:"primaryKey;autoIncrement:false"`
	Data        []byte `gorm:"not null"`
	CreatedTime int64  `gorm:"bigint"`
}

// InvoiceTaxPayment records each epay tax payment once, by trade number, so
// a repeated notification changes nothing. Applied is false when the payment
// arrived after its application stopped needing it; CreditedQuota is then
// what went to the customer's balance instead.
type InvoiceTaxPayment struct {
	Id            int    `json:"id"`
	TradeNo       string `json:"trade_no" gorm:"type:varchar(64);uniqueIndex;not null"`
	InvoiceId     int    `json:"invoice_id" gorm:"index;not null"`
	UserId        int    `json:"user_id" gorm:"index;not null"`
	Method        string `json:"method" gorm:"type:varchar(16)"`
	AmountCents   int64  `json:"amount_cents" gorm:"not null"`
	Applied       bool   `json:"applied"`
	CreditedQuota int64  `json:"credited_quota" gorm:"not null;default:0"`
	CreatedTime   int64  `json:"created_time" gorm:"bigint"`
}

// InvoiceOrderAmount overrides the invoiceable amount of one paid order,
// keyed by its claim key, when the gateway collected something other than
// the order's CNY price: a Stripe promotion code took a share off, or a plan
// was charged at a Stripe Price in that Price's own currency (amount 0, not
// invoiceable). Stripe's webhook writes it before the order is marked paid.
type InvoiceOrderAmount struct {
	ClaimKey    string `gorm:"primaryKey;type:varchar(64)"`
	AmountCents int64  `gorm:"not null"`
	Reason      string `gorm:"type:varchar(32)"`
	CreatedTime int64  `gorm:"bigint"`
}

// InvoiceableOrder is a paid order a customer may put in an application.
type InvoiceableOrder struct {
	OrderType     string `json:"order_type"`
	OrderId       int    `json:"order_id"`
	TradeNo       string `json:"trade_no"`
	AmountCents   int64  `json:"amount_cents"`
	PaidTime      int64  `json:"paid_time"`
	PaymentMethod string `json:"payment_method"`
}

// InvoiceOrderRef names an order in a request.
type InvoiceOrderRef struct {
	OrderType string `json:"order_type"`
	OrderId   int    `json:"order_id"`
}

// InvoiceApplication is what a customer submits. The controller has checked
// and normalized every field.
type InvoiceApplication struct {
	TitleType string
	Title     string
	TaxNo     string
	Category  string
	Email     string
	Orders    []InvoiceOrderRef
	// TaxMethod is balance, alipay or wxpay. Balance pays the tax inside the
	// submission; an epay method leaves the application awaiting payment.
	TaxMethod string
}

// InvoiceTaxResult reports the balance a tax operation moved, for the log
// written after commit.
type InvoiceTaxResult struct {
	Invoice *Invoice
	// Quota is what was deducted (paid from balance) or credited (a refund
	// or a payment that came too late).
	Quota int64
}

func invoiceClaimKey(orderType string, orderId int) string {
	return orderType + ":" + strconv.Itoa(orderId)
}

// InvoiceTaxCents is the surcharge on orderCents at rate percent, rounded to
// the fen.
func InvoiceTaxCents(orderCents int64, rate float64) int64 {
	return decimal.NewFromInt(orderCents).
		Mul(decimal.NewFromFloat(rate)).
		Div(decimal.NewFromInt(100)).
		Round(0).
		IntPart()
}

// InvoiceQuotaForCents converts an amount in fen to wallet quota at the
// top-up price (CNY per display unit), rounding up when ceil is set.
func InvoiceQuotaForCents(cents int64, ceil bool) (int64, error) {
	if cents <= 0 {
		return 0, nil
	}
	if operation_setting.Price <= 0 || common.QuotaPerUnit <= 0 {
		return 0, ErrInvoiceTaxQuotaInvalid
	}
	quota := decimal.NewFromInt(cents).
		Div(decimal.NewFromInt(100)).
		Div(decimal.NewFromFloat(operation_setting.Price)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	if ceil {
		quota = quota.Ceil()
	} else {
		quota = quota.Round(0)
	}
	value, err := common.WalletQuotaFromDecimalStrict(quota)
	if err != nil {
		return 0, ErrInvoiceTaxQuotaInvalid
	}
	return int64(value), nil
}

// FormatInvoiceCents renders fen as yuan with two decimals.
func FormatInvoiceCents(cents int64) string {
	return decimal.NewFromInt(cents).Div(decimal.NewFromInt(100)).StringFixed(2)
}

// moneyToCents converts an order's price to fen the way the payment
// requests format it, strconv.FormatFloat(money, 'f', 2, 64), so an amount
// ending in half a fen is invoiced at what was charged.
func moneyToCents(money float64) int64 {
	cents, err := decimal.NewFromString(strconv.FormatFloat(money, 'f', 2, 64))
	if err != nil {
		return 0
	}
	return cents.Mul(decimal.NewFromInt(100)).IntPart()
}

func invoiceOrderCutoff() int64 {
	return common.GetTimestamp() - int64(operation_setting.GetInvoiceSetting().OrderDays)*24*60*60
}

// paidInvoiceOrders returns userId's paid orders since cutoff, newest first,
// whether or not an application holds them.
func paidInvoiceOrders(tx *gorm.DB, userId int, cutoff int64) ([]InvoiceableOrder, error) {
	var topUps []TopUp
	err := tx.Where("user_id = ? AND status = ? AND payment_provider IN ? AND create_time >= ?",
		userId, common.TopUpStatusSuccess, invoiceableProviders, cutoff).
		Find(&topUps).Error
	if err != nil {
		return nil, err
	}
	// A plan with a Stripe Price is charged at that Price, in its currency,
	// not at the order's CNY price; such orders stay out unless an override
	// says otherwise.
	var plans []SubscriptionOrder
	err = tx.Where("user_id = ? AND status = ? AND payment_provider IN ? AND create_time >= ?",
		userId, common.TopUpStatusSuccess, invoiceableProviders, cutoff).
		Where("NOT (payment_provider = ? AND plan_id IN (?))", PaymentProviderStripe,
			tx.Model(&SubscriptionPlan{}).Select("id").Where("stripe_price_id <> ''")).
		Find(&plans).Error
	if err != nil {
		return nil, err
	}
	orders := make([]InvoiceableOrder, 0, len(topUps)+len(plans))
	for _, topUp := range topUps {
		orders = append(orders, InvoiceableOrder{
			OrderType:     InvoiceOrderTopUp,
			OrderId:       topUp.Id,
			TradeNo:       topUp.TradeNo,
			AmountCents:   moneyToCents(topUp.Money),
			PaidTime:      max(topUp.CompleteTime, topUp.CreateTime),
			PaymentMethod: topUp.PaymentMethod,
		})
	}
	for _, plan := range plans {
		orders = append(orders, InvoiceableOrder{
			OrderType:     InvoiceOrderSubscription,
			OrderId:       plan.Id,
			TradeNo:       plan.TradeNo,
			AmountCents:   moneyToCents(plan.Money),
			PaidTime:      max(plan.CompleteTime, plan.CreateTime),
			PaymentMethod: plan.PaymentMethod,
		})
	}
	if err := applyInvoiceOrderAmounts(tx, orders); err != nil {
		return nil, err
	}
	orders = slices.DeleteFunc(orders, func(order InvoiceableOrder) bool { return order.AmountCents <= 0 })
	slices.SortFunc(orders, func(a, b InvoiceableOrder) int {
		if a.PaidTime != b.PaidTime {
			return int(b.PaidTime - a.PaidTime)
		}
		return strings.Compare(b.TradeNo, a.TradeNo)
	})
	return orders, nil
}

func applyInvoiceOrderAmounts(tx *gorm.DB, orders []InvoiceableOrder) error {
	if len(orders) == 0 {
		return nil
	}
	keys := make([]string, len(orders))
	for i, order := range orders {
		keys[i] = invoiceClaimKey(order.OrderType, order.OrderId)
	}
	var overrides []InvoiceOrderAmount
	if err := tx.Where("claim_key IN ?", keys).Find(&overrides).Error; err != nil {
		return err
	}
	amounts := make(map[string]int64, len(overrides))
	for _, override := range overrides {
		amounts[override.ClaimKey] = override.AmountCents
	}
	for i := range orders {
		if amount, ok := amounts[keys[i]]; ok {
			orders[i].AmountCents = amount
		}
	}
	return nil
}

// RecordStripeInvoiceAmount notes what Stripe really collected for the order
// with tradeNo, before the order is marked paid. A subscription-mode session
// charged a Stripe Price, so the order is not invoiceable; a session whose
// total is below its subtotal had a promotion code, so the invoiceable amount
// is the order's price scaled by total/subtotal. Anything else needs no
// record. Repeated events change nothing.
func RecordStripeInvoiceAmount(tradeNo string, mode string, subtotal int64, total int64) error {
	if tradeNo == "" {
		return nil
	}
	reason := ""
	switch {
	case mode == "subscription":
		reason = "stripe_price"
	case subtotal > 0 && total >= 0 && total < subtotal:
		reason = "discount"
	default:
		return nil
	}
	var key string
	var money float64
	var topUp TopUp
	var plan SubscriptionOrder
	if err := DB.Where("trade_no = ? AND payment_provider = ?", tradeNo, PaymentProviderStripe).Limit(1).Find(&topUp).Error; err != nil {
		return err
	}
	if topUp.Id != 0 {
		key, money = invoiceClaimKey(InvoiceOrderTopUp, topUp.Id), topUp.Money
	} else {
		if err := DB.Where("trade_no = ? AND payment_provider = ?", tradeNo, PaymentProviderStripe).Limit(1).Find(&plan).Error; err != nil {
			return err
		}
		if plan.Id == 0 {
			return nil
		}
		key, money = invoiceClaimKey(InvoiceOrderSubscription, plan.Id), plan.Money
	}
	amount := int64(0)
	if reason == "discount" {
		amount = decimal.NewFromInt(moneyToCents(money)).Mul(decimal.NewFromInt(total)).
			Div(decimal.NewFromInt(subtotal)).Floor().IntPart()
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&InvoiceOrderAmount{
		ClaimKey: key, AmountCents: amount, Reason: reason, CreatedTime: common.GetTimestamp(),
	}).Error
}

func claimedInvoiceKeys(tx *gorm.DB, userId int) (map[string]bool, error) {
	var keys []string
	err := tx.Model(&InvoiceItem{}).
		Where("user_id = ? AND claim_key IS NOT NULL", userId).
		Pluck("claim_key", &keys).Error
	if err != nil {
		return nil, err
	}
	claimed := make(map[string]bool, len(keys))
	for _, key := range keys {
		claimed[key] = true
	}
	return claimed, nil
}

// ListInvoiceableOrders returns userId's paid orders within the invoicing
// window that no live application holds, newest first.
func ListInvoiceableOrders(userId int) ([]InvoiceableOrder, error) {
	orders, err := paidInvoiceOrders(DB, userId, invoiceOrderCutoff())
	if err != nil {
		return nil, err
	}
	claimed, err := claimedInvoiceKeys(DB, userId)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(orders, func(order InvoiceableOrder) bool {
		return claimed[invoiceClaimKey(order.OrderType, order.OrderId)]
	}), nil
}

// CreateInvoice files an application for userId over the orders it names, in
// one transaction: the orders are claimed, and a balance-paid tax is deducted.
// It returns ErrInvoiceOrderUnavailable when an order is not userId's, not
// paid through an invoiceable gateway, outside the window, or already held.
func CreateInvoice(userId int, application InvoiceApplication) (*InvoiceTaxResult, error) {
	setting := operation_setting.GetInvoiceSetting()
	if !setting.Enabled {
		return nil, ErrInvoiceDisabled
	}
	result := &InvoiceTaxResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		paid, err := paidInvoiceOrders(tx, userId, invoiceOrderCutoff())
		if err != nil {
			return err
		}
		byKey := make(map[string]InvoiceableOrder, len(paid))
		for _, order := range paid {
			byKey[invoiceClaimKey(order.OrderType, order.OrderId)] = order
		}
		claimed, err := claimedInvoiceKeys(tx, userId)
		if err != nil {
			return err
		}
		items := make([]InvoiceItem, 0, len(application.Orders))
		seen := make(map[string]bool, len(application.Orders))
		var orderCents int64
		for _, ref := range application.Orders {
			key := invoiceClaimKey(ref.OrderType, ref.OrderId)
			order, ok := byKey[key]
			if !ok || seen[key] || claimed[key] {
				return ErrInvoiceOrderUnavailable
			}
			seen[key] = true
			orderCents += order.AmountCents
			items = append(items, InvoiceItem{
				UserId:      userId,
				OrderType:   order.OrderType,
				OrderId:     order.OrderId,
				TradeNo:     order.TradeNo,
				AmountCents: order.AmountCents,
				PaidTime:    order.PaidTime,
				ClaimKey:    &key,
			})
		}
		if len(items) == 0 {
			return ErrInvoiceOrderUnavailable
		}

		now := common.GetTimestamp()
		invoice := &Invoice{
			UserId:      userId,
			Status:      InvoiceStatusPendingPayment,
			InvoiceType: InvoiceTypeNormal,
			TitleType:   application.TitleType,
			Title:       application.Title,
			TaxNo:       application.TaxNo,
			Category:    application.Category,
			Email:       application.Email,
			OrderCents:  orderCents,
			TaxRate:     setting.TaxRate,
			TaxCents:    InvoiceTaxCents(orderCents, setting.TaxRate),
			TaxMethod:   application.TaxMethod,
			CreatedTime: now,
			UpdatedTime: now,
		}
		if invoice.TaxCents == 0 {
			invoice.Status = InvoiceStatusPendingReview
			invoice.TaxMethod = ""
		}
		if err := tx.Create(invoice).Error; err != nil {
			return err
		}
		for i := range items {
			items[i].InvoiceId = invoice.Id
		}
		// The keys were free a moment ago; a failure here is another request
		// claiming one of them first.
		if err := tx.Create(&items).Error; err != nil {
			common.SysLog(common.LogText("invoice order claim failed user_id=%d error=%q", userId, err.Error()))
			return ErrInvoiceOrderUnavailable
		}
		result.Invoice = invoice
		if invoice.TaxCents > 0 && application.TaxMethod == InvoiceTaxBalance {
			quota, err := payInvoiceTaxFromBalance(tx, invoice)
			if err != nil {
				return err
			}
			result.Quota = quota
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	afterInvoiceTaxFromBalance(result)
	return result, nil
}

// payInvoiceTaxFromBalance deducts invoice's tax from its owner's wallet and
// sends the application to review. The caller holds the invoice row.
func payInvoiceTaxFromBalance(tx *gorm.DB, invoice *Invoice) (int64, error) {
	quota, err := InvoiceQuotaForCents(invoice.TaxCents, true)
	if err != nil {
		return 0, err
	}
	var user User
	if err := lockForUpdate(tx).Select("id", "quota").Where("id = ?", invoice.UserId).First(&user).Error; err != nil {
		return 0, err
	}
	if int64(user.Quota) < quota {
		return 0, common.NewMessage("Insufficient balance")
	}
	if err := tx.Model(&User{}).Where("id = ?", invoice.UserId).
		Update("quota", gorm.Expr("quota - ?", quota)).Error; err != nil {
		return 0, err
	}
	now := common.GetTimestamp()
	invoice.Status = InvoiceStatusPendingReview
	invoice.TaxMethod = InvoiceTaxBalance
	invoice.TaxTradeNo = ""
	invoice.TaxQuota = quota
	invoice.TaxPaidTime = now
	invoice.UpdatedTime = now
	if err := tx.Model(invoice).Updates(map[string]any{
		"status":        invoice.Status,
		"tax_method":    invoice.TaxMethod,
		"tax_trade_no":  invoice.TaxTradeNo,
		"tax_quota":     invoice.TaxQuota,
		"tax_paid_time": invoice.TaxPaidTime,
		"updated_time":  invoice.UpdatedTime,
	}).Error; err != nil {
		return 0, err
	}
	return quota, nil
}

func afterInvoiceTaxFromBalance(result *InvoiceTaxResult) {
	if result.Quota <= 0 {
		return
	}
	invoice := result.Invoice
	if err := cacheDecrUserQuota(invoice.UserId, result.Quota); err != nil {
		common.SysLog(common.LogText("failed to decrease user quota cache after invoice tax: %s", err.Error()))
	}
	RecordLog(invoice.UserId, LogTypeSystem, common.NewMessage("Paid the tax of ¥{{amount}} for invoice application {{id}} from your balance: {{quota}}", map[string]any{
		"amount": FormatInvoiceCents(invoice.TaxCents),
		"id":     invoice.Id,
		"quota":  formatInvoiceQuota(result.Quota),
	}))
}

// lockUserInvoice locks userId's application id inside tx; userId 0 locks any
// account's.
func lockUserInvoice(tx *gorm.DB, userId int, id int) (*Invoice, error) {
	query := lockForUpdate(tx).Where("id = ?", id)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var invoice Invoice
	if err := query.First(&invoice).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrInvoiceNotFound
		}
		return nil, err
	}
	return &invoice, nil
}

// PayInvoiceTaxFromBalance pays an application's outstanding tax from its
// owner's wallet.
func PayInvoiceTaxFromBalance(userId int, id int) (*InvoiceTaxResult, error) {
	result := &InvoiceTaxResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice, err := lockUserInvoice(tx, userId, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingPayment {
			return ErrInvoiceStatusChanged
		}
		quota, err := payInvoiceTaxFromBalance(tx, invoice)
		if err != nil {
			return err
		}
		result.Invoice = invoice
		result.Quota = quota
		return nil
	})
	if err != nil {
		return nil, err
	}
	afterInvoiceTaxFromBalance(result)
	return result, nil
}

// StartInvoiceTaxEpay gives an unpaid application a fresh epay trade number
// for method and returns the application. Each attempt gets its own number,
// which carries the application id, so a payment on an earlier attempt is
// still recognized.
func StartInvoiceTaxEpay(userId int, id int, method string) (*Invoice, error) {
	var invoice *Invoice
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		invoice, err = lockUserInvoice(tx, userId, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingPayment {
			return ErrInvoiceStatusChanged
		}
		invoice.TaxMethod = method
		invoice.TaxTradeNo = fmt.Sprintf("INV%dN%s%d", invoice.Id, common.GetRandomString(6), time.Now().Unix())
		invoice.UpdatedTime = common.GetTimestamp()
		return tx.Model(invoice).Updates(map[string]any{
			"tax_method":   invoice.TaxMethod,
			"tax_trade_no": invoice.TaxTradeNo,
			"updated_time": invoice.UpdatedTime,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return invoice, nil
}

// InvoiceIdFromTradeNo reads the application id out of a tax trade number.
func InvoiceIdFromTradeNo(tradeNo string) (int, bool) {
	rest, ok := strings.CutPrefix(tradeNo, "INV")
	if !ok {
		return 0, false
	}
	idText, _, ok := strings.Cut(rest, "N")
	if !ok {
		return 0, false
	}
	id, err := strconv.Atoi(idText)
	return id, err == nil && id > 0
}

// CompleteInvoiceTaxEpay records an epay tax payment of paidCents. A payment
// for an application still awaiting exactly that tax sends it to review. Any
// other payment, for an application cancelled meanwhile, already paid, or of
// a different amount, is credited to the owner's balance. A trade number is
// handled once; alreadyDone reports a repeat.
func CompleteInvoiceTaxEpay(tradeNo string, method string, paidCents int64) (result *InvoiceTaxResult, alreadyDone bool, err error) {
	id, ok := InvoiceIdFromTradeNo(tradeNo)
	if !ok {
		return nil, false, ErrInvoiceTradeNoUnknown
	}
	result = &InvoiceTaxResult{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var invoice Invoice
		if err := lockForUpdate(tx.Unscoped()).Where("id = ?", id).First(&invoice).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvoiceTradeNoUnknown
			}
			return err
		}
		var recorded int64
		if err := tx.Model(&InvoiceTaxPayment{}).Where("trade_no = ?", tradeNo).Count(&recorded).Error; err != nil {
			return err
		}
		if recorded > 0 {
			alreadyDone = true
			return nil
		}
		now := common.GetTimestamp()
		payment := &InvoiceTaxPayment{
			TradeNo:     tradeNo,
			InvoiceId:   invoice.Id,
			UserId:      invoice.UserId,
			Method:      method,
			AmountCents: paidCents,
			CreatedTime: now,
		}
		if invoice.Status == InvoiceStatusPendingPayment && !invoice.DeletedAt.Valid && paidCents == invoice.TaxCents {
			payment.Applied = true
			invoice.Status = InvoiceStatusPendingReview
			invoice.TaxMethod = method
			invoice.TaxTradeNo = tradeNo
			invoice.TaxPaidTime = now
			invoice.UpdatedTime = now
			if err := tx.Model(&invoice).Updates(map[string]any{
				"status":        invoice.Status,
				"tax_method":    invoice.TaxMethod,
				"tax_trade_no":  invoice.TaxTradeNo,
				"tax_paid_time": invoice.TaxPaidTime,
				"updated_time":  invoice.UpdatedTime,
			}).Error; err != nil {
				return err
			}
		} else {
			quota, err := InvoiceQuotaForCents(paidCents, false)
			if err != nil {
				return err
			}
			if err := tx.Model(&User{}).Where("id = ?", invoice.UserId).
				Update("quota", gorm.Expr("quota + ?", quota)).Error; err != nil {
				return err
			}
			payment.CreditedQuota = quota
			result.Quota = quota
		}
		if err := tx.Create(payment).Error; err != nil {
			return err
		}
		result.Invoice = &invoice
		return nil
	})
	if err != nil || alreadyDone {
		return nil, alreadyDone, err
	}
	if result.Quota > 0 {
		syncCreditUserQuotaCache(result.Invoice.UserId, int(result.Quota), common.LogText("invoice tax credit"))
		RecordLog(result.Invoice.UserId, LogTypeSystem, common.NewMessage("A tax payment of ¥{{amount}} for invoice application {{id}} arrived after the application no longer needed it, so {{quota}} was returned to your balance", map[string]any{
			"amount": FormatInvoiceCents(paidCents),
			"id":     result.Invoice.Id,
			"quota":  formatInvoiceQuota(result.Quota),
		}))
	}
	return result, false, nil
}

func releaseInvoiceClaims(tx *gorm.DB, invoiceId int) error {
	return tx.Model(&InvoiceItem{}).
		Where("invoice_id = ? AND claim_key IS NOT NULL", invoiceId).
		Update("claim_key", nil).Error
}

// CancelInvoice withdraws userId's application while its tax is unpaid and
// releases its orders.
func CancelInvoice(userId int, id int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		invoice, err := lockUserInvoice(tx, userId, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingPayment {
			return ErrInvoiceStatusChanged
		}
		if err := tx.Model(invoice).Updates(map[string]any{
			"status":       InvoiceStatusCancelled,
			"updated_time": common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		return releaseInvoiceClaims(tx, invoice.Id)
	})
}

// ExpireUnpaidInvoices cancels up to limit applications whose tax has been
// unpaid for timeoutMinutes since submission or since the latest payment was
// started (both set updated_time, which nothing else changes while the tax is
// unpaid), releasing their orders, and returns how many it cancelled. Each cancellation is a conditional update, so two servers
// running it at once cancel an application once.
func ExpireUnpaidInvoices(timeoutMinutes int, limit int) (int, error) {
	deadline := common.GetTimestamp() - int64(timeoutMinutes)*60
	var ids []int
	if err := DB.Model(&Invoice{}).
		Where("status = ? AND updated_time < ?", InvoiceStatusPendingPayment, deadline).
		Order("id").Limit(limit).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	cancelled := 0
	for _, id := range ids {
		expired := false
		err := DB.Transaction(func(tx *gorm.DB) error {
			result := tx.Model(&Invoice{}).
				Where("id = ? AND status = ? AND updated_time < ?", id, InvoiceStatusPendingPayment, deadline).
				Updates(map[string]any{"status": InvoiceStatusCancelled, "updated_time": common.GetTimestamp()})
			if result.Error != nil || result.RowsAffected == 0 {
				return result.Error
			}
			expired = true
			return releaseInvoiceClaims(tx, id)
		})
		if err != nil {
			return cancelled, err
		}
		if expired {
			cancelled++
		}
	}
	return cancelled, nil
}

// InvoiceFilter narrows a list. UserId 0 lists every account's applications.
// Keyword matches an application or account id, a trade number, or part of a
// title or tax number.
type InvoiceFilter struct {
	UserId  int
	Status  string
	Keyword string
}

func ListInvoices(filter InvoiceFilter, pageInfo *common.PageInfo) ([]*Invoice, int64, error) {
	query := DB.Model(&Invoice{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if slices.Contains(InvoiceStatuses, filter.Status) {
		query = query.Where("status = ?", filter.Status)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		if number, err := strconv.Atoi(keyword); err == nil {
			query = query.Where("id = ? OR user_id = ? OR title LIKE ? OR tax_no LIKE ? OR tax_trade_no = ?", number, number, like, like, keyword)
		} else {
			query = query.Where("title LIKE ? OR tax_no LIKE ? OR tax_trade_no = ?", like, like, keyword)
		}
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	invoices := make([]*Invoice, 0)
	err := query.Order("id DESC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&invoices).Error
	return invoices, total, err
}

// GetInvoiceWithItems returns application id and its orders; userId 0 reads
// any account's.
func GetInvoiceWithItems(userId int, id int) (*Invoice, []InvoiceItem, error) {
	query := DB.Where("id = ?", id)
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var invoice Invoice
	if err := query.First(&invoice).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrInvoiceNotFound
		}
		return nil, nil, err
	}
	items := make([]InvoiceItem, 0)
	if err := DB.Where("invoice_id = ?", id).Order("id").Find(&items).Error; err != nil {
		return nil, nil, err
	}
	return &invoice, items, nil
}

// InvoiceAmount is a count of applications or orders and their total.
type InvoiceAmount struct {
	Cents int64 `json:"cents"`
	Count int64 `json:"count"`
}

// InvoiceSummary is what the invoice center shows at the top.
type InvoiceSummary struct {
	Available  InvoiceAmount `json:"available"`
	Processing InvoiceAmount `json:"processing"`
	Issued     InvoiceAmount `json:"issued"`
}

func GetInvoiceSummary(userId int) (*InvoiceSummary, error) {
	orders, err := ListInvoiceableOrders(userId)
	if err != nil {
		return nil, err
	}
	summary := &InvoiceSummary{}
	for _, order := range orders {
		summary.Available.Cents += order.AmountCents
		summary.Available.Count++
	}
	sum := func(statuses ...string) (InvoiceAmount, error) {
		var amount InvoiceAmount
		err := DB.Model(&Invoice{}).
			Select("COALESCE(SUM(order_cents), 0) AS cents, COUNT(*) AS count").
			Where("user_id = ? AND status IN ?", userId, statuses).
			Scan(&amount).Error
		return amount, err
	}
	if summary.Processing, err = sum(InvoiceStatusPendingPayment, InvoiceStatusPendingReview); err != nil {
		return nil, err
	}
	if summary.Issued, err = sum(InvoiceStatusIssued); err != nil {
		return nil, err
	}
	return summary, nil
}

// CountInvoicesAwaitingReview counts applications an administrator has to
// act on.
func CountInvoicesAwaitingReview() (int64, error) {
	var count int64
	err := DB.Model(&Invoice{}).Where("status = ?", InvoiceStatusPendingReview).Count(&count).Error
	return count, err
}

// SaveInvoiceFile stores the issued invoice's file for an application under
// review or already issued, replacing an earlier upload.
func SaveInvoiceFile(id int, name string, mime string, data []byte) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		invoice, err := lockUserInvoice(tx, 0, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingReview && invoice.Status != InvoiceStatusIssued {
			return ErrInvoiceStatusChanged
		}
		if err := tx.Where("invoice_id = ?", id).Delete(&InvoiceFile{}).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		if err := tx.Create(&InvoiceFile{InvoiceId: id, Data: data, CreatedTime: now}).Error; err != nil {
			return err
		}
		return tx.Model(invoice).Updates(map[string]any{
			"file_name":    name,
			"file_mime":    mime,
			"file_size":    len(data),
			"updated_time": now,
		}).Error
	})
}

// GetInvoiceFile returns an application and its file; userId 0 reads any
// account's. A customer reads the file only once the invoice is issued.
func GetInvoiceFile(userId int, id int) (*Invoice, []byte, error) {
	query := DB.Where("id = ?", id)
	if userId > 0 {
		query = query.Where("user_id = ? AND status = ?", userId, InvoiceStatusIssued)
	}
	var invoice Invoice
	if err := query.First(&invoice).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrInvoiceNotFound
		}
		return nil, nil, err
	}
	var file InvoiceFile
	if err := DB.Where("invoice_id = ?", id).First(&file).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrInvoiceFileMissing
		}
		return nil, nil, err
	}
	return &invoice, file.Data, nil
}

// IssueInvoice marks an application under review as issued. Its file must be
// uploaded first.
func IssueInvoice(id int, adminId int) (*Invoice, error) {
	var invoice *Invoice
	err := DB.Transaction(func(tx *gorm.DB) error {
		var err error
		invoice, err = lockUserInvoice(tx, 0, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingReview {
			return ErrInvoiceStatusChanged
		}
		if invoice.FileSize <= 0 {
			return ErrInvoiceFileMissing
		}
		now := common.GetTimestamp()
		invoice.Status = InvoiceStatusIssued
		invoice.IssuedTime = now
		invoice.ReviewedBy = adminId
		invoice.UpdatedTime = now
		return tx.Model(invoice).Updates(map[string]any{
			"status":       invoice.Status,
			"issued_time":  invoice.IssuedTime,
			"reviewed_by":  invoice.ReviewedBy,
			"updated_time": invoice.UpdatedTime,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return invoice, nil
}

// RejectInvoice refuses an application that is under review or awaiting its
// tax, releases its orders, and returns a paid tax to the owner's balance:
// the quota deducted for a balance payment, or the epay amount at the top-up
// price.
func RejectInvoice(id int, adminId int, reason string) (*InvoiceTaxResult, error) {
	result := &InvoiceTaxResult{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		invoice, err := lockUserInvoice(tx, 0, id)
		if err != nil {
			return err
		}
		if invoice.Status != InvoiceStatusPendingReview && invoice.Status != InvoiceStatusPendingPayment {
			return ErrInvoiceStatusChanged
		}
		if invoice.TaxPaidTime > 0 && invoice.TaxCents > 0 {
			refund := invoice.TaxQuota
			if invoice.TaxMethod != InvoiceTaxBalance {
				if refund, err = InvoiceQuotaForCents(invoice.TaxCents, false); err != nil {
					return err
				}
			}
			if err := tx.Model(&User{}).Where("id = ?", invoice.UserId).
				Update("quota", gorm.Expr("quota + ?", refund)).Error; err != nil {
				return err
			}
			result.Quota = refund
		}
		now := common.GetTimestamp()
		invoice.Status = InvoiceStatusRejected
		invoice.RejectReason = reason
		invoice.ReviewedBy = adminId
		invoice.UpdatedTime = now
		if err := tx.Model(invoice).Updates(map[string]any{
			"status":        invoice.Status,
			"reject_reason": invoice.RejectReason,
			"reviewed_by":   invoice.ReviewedBy,
			"updated_time":  invoice.UpdatedTime,
		}).Error; err != nil {
			return err
		}
		result.Invoice = invoice
		return releaseInvoiceClaims(tx, invoice.Id)
	})
	if err != nil {
		return nil, err
	}
	if result.Quota > 0 {
		invoice := result.Invoice
		syncCreditUserQuotaCache(invoice.UserId, int(result.Quota), common.LogText("invoice tax refund"))
		RecordLog(invoice.UserId, LogTypeSystem, common.NewMessage("Invoice application {{id}} was rejected and the tax of ¥{{amount}} was returned as {{quota}}", map[string]any{
			"id":     invoice.Id,
			"amount": FormatInvoiceCents(invoice.TaxCents),
			"quota":  formatInvoiceQuota(result.Quota),
		}))
	}
	return result, nil
}

// DeleteInvoice removes a finished application from both lists, with the
// reason kept on the row, releases its orders, and drops its file. An
// application still in progress must be rejected first.
func DeleteInvoice(id int, adminId int, reason string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		invoice, err := lockUserInvoice(tx, 0, id)
		if err != nil {
			return err
		}
		if invoice.Status == InvoiceStatusPendingPayment || invoice.Status == InvoiceStatusPendingReview {
			return ErrInvoiceStatusChanged
		}
		if err := tx.Model(invoice).Updates(map[string]any{
			"delete_reason": reason,
			"deleted_by":    adminId,
			"updated_time":  common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		if err := releaseInvoiceClaims(tx, invoice.Id); err != nil {
			return err
		}
		if err := tx.Where("invoice_id = ?", invoice.Id).Delete(&InvoiceFile{}).Error; err != nil {
			return err
		}
		return tx.Delete(invoice).Error
	})
}

func formatInvoiceQuota(quota int64) string {
	return logger.FormatQuota(int(quota))
}
