package model

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// ClaudeModelPrefix names the Claude models, which corecode-engine serves
// from the subscription pool.
const ClaudeModelPrefix = "claude-"

// Vendors the funds view splits new-api's charge by. A model is its
// vendor's by name prefix; the site's vendor metadata leaves models out.
const (
	VendorClaude = "claude"
	VendorCodex  = "codex"
	VendorGrok   = "grok"
	VendorGemini = "gemini"
	VendorOther  = "other"
)

var vendorPrefixes = []struct{ prefix, vendor string }{
	{ClaudeModelPrefix, VendorClaude},
	{"gpt-", VendorCodex},
	{"codex-", VendorCodex},
	{"grok-", VendorGrok},
	{"gemini-", VendorGemini},
}

// VendorPrefixes lists the model name prefixes sold under vendor.
func VendorPrefixes(vendor string) []string {
	var prefixes []string
	for _, entry := range vendorPrefixes {
		if entry.vendor == vendor {
			prefixes = append(prefixes, entry.prefix)
		}
	}
	return prefixes
}

// ModelVendor names the vendor a model is sold under, or VendorOther.
func ModelVendor(model string) string {
	for _, entry := range vendorPrefixes {
		if strings.HasPrefix(model, entry.prefix) {
			return entry.vendor
		}
	}
	return VendorOther
}

// VendorModel is what new-api charged for one model over the range, root
// included, as for Claude.
type VendorModel struct {
	Vendor   string  `json:"vendor"`
	Model    string  `json:"model"`
	USD      float64 `json:"usd"`
	Requests int64   `json:"requests"`
}

// VendorRevenue is the revenue earned on one vendor's models: the range's
// recognized revenue shared out by the vendor's part of what customers, not
// root, consumed at list price. Revenue per list-price dollar is not known by
// model, so every vendor earns the site's average; it is an estimate.
type VendorRevenue struct {
	Vendor            string  `json:"vendor"`
	CustomerUSD       float64 `json:"customer_usd"`
	Share             float64 `json:"share"`
	RecognizedRevenue float64 `json:"recognized_revenue"`
}

// FinanceDay is one day of revenue, revenue earned and customers'
// list-price consumption.
type FinanceDay struct {
	Day               int64   `json:"day"`
	Topup             float64 `json:"topup"`
	Subscription      float64 `json:"subscription"`
	ConsumptionUSD    float64 `json:"consumption_usd"`
	RecognizedRevenue float64 `json:"recognized_revenue"`
	// ClaudeUSD is what new-api charged for Claude models, root included:
	// corecode-engine's official-price cost it is compared with covers
	// root's requests too.
	ClaudeUSD float64 `json:"claude_usd"`
	// RootConsumptionUSD is root's own requests at list price: internal use,
	// which ConsumptionUSD leaves out.
	RootConsumptionUSD float64 `json:"root_consumption_usd"`
	// VendorUSD is the day's charge by vendor (ModelVendor), root included.
	VendorUSD map[string]float64 `json:"vendor_usd"`
}

// BalanceUser is a wallet balance in USD.
type BalanceUser struct {
	UserRef
	BalanceUSD float64 `json:"balance_usd"`
}

// QuotaAdjustment is one manual balance change an administrator made, read
// from the audit log.
type QuotaAdjustment struct {
	CreatedAt   int64   `json:"created_at"`
	Operator    string  `json:"operator"`
	Target      UserRef `json:"target"`
	Mode        string  `json:"mode"`
	RequestUSD  float64 `json:"request_usd"`
	BeforeUSD   float64 `json:"before_usd"`
	AfterUSD    float64 `json:"after_usd"`
	DeltaUSD    float64 `json:"delta_usd"`
	Success     bool    `json:"success"`
	HasSnapshot bool    `json:"has_snapshot"`
}

// FinanceInsights compares the money taken in a range with what customers
// consumed at list price, and states the balances the site still owes.
// Revenue is in the payment currency; consumption and balances are USD.
//
// Revenue is the money paid in the range. RecognizedRevenue is the part of
// all money ever paid that the range earned: a plan earns its price evenly
// over the time it runs, and the wallet earns as it is spent, each unit at
// the price its owner paid on average for every unit the wallet was credited
// (walletPrice). Consumption counts customers only; root's own requests are
// RootConsumptionUSD. GiftConsumptionUSD is the part of consumption no
// payment covers: given plans, and the unpaid share of each wallet.
type FinanceInsights struct {
	Revenue             float64            `json:"revenue"`
	TopupRevenue        float64            `json:"topup_revenue"`
	SubscriptionRevenue float64            `json:"subscription_revenue"`
	Orders              int64              `json:"orders"`
	PayingUsers         int64              `json:"paying_users"`
	Methods             []TopUpMethodTotal `json:"methods"`
	Daily               []FinanceDay       `json:"daily"`
	ConsumptionUSD      float64            `json:"consumption_usd"`
	RootConsumptionUSD  float64            `json:"root_consumption_usd"`
	GiftConsumptionUSD  float64            `json:"gift_consumption_usd"`
	// ClaudeUSD is the range's Claude charge, root included (FinanceDay).
	ClaudeUSD float64 `json:"claude_usd"`
	// VendorModels is the range's charge by model, largest first; each
	// vendor's charge is the sum of its models.
	VendorModels []VendorModel `json:"vendor_models"`
	// VendorRevenue is the recognized revenue by vendor, largest first.
	VendorRevenue []VendorRevenue `json:"vendor_revenue"`
	// RevenuePerUSD is revenue divided by list-price consumption: what one
	// dollar of consumption brought in over the range.
	RevenuePerUSD                 float64 `json:"revenue_per_usd"`
	RecognizedRevenue             float64 `json:"recognized_revenue"`
	RecognizedWalletRevenue       float64 `json:"recognized_wallet_revenue"`
	RecognizedSubscriptionRevenue float64 `json:"recognized_subscription_revenue"`
	// RecognizedPerUSD is recognized revenue divided by list-price
	// consumption: what one dollar customers used earned.
	RecognizedPerUSD float64 `json:"recognized_per_usd"`
	LiabilityUSD     float64 `json:"liability_usd"`
	// LiabilityPaidValue is what customers paid for the balances they hold,
	// in the payment currency: the part of LiabilityUSD that is money owed.
	LiabilityPaidValue  float64           `json:"liability_paid_value"`
	LiabilityUsers      int64             `json:"liability_users"`
	DebtUSD             float64           `json:"debt_usd"`
	Debtors             []BalanceUser     `json:"debtors"`
	TopBalances         []BalanceUser     `json:"top_balances"`
	Adjustments         []QuotaAdjustment `json:"adjustments"`
	AdjustmentNetUSD    float64           `json:"adjustment_net_usd"`
	CommissionUSD       float64           `json:"commission_usd"`
	RedemptionUSD       float64           `json:"redemption_usd"`
	BonusUSD            float64           `json:"bonus_usd"`
	TopupCreditUSD      float64           `json:"topup_credit_usd"`
	AdjustmentLogsFound bool              `json:"adjustment_logs_found"`
}

func GetFinanceInsights(r InsightsRange) (*FinanceInsights, error) {
	orders, err := readPaidOrders(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	result := &FinanceInsights{}
	days := make(map[int64]*FinanceDay)
	for _, day := range r.days() {
		days[day] = &FinanceDay{Day: day, VendorUSD: map[string]float64{}}
	}
	type money struct {
		total decimal.Decimal
		count int64
	}
	methods := make(map[string]*money)
	payers := make(map[int]struct{})
	topup, subscription := decimal.Zero, decimal.Zero
	var credit, bonus int64
	for _, order := range orders {
		amount := decimal.NewFromFloat(order.Money)
		day := days[r.DayStart(order.CreateTime)]
		if order.Subscription {
			subscription = subscription.Add(amount)
			if day != nil {
				day.Subscription += order.Money
			}
		} else {
			topup = topup.Add(amount)
			credit += order.Amount
			if day != nil {
				day.Topup += order.Money
			}
		}
		payers[order.UserId] = struct{}{}
		method := methods[order.PaymentMethod]
		if method == nil {
			method = &money{}
			methods[order.PaymentMethod] = method
		}
		method.total, method.count = method.total.Add(amount), method.count+1
	}
	var bonusQuota []int64
	if err := DB.Model(&TopUp{}).Where("status = ? AND create_time >= ? AND create_time < ?", common.TopUpStatusSuccess, r.Start, r.End).
		Pluck("bonus_quota", &bonusQuota).Error; err != nil {
		return nil, err
	}
	for _, quota := range bonusQuota {
		bonus += quota
	}
	result.TopupRevenue = topup.Round(2).InexactFloat64()
	result.SubscriptionRevenue = subscription.Round(2).InexactFloat64()
	result.Revenue = topup.Add(subscription).Round(2).InexactFloat64()
	result.Orders = int64(len(orders))
	result.PayingUsers = int64(len(payers))
	// A top-up's amount is in display units of one dollar.
	result.TopupCreditUSD = float64(credit)
	result.BonusUSD = quotaUSD(bonus)
	for method, value := range methods {
		result.Methods = append(result.Methods, TopUpMethodTotal{PaymentMethod: method, Money: value.total.Round(2).InexactFloat64(), Count: value.count})
	}
	slices.SortFunc(result.Methods, func(a, b TopUpMethodTotal) int { return cmp.Compare(b.Money, a.Money) })

	prices, err := readWalletPrices(r.End)
	if err != nil {
		return nil, err
	}
	hours, err := loadInsightHours(r)
	if err != nil {
		return nil, err
	}
	var consumed, root int64
	var gift, wallet float64
	for _, hour := range hours {
		root += hour.summary.RootQuota
		day := days[r.DayStart(hour.start)]
		if day != nil {
			day.RootConsumptionUSD += float64(hour.summary.RootQuota) / common.QuotaPerUnit
		}
		for _, user := range hour.users {
			price := prices[user.UserId]
			earned := float64(user.WalletQuota) * price.perQuota
			consumed += user.Quota
			wallet += earned
			gift += float64(user.GiftQuota) + float64(user.WalletQuota)*(1-price.paidShare)
			if day != nil {
				day.ConsumptionUSD += float64(user.Quota) / common.QuotaPerUnit
				day.RecognizedRevenue += earned
			}
		}
	}
	quota, err := readInsightQuota(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	var claude int64
	models := make(map[string]*VendorModel)
	var roots []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", common.RoleRootUser).Pluck("id", &roots).Error; err != nil {
		return nil, err
	}
	customer := make(map[string]int64)
	for _, row := range quota {
		vendor := ModelVendor(row.ModelName)
		if !slices.Contains(roots, row.UserID) {
			customer[vendor] += int64(row.Quota)
		}
		model := models[row.ModelName]
		if model == nil {
			model = &VendorModel{Vendor: vendor, Model: row.ModelName}
			models[row.ModelName] = model
		}
		model.USD += float64(row.Quota) / common.QuotaPerUnit
		model.Requests += int64(row.Count)
		day := days[r.DayStart(row.CreatedAt)]
		if day != nil {
			day.VendorUSD[vendor] += float64(row.Quota) / common.QuotaPerUnit
		}
		if vendor != VendorClaude {
			continue
		}
		claude += int64(row.Quota)
		if day != nil {
			day.ClaudeUSD += float64(row.Quota) / common.QuotaPerUnit
		}
	}
	result.VendorModels = []VendorModel{}
	for _, model := range models {
		model.USD = roundTo(model.USD, 4)
		result.VendorModels = append(result.VendorModels, *model)
	}
	slices.SortFunc(result.VendorModels, func(a, b VendorModel) int {
		return cmp.Or(cmp.Compare(b.USD, a.USD), cmp.Compare(a.Model, b.Model))
	})
	subscriptions, err := recognizeSubscriptions(r, prices, days)
	if err != nil {
		return nil, err
	}
	result.ConsumptionUSD = quotaUSD(consumed)
	result.RootConsumptionUSD = quotaUSD(root)
	result.GiftConsumptionUSD = roundTo(gift/common.QuotaPerUnit, 4)
	result.ClaudeUSD = quotaUSD(claude)
	result.RevenuePerUSD = ratio(result.Revenue, result.ConsumptionUSD)
	result.RecognizedWalletRevenue = roundTo(wallet, 2)
	result.RecognizedSubscriptionRevenue = roundTo(subscriptions, 2)
	result.RecognizedRevenue = roundTo(wallet+subscriptions, 2)
	result.RecognizedPerUSD = ratio(result.RecognizedRevenue, result.ConsumptionUSD)
	var customerTotal int64
	for _, quota := range customer {
		customerTotal += quota
	}
	result.VendorRevenue = []VendorRevenue{}
	for vendor, quota := range customer {
		share := ratio(float64(quota), float64(customerTotal))
		result.VendorRevenue = append(result.VendorRevenue, VendorRevenue{
			Vendor: vendor, CustomerUSD: quotaUSD(quota), Share: share,
			RecognizedRevenue: roundTo(float64(quota)/float64(max(customerTotal, 1))*(wallet+subscriptions), 2),
		})
	}
	slices.SortFunc(result.VendorRevenue, func(a, b VendorRevenue) int {
		return cmp.Or(cmp.Compare(b.RecognizedRevenue, a.RecognizedRevenue), cmp.Compare(a.Vendor, b.Vendor))
	})
	for _, day := range days {
		day.Topup, day.Subscription, day.ConsumptionUSD = roundTo(day.Topup, 2), roundTo(day.Subscription, 2), roundTo(day.ConsumptionUSD, 4)
		day.RecognizedRevenue = roundTo(day.RecognizedRevenue, 2)
		day.ClaudeUSD = roundTo(day.ClaudeUSD, 4)
		day.RootConsumptionUSD = roundTo(day.RootConsumptionUSD, 4)
		for vendor, usd := range day.VendorUSD {
			day.VendorUSD[vendor] = roundTo(usd, 4)
		}
		result.Daily = append(result.Daily, *day)
	}
	slices.SortFunc(result.Daily, func(a, b FinanceDay) int { return cmp.Compare(a.Day, b.Day) })

	if err := fillBalances(result, prices); err != nil {
		return nil, err
	}
	if err := fillQuotaAdjustments(r, result); err != nil {
		return nil, err
	}
	var commission, redemption struct{ Total int64 }
	if err := DB.Model(&AffiliateCommission{}).Select("COALESCE(SUM(amount), 0) AS total").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Scan(&commission).Error; err != nil {
		return nil, err
	}
	if err := DB.Model(&Redemption{}).Select("COALESCE(SUM(quota), 0) AS total").
		Where("redeemed_time >= ? AND redeemed_time < ?", r.Start, r.End).Scan(&redemption).Error; err != nil {
		return nil, err
	}
	result.CommissionUSD = quotaUSD(commission.Total)
	result.RedemptionUSD = quotaUSD(redemption.Total)
	return result, nil
}

// fillBalances states the current balances of every customer, and what was
// paid for them at each wallet's price. The root account is left out: its
// balance is the operator's, not money owed.
func fillBalances(result *FinanceInsights, prices map[int]walletPrice) error {
	customers := func() *gorm.DB { return DB.Model(&User{}).Where("role < ?", common.RoleRootUser) }
	var totals struct {
		Liability      int64
		LiabilityUsers int64
		Debt           int64
	}
	if err := customers().Select("COALESCE(SUM(CASE WHEN quota > 0 THEN quota ELSE 0 END), 0) AS liability, " +
		"COUNT(CASE WHEN quota > 0 THEN 1 END) AS liability_users, " +
		"COALESCE(SUM(CASE WHEN quota < 0 THEN quota ELSE 0 END), 0) AS debt").Scan(&totals).Error; err != nil {
		return err
	}
	result.LiabilityUSD = quotaUSD(totals.Liability)
	result.LiabilityUsers = totals.LiabilityUsers
	result.DebtUSD = quotaUSD(totals.Debt)
	var held []struct {
		Id    int
		Quota int64
	}
	if err := customers().Select("id, quota").Where("quota > 0").Find(&held).Error; err != nil {
		return err
	}
	var paid float64
	for _, row := range held {
		paid += float64(row.Quota) * prices[row.Id].perQuota
	}
	result.LiabilityPaidValue = roundTo(paid, 2)

	type balanceRow struct {
		Id       int
		Username string
		Quota    int64
	}
	toBalances := func(rows []balanceRow) []BalanceUser {
		balances := make([]BalanceUser, 0, len(rows))
		for _, row := range rows {
			balances = append(balances, BalanceUser{UserRef: UserRef{UserID: row.Id, Username: row.Username}, BalanceUSD: quotaUSD(row.Quota)})
		}
		return balances
	}
	var top, debtors []balanceRow
	if err := customers().Select("id, username, quota").Where("quota > 0").
		Order("quota desc, id").Limit(insightsTopN).Find(&top).Error; err != nil {
		return err
	}
	if err := customers().Select("id, username, quota").Where("quota < 0").
		Order("quota, id").Find(&debtors).Error; err != nil {
		return err
	}
	result.TopBalances = toBalances(top)
	result.Debtors = toBalances(debtors)
	return nil
}

// walletPrice is what a customer paid for the credit in their wallet:
// perQuota is the money paid for each unit of quota the wallet was ever
// credited, and paidShare the share of those units that was paid for. Spent
// quota is not traced to the credit it came from, so every unit a wallet
// spends is taken to carry the wallet's average price. A wallet credited
// only by gifts has a zero price.
type walletPrice struct {
	perQuota  float64
	paidShare float64
}

// readWalletPrices returns the price of each paying customer's wallet over
// the credits it received before end: paid top-ups with their bonus, manual
// adjustments by an administrator, and redemption codes. A credit outside
// these (a sign-up or invitation reward) is not counted, which leaves that
// wallet's price a little high.
func readWalletPrices(end int64) (map[int]walletPrice, error) {
	orders, err := readPaidOrders(0, end)
	if err != nil {
		return nil, err
	}
	type credit struct {
		money       float64
		paid, given int64
	}
	credits := make(map[int]*credit)
	creditOf := func(userID int) *credit {
		entry := credits[userID]
		if entry == nil {
			entry = &credit{}
			credits[userID] = entry
		}
		return entry
	}
	for _, order := range orders {
		if order.Subscription {
			continue
		}
		entry := creditOf(order.UserId)
		entry.money += order.Money
		entry.paid += order.Amount*int64(common.QuotaPerUnit) + order.BonusQuota
	}
	var logs []AuditLog
	if err := LOG_DB.Model(&AuditLog{}).
		Where("created_at < ? AND success = ? AND action IN ?", end, true,
			[]string{"user.quota_add", "user.quota_subtract", "user.quota_override"}).
		Find(&logs).Error; err != nil {
		return nil, err
	}
	for _, log := range logs {
		if log.Other.Op == nil {
			continue
		}
		params := log.Other.Op.Params
		target, ok := auditInt(params, "target_user_id")
		before, hasBefore := auditInt(params, "from")
		after, hasAfter := auditInt(params, "to")
		if ok && hasBefore && hasAfter {
			creditOf(int(target)).given += after - before
		}
	}
	var redeemed []struct {
		UsedUserId int
		Quota      int64
	}
	if err := DB.Model(&Redemption{}).Unscoped().Select("used_user_id, quota").
		Where("used_user_id > 0 AND redeemed_time > 0 AND redeemed_time < ?", end).Find(&redeemed).Error; err != nil {
		return nil, err
	}
	for _, row := range redeemed {
		creditOf(row.UsedUserId).given += row.Quota
	}
	prices := make(map[int]walletPrice, len(credits))
	for userID, entry := range credits {
		if entry.money <= 0 || entry.paid <= 0 {
			continue
		}
		// Taking credit away never raises the price above what was paid.
		total := float64(max(entry.paid, entry.paid+entry.given))
		prices[userID] = walletPrice{perQuota: entry.money / total, paidShare: float64(entry.paid) / total}
	}
	return prices, nil
}

// recognizeSubscriptions spreads each bought plan's price evenly over the
// time it runs, adds the part falling in each day of the range to that day's
// RecognizedRevenue, and returns the part falling in the range. A plan bought
// with wallet balance is worth the balance it took at the wallet's price.
// Orders do not name the plan they created, so the k-th successful order of
// a user for a plan is matched with the k-th plan of that user, plan and
// source.
func recognizeSubscriptions(r InsightsRange, prices map[int]walletPrice, days map[int64]*FinanceDay) (float64, error) {
	sources := []string{"order", PaymentMethodBalance}
	var running []int
	if err := DB.Model(&UserSubscription{}).Distinct("user_id").
		Where("source IN ? AND start_time < ? AND end_time > ?", sources, r.End, r.Start).
		Pluck("user_id", &running).Error; err != nil {
		return 0, err
	}
	if len(running) == 0 {
		return 0, nil
	}
	var subscriptions []UserSubscription
	if err := DB.Select("id, user_id, plan_id, source, start_time, end_time").
		Where("user_id IN ? AND source IN ?", running, sources).
		Order("created_at, id").Find(&subscriptions).Error; err != nil {
		return 0, err
	}
	var orders []SubscriptionOrder
	if err := DB.Select("id, user_id, plan_id, money, payment_provider, provider_payload, complete_time").
		Where("user_id IN ? AND status = ?", running, common.TopUpStatusSuccess).
		Order("complete_time, id").Find(&orders).Error; err != nil {
		return 0, err
	}
	type planKey struct {
		userID, planID int
		source         string
	}
	paid := make(map[planKey][]float64)
	for _, order := range orders {
		key := planKey{order.UserId, order.PlanId, "order"}
		value := order.Money
		if order.PaymentProvider == PaymentProviderBalance {
			key.source = PaymentMethodBalance
			charged, _ := strconv.ParseInt(strings.TrimPrefix(order.ProviderPayload, "charged_quota="), 10, 64)
			value = float64(charged) * prices[order.UserId].perQuota
		}
		paid[key] = append(paid[key], value)
	}
	seen := make(map[planKey]int)
	var total float64
	for _, subscription := range subscriptions {
		key := planKey{subscription.UserId, subscription.PlanId, subscription.Source}
		index := seen[key]
		seen[key]++
		if index >= len(paid[key]) || subscription.EndTime <= subscription.StartTime {
			continue
		}
		perSecond := paid[key][index] / float64(subscription.EndTime-subscription.StartTime)
		from, to := max(subscription.StartTime, r.Start), min(subscription.EndTime, r.End)
		if from >= to {
			continue
		}
		total += perSecond * float64(to-from)
		for at := from; at < to; {
			dayStart := r.DayStart(at)
			next := min(dayStart+86400, to)
			if day := days[dayStart]; day != nil {
				day.RecognizedRevenue += perSecond * float64(next-at)
			}
			at = next
		}
	}
	return total, nil
}

func auditInt(fields AuditFields, key string) (int64, bool) {
	raw, ok := fields[key]
	if !ok {
		return 0, false
	}
	var value int64
	switch typed := raw.(type) {
	case []byte:
		if err := common.Unmarshal(typed, &value); err != nil {
			return 0, false
		}
	default:
		encoded, err := common.Marshal(typed)
		if err != nil || common.Unmarshal(encoded, &value) != nil {
			return 0, false
		}
	}
	return value, true
}

func auditString(fields AuditFields, key string) string {
	raw, ok := fields[key]
	if !ok {
		return ""
	}
	encoded, err := common.Marshal(raw)
	if err != nil {
		return ""
	}
	var value string
	if common.Unmarshal(encoded, &value) != nil {
		return ""
	}
	return value
}

func fillQuotaAdjustments(r InsightsRange, result *FinanceInsights) error {
	var logs []AuditLog
	err := LOG_DB.Model(&AuditLog{}).
		Where("created_at >= ? AND created_at < ? AND action IN ?", r.Start, r.End,
			[]string{"user.quota_add", "user.quota_subtract", "user.quota_override"}).
		Order("id desc").Limit(500).Find(&logs).Error
	if err != nil {
		return err
	}
	result.AdjustmentLogsFound = len(logs) > 0
	result.Adjustments = make([]QuotaAdjustment, 0, len(logs))
	var net int64
	for _, log := range logs {
		adjustment := QuotaAdjustment{CreatedAt: log.CreatedAt, Operator: log.Username, Success: log.Success}
		if log.Other.Op != nil {
			params := log.Other.Op.Params
			target, _ := auditInt(params, "target_user_id")
			adjustment.Target = UserRef{UserID: int(target), Username: auditString(params, "target_username")}
			adjustment.Mode = auditString(params, "mode")
			requested, _ := auditInt(params, "requested_quota")
			adjustment.RequestUSD = quotaUSD(requested)
			before, hasBefore := auditInt(params, "from")
			after, hasAfter := auditInt(params, "to")
			if hasBefore && hasAfter {
				adjustment.HasSnapshot = true
				adjustment.BeforeUSD, adjustment.AfterUSD = quotaUSD(before), quotaUSD(after)
				adjustment.DeltaUSD = quotaUSD(after - before)
				if log.Success {
					net += after - before
				}
			}
		}
		result.Adjustments = append(result.Adjustments, adjustment)
	}
	result.AdjustmentNetUSD = quotaUSD(net)
	return nil
}
