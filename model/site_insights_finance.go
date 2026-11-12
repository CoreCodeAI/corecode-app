package model

import (
	"cmp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

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
	// VendorMedia is image and video generation, sold per call through
	// media suppliers rather than any pool.
	VendorMedia = "media"
	VendorOther = "other"
)

// The first prefix a model matches names its vendor, so the media prefixes
// come before gpt- and grok-. Each media prefix names models that exist:
// common.ImageGenerationModels, the task plugins and the media groups.
var vendorPrefixes = []struct{ prefix, vendor string }{
	{ClaudeModelPrefix, VendorClaude},
	{"gpt-image-", VendorMedia},
	{"dall-e-", VendorMedia},
	{"sora-", VendorMedia},
	{"veo-", VendorMedia},
	{"imagen-", VendorMedia},
	{"grok-imagine-", VendorMedia},
	{"seedance-", VendorMedia},
	{"doubao-seedance-", VendorMedia},
	{"seedream-", VendorMedia},
	{"doubao-seedream-", VendorMedia},
	{"wan-", VendorMedia},
	{"wan2.", VendorMedia},
	{"wan3.", VendorMedia},
	{"wanx", VendorMedia},
	{"qwen-image", VendorMedia},
	{"kling-", VendorMedia},
	{"vidu", VendorMedia},
	{"MiniMax-Hailuo-", VendorMedia},
	{"jimeng", VendorMedia},
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

// VendorModel is what new-api charged for one model over the range, staff
// included, as for Claude.
type VendorModel struct {
	Vendor   string  `json:"vendor"`
	Model    string  `json:"model"`
	USD      float64 `json:"usd"`
	Requests int64   `json:"requests"`
}

// VendorRevenue is the revenue earned on one vendor's models: the range's
// recognized revenue shared out by the vendor's part of what customers, not
// staff, consumed at list price. Revenue per list-price dollar is not known by
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
	// ClaudeUSD is what new-api charged for Claude models, staff included:
	// corecode-engine's official-price cost it is compared with covers
	// staff's requests too.
	ClaudeUSD float64 `json:"claude_usd"`
	// RootConsumptionUSD is staff's own requests at list price: internal use,
	// which ConsumptionUSD leaves out.
	RootConsumptionUSD float64 `json:"root_consumption_usd"`
	// VendorUSD is the day's charge by vendor (ModelVendor), staff included.
	VendorUSD map[string]float64 `json:"vendor_usd"`
}

// FinanceHour is one hour of the FinanceDay fields of the same names: cash
// by order time, and list-price consumption of customers and of staff.
type FinanceHour struct {
	Hour               int64   `json:"hour"`
	Topup              float64 `json:"topup"`
	Subscription       float64 `json:"subscription"`
	ConsumptionUSD     float64 `json:"consumption_usd"`
	RootConsumptionUSD float64 `json:"root_consumption_usd"`
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
// (walletPrice). Consumption counts customers only; staff's own requests are
// RootConsumptionUSD. GiftConsumptionUSD is the part of consumption no
// payment covers: given plans, and the unpaid share of each wallet, top-up
// bonus included. An order counts when it was paid (complete_time), or when
// it was created if it has no completion time.
type FinanceInsights struct {
	Revenue             float64            `json:"revenue"`
	TopupRevenue        float64            `json:"topup_revenue"`
	SubscriptionRevenue float64            `json:"subscription_revenue"`
	Orders              int64              `json:"orders"`
	PayingUsers         int64              `json:"paying_users"`
	Methods             []TopUpMethodTotal `json:"methods"`
	Daily               []FinanceDay       `json:"daily"`
	// Hourly is every UTC hour of a range up to insightsHourlySpan.
	Hourly             []FinanceHour `json:"hourly,omitempty"`
	ConsumptionUSD     float64       `json:"consumption_usd"`
	RootConsumptionUSD float64       `json:"root_consumption_usd"`
	GiftConsumptionUSD float64       `json:"gift_consumption_usd"`
	// ClaudeUSD is the range's Claude charge, staff included (FinanceDay).
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
	// AdjustmentsTotal counts every manual adjustment in the range.
	// Adjustments lists the newest adjustmentListLimit of them, so
	// AdjustmentsTruncated says the list is cut; AdjustmentNetUSD sums the
	// successful ones in the whole range, listed or not.
	AdjustmentsTotal     int64 `json:"adjustments_total"`
	AdjustmentsTruncated bool  `json:"adjustments_truncated"`
	// CheckinCreditUSD is the credit check-ins awarded in the range.
	// SignupBonuses and InviteeBonuses count the sign-up and invitation
	// rewards logged in the range; their amount is not recorded, so the
	// estimates price each at today's setting.
	CheckinCreditUSD         float64 `json:"checkin_credit_usd"`
	SignupBonuses            int64   `json:"signup_bonuses"`
	InviteeBonuses           int64   `json:"invitee_bonuses"`
	SignupCreditEstimateUSD  float64 `json:"signup_credit_estimate_usd"`
	InviteeCreditEstimateUSD float64 `json:"invitee_credit_estimate_usd"`
	// PlanLiability is what running plans owe now; PlanBook is each plan's
	// movement, running plans first.
	PlanLiability PlanLiability `json:"plan_liability"`
	PlanBook      []PlanBookRow `json:"plan_book"`
	// OrderMethods is the checkouts opened in the range by payment method.
	OrderMethods []OrderMethodFunnel `json:"order_methods"`
	// VendorUpstream is what billed upstream channels cost by vendor; the
	// unattributed amounts are cost on channels that served no customer
	// request in the range.
	VendorUpstream              []VendorUpstreamCost `json:"vendor_upstream"`
	UpstreamUnattributedBillUSD float64              `json:"upstream_unattributed_bill_usd"`
	UpstreamUnattributedFeeUSD  float64              `json:"upstream_unattributed_fee_usd"`
	// Groups is customers' use by the group each request was billed in.
	Groups []GroupConsumption `json:"groups"`
	// StaleHours counts the range's hours still stored under an older rollup
	// version, until they are rebuilt; omitted when none.
	StaleHours int `json:"stale_hours"`
	// Truncated says an hour of the range was cut by its row cap, so the
	// revenue and consumption of that hour are short.
	Truncated bool `json:"truncated"`
	// PaidUseUSD is customers' consumption that was not gifted credit over
	// the range, and PaidUsePerDayUSD that over RangeDays. The runway is
	// LiabilityPaidValue (the paid balances customers hold now, in the payment
	// currency) plus PaidPlanQuotaLeftUSD, over PaidUsePerDayUSD.
	PaidUseUSD           float64 `json:"paid_use_usd"`
	RangeDays            float64 `json:"range_days"`
	PaidUsePerDayUSD     float64 `json:"paid_use_per_day_usd"`
	PaidPlanQuotaLeftUSD float64 `json:"paid_plan_quota_left_usd"`
}

// OrderMethodFunnel is the checkouts opened with one payment method in the
// range, top-ups and plan orders alike, wallet-paid ones left out, by what
// became of them so far. Epay and Creem never mark an unpaid order failed or
// expired, so it stays pending: CompletionRate is Paid over Created, and
// PendingStale counts the pending ones opened over an hour ago. PaidMoney is
// in the payment currency.
type OrderMethodFunnel struct {
	PaymentMethod  string  `json:"payment_method"`
	Created        int64   `json:"created"`
	Paid           int64   `json:"paid"`
	Failed         int64   `json:"failed"`
	Expired        int64   `json:"expired"`
	Pending        int64   `json:"pending"`
	PendingStale   int64   `json:"pending_stale"`
	PlanOrders     int64   `json:"plan_orders"`
	PaidMoney      float64 `json:"paid_money"`
	CompletionRate float64 `json:"completion_rate"`
}

// VendorUpstreamCost is the cost of the billed upstream channels that served
// one vendor's models (ModelVendor), from the upstream view. BillUSD is the
// upstreams' own bill, in each upstream's quota dollars, which compare with
// revenue one for one; FeeUSD is monthly fees spread over the range, in real
// US dollars. A bill is split by the model it names, a fee and a bill's
// remainder by the vendor's share of the channel's revenue. CostedRevenueUSD
// is customers' charge on channels with a bill or fee, UncostedRevenueUSD on
// channels with neither, such as the pool's, whose cost is its accounts.
// OldestBillAt is the oldest newest bill among its billed channels: revenue
// after it is not costed yet. Channels lists the costed channels.
type VendorUpstreamCost struct {
	Vendor             string  `json:"vendor"`
	BillUSD            float64 `json:"bill_usd"`
	FeeUSD             float64 `json:"fee_usd"`
	CostedRevenueUSD   float64 `json:"costed_revenue_usd"`
	UncostedRevenueUSD float64 `json:"uncosted_revenue_usd"`
	OldestBillAt       int64   `json:"oldest_bill_at"`
	Channels           []int   `json:"channels"`
}

// GroupConsumption is customers' use in one billing group (quota_data's
// use_group; "" before it was recorded). ConsumptionUSD is what they were
// charged, after the group's ratio; ListUSD divides today's ratio back out,
// 0 when the group has no ratio now. Requests counts served requests.
// RevenueEstimate shares the range's recognized revenue by consumption, an
// estimate as for models.
type GroupConsumption struct {
	Group           string  `json:"group"`
	Requests        int64   `json:"requests"`
	Users           int64   `json:"users"`
	Tokens          int64   `json:"tokens"`
	ConsumptionUSD  float64 `json:"consumption_usd"`
	Share           float64 `json:"share"`
	Ratio           float64 `json:"ratio"`
	ListUSD         float64 `json:"list_usd"`
	RevenueEstimate float64 `json:"revenue_estimate"`
}

func GetFinanceInsights(r InsightsRange) (*FinanceInsights, error) {
	return financeInsightsAt(r, common.GetTimestamp())
}

// financeInsightsAt reads the funds view with now as the time the balances,
// running plans and pending orders are judged at.
func financeInsightsAt(r InsightsRange, now int64) (*FinanceInsights, error) {
	orders, err := readOrdersPaidIn(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	result := &FinanceInsights{}
	days := make(map[int64]*FinanceDay)
	for _, day := range r.days() {
		days[day] = &FinanceDay{Day: day, VendorUSD: map[string]float64{}}
	}
	hourStarts := r.hourStarts()
	hourly := make(map[int64]*FinanceHour, len(hourStarts))
	for _, start := range hourStarts {
		hourly[start] = &FinanceHour{Hour: start}
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
		day := days[r.DayStart(order.PaidAt)]
		hour := hourly[insightHourKey(order.PaidAt)]
		if order.Subscription {
			subscription = subscription.Add(amount)
			if day != nil {
				day.Subscription += order.Money
			}
			if hour != nil {
				hour.Subscription += order.Money
			}
		} else {
			topup = topup.Add(amount)
			credit += order.Amount
			bonus += order.BonusQuota
			if day != nil {
				day.Topup += order.Money
			}
			if hour != nil {
				hour.Topup += order.Money
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
	hours, stale, err := loadInsightHoursStale(r)
	if err != nil {
		return nil, err
	}
	result.StaleHours = stale
	var consumed, root int64
	var gift, wallet float64
	for _, hour := range hours {
		result.Truncated = result.Truncated || hour.summary.Truncated
		root += hour.summary.RootQuota
		day := days[r.DayStart(hour.start)]
		if day != nil {
			day.RootConsumptionUSD += float64(hour.summary.RootQuota) / common.QuotaPerUnit
		}
		slot := hourly[hour.start]
		if slot != nil {
			slot.RootConsumptionUSD += float64(hour.summary.RootQuota) / common.QuotaPerUnit
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
			if slot != nil {
				slot.ConsumptionUSD += float64(user.Quota) / common.QuotaPerUnit
			}
		}
	}
	quota, err := readInsightQuota(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	var claude int64
	models := make(map[string]*VendorModel)
	var staff []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", customerRoleBound).Pluck("id", &staff).Error; err != nil {
		return nil, err
	}
	customer := make(map[string]int64)
	for _, row := range quota {
		vendor := ModelVendor(row.ModelName)
		if !slices.Contains(staff, row.UserID) {
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
	// A stored hour may be negative where a refund outweighed its charges
	// (addQuota); a sum is stopped at zero only once it is shown.
	consumed, root, gift, wallet = max(consumed, 0), max(root, 0), max(gift, 0), max(wallet, 0)
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
	if result.Groups, err = readGroupConsumption(r, staff, wallet+subscriptions); err != nil {
		return nil, err
	}
	upstream, err := upstreamInsightsFromHours(r, hours, stale)
	if err != nil {
		return nil, err
	}
	result.VendorUpstream, result.UpstreamUnattributedBillUSD, result.UpstreamUnattributedFeeUSD = vendorUpstreamCosts(upstream)
	for _, day := range days {
		day.Topup, day.Subscription, day.ConsumptionUSD = roundTo(day.Topup, 2), roundTo(day.Subscription, 2), roundTo(max(day.ConsumptionUSD, 0), 4)
		day.RecognizedRevenue = roundTo(max(day.RecognizedRevenue, 0), 2)
		day.ClaudeUSD = roundTo(day.ClaudeUSD, 4)
		day.RootConsumptionUSD = roundTo(max(day.RootConsumptionUSD, 0), 4)
		for vendor, usd := range day.VendorUSD {
			day.VendorUSD[vendor] = roundTo(usd, 4)
		}
		result.Daily = append(result.Daily, *day)
	}
	slices.SortFunc(result.Daily, func(a, b FinanceDay) int { return cmp.Compare(a.Day, b.Day) })
	for _, start := range hourStarts {
		hour := hourly[start]
		hour.Topup, hour.Subscription = roundTo(hour.Topup, 2), roundTo(hour.Subscription, 2)
		hour.ConsumptionUSD, hour.RootConsumptionUSD = roundTo(max(hour.ConsumptionUSD, 0), 4), roundTo(max(hour.RootConsumptionUSD, 0), 4)
		result.Hourly = append(result.Hourly, *hour)
	}

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
	if err := fillGivenCredit(r, result); err != nil {
		return nil, err
	}
	if result.PlanLiability, result.PlanBook, err = readPlanBook(r, now, prices); err != nil {
		return nil, err
	}
	if result.OrderMethods, err = readOrderFunnel(r, now); err != nil {
		return nil, err
	}
	// The runway is the paid balance over paid use per day, both on paid money.
	// Paid use leaves out the gifted part of consumption; the plan quota is what
	// paid plans have left now, the period part included.
	result.PaidUseUSD = roundTo(max(result.ConsumptionUSD-result.GiftConsumptionUSD, 0), 4)
	result.RangeDays = roundTo(float64(r.End-r.Start)/86400, 4)
	result.PaidUsePerDayUSD = ratio(result.PaidUseUSD, result.RangeDays)
	result.PaidPlanQuotaLeftUSD = roundTo(result.PlanLiability.PaidQuotaLeftUSD+result.PlanLiability.PaidPeriodLeftUSD, 4)
	return result, nil
}

// paidAtOrder is a readPaidOrders order with the time it counts at.
type paidAtOrder struct {
	UserId        int
	Money         float64
	Amount        int64
	BonusQuota    int64
	PaymentMethod string
	TradeNo       string
	CreateTime    int64
	CompleteTime  int64
	Subscription  bool  `gorm:"-"`
	PaidAt        int64 `gorm:"-"`
}

// readOrdersPaidIn returns readPaidOrders' orders paid in [start, end): by
// complete_time, or create_time for an order without one. An order paid
// after a range was read then lands in the hour it was paid, not in an
// earlier hour already shown.
func readOrdersPaidIn(start, end int64) ([]paidAtOrder, error) {
	var orders []paidAtOrder
	if err := DB.Model(&TopUp{}).Select("user_id, money, amount, bonus_quota, payment_method, trade_no, create_time, complete_time").
		Where("status = ? AND (payment_provider IS NULL OR payment_provider <> ?)", common.TopUpStatusSuccess, PaymentProviderBalance).
		Where("((complete_time >= ? AND complete_time < ?) OR ((complete_time IS NULL OR complete_time = 0) AND create_time >= ? AND create_time < ?))",
			start, end, start, end).
		Find(&orders).Error; err != nil {
		return nil, err
	}
	tradeNos := make([]string, 0, len(orders))
	for _, order := range orders {
		tradeNos = append(tradeNos, order.TradeNo)
	}
	subscriptions := make(map[string]bool)
	for chunk := range slices.Chunk(tradeNos, insightsChunk) {
		var found []string
		if err := DB.Model(&SubscriptionOrder{}).Where("status = ? AND trade_no IN ?", common.TopUpStatusSuccess, chunk).
			Pluck("trade_no", &found).Error; err != nil {
			return nil, err
		}
		for _, tradeNo := range found {
			subscriptions[tradeNo] = true
		}
	}
	for i := range orders {
		orders[i].Subscription = subscriptions[orders[i].TradeNo]
		orders[i].PaidAt = cmp.Or(orders[i].CompleteTime, orders[i].CreateTime)
	}
	return orders, nil
}

// readOrderFunnel counts the checkouts opened in the range by payment method
// and outcome. A plan order is read from subscription_orders: top_ups holds
// it too, but only once it is paid.
func readOrderFunnel(r InsightsRange, now int64) ([]OrderMethodFunnel, error) {
	type checkout struct {
		TradeNo       string
		PaymentMethod string
		Status        string
		Money         float64
		CreateTime    int64
	}
	notWallet := "(payment_provider IS NULL OR payment_provider <> ?)"
	var plans []checkout
	if err := DB.Model(&SubscriptionOrder{}).Select("trade_no, payment_method, status, money, create_time").
		Where("create_time >= ? AND create_time < ? AND "+notWallet, r.Start, r.End, PaymentProviderBalance).
		Find(&plans).Error; err != nil {
		return nil, err
	}
	var topups []checkout
	if err := DB.Model(&TopUp{}).Select("trade_no, payment_method, status, money, create_time").
		Where("create_time >= ? AND create_time < ? AND "+notWallet, r.Start, r.End, PaymentProviderBalance).
		Find(&topups).Error; err != nil {
		return nil, err
	}
	planTrades := make(map[string]bool, len(plans))
	for _, plan := range plans {
		planTrades[plan.TradeNo] = true
	}
	methods := make(map[string]*OrderMethodFunnel)
	money := make(map[string]decimal.Decimal)
	add := func(order checkout, plan bool) {
		row := methods[order.PaymentMethod]
		if row == nil {
			row = &OrderMethodFunnel{PaymentMethod: order.PaymentMethod}
			methods[order.PaymentMethod] = row
		}
		row.Created++
		if plan {
			row.PlanOrders++
		}
		switch order.Status {
		case common.TopUpStatusSuccess:
			row.Paid++
			money[order.PaymentMethod] = money[order.PaymentMethod].Add(decimal.NewFromFloat(order.Money))
		case common.TopUpStatusFailed:
			row.Failed++
		case common.TopUpStatusExpired:
			row.Expired++
		case common.TopUpStatusPending:
			row.Pending++
			if order.CreateTime < now-3600 {
				row.PendingStale++
			}
		}
	}
	for _, plan := range plans {
		add(plan, true)
	}
	for _, topup := range topups {
		if !planTrades[topup.TradeNo] {
			add(topup, false)
		}
	}
	result := make([]OrderMethodFunnel, 0, len(methods))
	for method, row := range methods {
		row.PaidMoney = money[method].Round(2).InexactFloat64()
		row.CompletionRate = ratio(float64(row.Paid), float64(row.Created))
		result = append(result, *row)
	}
	slices.SortFunc(result, func(a, b OrderMethodFunnel) int {
		return cmp.Or(cmp.Compare(b.Created, a.Created), cmp.Compare(a.PaymentMethod, b.PaymentMethod))
	})
	return result, nil
}

// readGroupConsumption sums customers' quota_data by billing group, staff
// left out, and shares revenue (the range's recognized revenue) by it.
func readGroupConsumption(r InsightsRange, staff []int, revenue float64) ([]GroupConsumption, error) {
	var rows []struct {
		UseGroup   string
		UserId     int
		Requests   int64
		Quota      int64
		Tokens     int64
		CacheRead  int64
		CacheWrite int64
	}
	if err := DB.Model(&QuotaData{}).
		Select("use_group, user_id, SUM(count) AS requests, SUM(quota) AS quota, SUM(token_used) AS tokens, "+
			"SUM(cache_read_tokens) AS cache_read, SUM(cache_creation_tokens) AS cache_write").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).
		Group("use_group, user_id").Find(&rows).Error; err != nil {
		return nil, err
	}
	groups := make(map[string]*GroupConsumption)
	quota := make(map[string]int64)
	var total int64
	for _, row := range rows {
		if slices.Contains(staff, row.UserId) {
			continue
		}
		group := groups[row.UseGroup]
		if group == nil {
			group = &GroupConsumption{Group: row.UseGroup}
			groups[row.UseGroup] = group
		}
		group.Requests += row.Requests
		group.Users++
		group.Tokens += row.Tokens + row.CacheRead + row.CacheWrite
		quota[row.UseGroup] += row.Quota
		total += row.Quota
	}
	ratios := ratio_setting.GetGroupRatioCopy()
	result := make([]GroupConsumption, 0, len(groups))
	for name, group := range groups {
		group.ConsumptionUSD = quotaUSD(quota[name])
		group.Share = ratio(float64(quota[name]), float64(total))
		group.RevenueEstimate = roundTo(float64(quota[name])/float64(max(total, 1))*revenue, 2)
		if value, ok := ratios[name]; ok && value > 0 {
			group.Ratio = value
			group.ListUSD = roundTo(float64(quota[name])/common.QuotaPerUnit/value, 4)
		}
		result = append(result, *group)
	}
	slices.SortFunc(result, func(a, b GroupConsumption) int {
		return cmp.Or(cmp.Compare(b.ConsumptionUSD, a.ConsumptionUSD), cmp.Compare(a.Group, b.Group))
	})
	return result, nil
}

// vendorUpstreamCosts shares the upstream view's channel costs out by vendor.
func vendorUpstreamCosts(upstream *UpstreamInsights) (rows []VendorUpstreamCost, unattributedBill float64, unattributedFee float64) {
	revenue := make(map[int]map[string]float64)
	billed := make(map[int]map[string]float64)
	for _, model := range upstream.Models {
		vendor := ModelVendor(model.Model)
		if revenue[model.ChannelID] == nil {
			revenue[model.ChannelID], billed[model.ChannelID] = map[string]float64{}, map[string]float64{}
		}
		revenue[model.ChannelID][vendor] += model.RevenueUSD
		billed[model.ChannelID][vendor] += model.CostUSD
	}
	vendors := make(map[string]*VendorUpstreamCost)
	rowOf := func(vendor string) *VendorUpstreamCost {
		row := vendors[vendor]
		if row == nil {
			row = &VendorUpstreamCost{Vendor: vendor, Channels: []int{}}
			vendors[vendor] = row
		}
		return row
	}
	for _, channel := range upstream.Channels {
		var total float64
		for _, usd := range revenue[channel.ID] {
			total += usd
		}
		if channel.CostSource == UpstreamCostSourceNone {
			for vendor, usd := range revenue[channel.ID] {
				rowOf(vendor).UncostedRevenueUSD += usd
			}
			continue
		}
		// The part of the channel's cost no model of ours names: a fee, or a
		// bill for models the upstream logs under another name.
		shared := channel.CostUSD
		if channel.CostSource == UpstreamCostSourceUpstream {
			for vendor, usd := range billed[channel.ID] {
				if usd > 0 {
					rowOf(vendor).BillUSD += usd
					shared -= usd
				}
			}
		}
		shared = max(shared, 0)
		if shared > 0 && total <= 0 {
			if channel.CostSource == UpstreamCostSourceUpstream {
				unattributedBill += shared
			} else {
				unattributedFee += shared
			}
		}
		for vendor, usd := range revenue[channel.ID] {
			row := rowOf(vendor)
			row.CostedRevenueUSD += usd
			row.Channels = append(row.Channels, channel.ID)
			if total > 0 {
				part := shared * usd / total
				if channel.CostSource == UpstreamCostSourceUpstream {
					row.BillUSD += part
				} else {
					row.FeeUSD += part
				}
			}
			if channel.CostSource == UpstreamCostSourceUpstream && channel.LatestCostAt > 0 &&
				(row.OldestBillAt == 0 || channel.LatestCostAt < row.OldestBillAt) {
				row.OldestBillAt = channel.LatestCostAt
			}
		}
	}
	rows = make([]VendorUpstreamCost, 0, len(vendors))
	for _, row := range vendors {
		row.BillUSD, row.FeeUSD = roundTo(row.BillUSD, 4), roundTo(row.FeeUSD, 4)
		row.CostedRevenueUSD, row.UncostedRevenueUSD = roundTo(row.CostedRevenueUSD, 4), roundTo(row.UncostedRevenueUSD, 4)
		slices.Sort(row.Channels)
		rows = append(rows, *row)
	}
	slices.SortFunc(rows, func(a, b VendorUpstreamCost) int {
		return cmp.Or(cmp.Compare(b.BillUSD+b.FeeUSD, a.BillUSD+a.FeeUSD), cmp.Compare(a.Vendor, b.Vendor))
	})
	return rows, roundTo(unattributedBill, 4), roundTo(unattributedFee, 4)
}

// Sign-up and invitation rewards are logged as text only; these are the
// English texts the logs have carried since rewards were logged as messages.
const (
	signupBonusLogPrefix  = "New user sign-up bonus "
	inviteeBonusLogPrefix = "Invitation code bonus "
)

// fillGivenCredit adds the credit given outside top-ups, codes, commission
// and adjustments: check-ins, read exactly, and sign-up and invitation
// rewards, counted from their logs and priced at today's settings.
func fillGivenCredit(r InsightsRange, result *FinanceInsights) error {
	var checkins struct{ Total int64 }
	if err := DB.Model(&Checkin{}).Select("COALESCE(SUM(quota_awarded), 0) AS total").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Scan(&checkins).Error; err != nil {
		return err
	}
	result.CheckinCreditUSD = quotaUSD(checkins.Total)
	count := func(prefix string, target *int64) error {
		return LOG_DB.Model(&Log{}).Where("type = ? AND created_at >= ? AND created_at < ? AND content LIKE ?",
			LogTypeSystem, r.Start, r.End, prefix+"%").Count(target).Error
	}
	if err := count(signupBonusLogPrefix, &result.SignupBonuses); err != nil {
		return err
	}
	if err := count(inviteeBonusLogPrefix, &result.InviteeBonuses); err != nil {
		return err
	}
	result.SignupCreditEstimateUSD = quotaUSD(result.SignupBonuses * int64(common.QuotaForNewUser))
	result.InviteeCreditEstimateUSD = quotaUSD(result.InviteeBonuses * int64(common.QuotaForInvitee))
	return nil
}

// fillBalances states the current balances of every customer, and what was
// paid for them at each wallet's price. Staff accounts are left out: their
// balances are the operator's, not money owed.
func fillBalances(result *FinanceInsights, prices map[int]walletPrice) error {
	customers := func() *gorm.DB { return DB.Model(&User{}).Where("role < ?", customerRoleBound) }
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
// credited, and paidShare the share of those units that was paid for. A
// top-up's bonus came with a payment, so it lowers perQuota, but it was not
// paid for, so it is outside paidShare, as the credit issued calls it. Spent
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
		money              float64
		paid, bonus, given int64
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
		entry.bonus += order.BonusQuota
	}
	if err := eachQuotaAdjustment(0, end, func(log AuditLog) {
		if !log.Success || log.Other.Op == nil {
			return
		}
		params := log.Other.Op.Params
		target, ok := auditInt(params, "target_user_id")
		before, hasBefore := auditInt(params, "from")
		after, hasAfter := auditInt(params, "to")
		if ok && hasBefore && hasAfter {
			creditOf(int(target)).given += after - before
		}
	}); err != nil {
		return nil, err
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
		prices[userID] = walletPrice{perQuota: entry.money / total, paidShare: float64(entry.paid-entry.bonus) / total}
	}
	return prices, nil
}

// recognizeSubscriptions spreads each bought plan's price evenly over the
// time it runs, adds the part falling in each day of the range to that day's
// RecognizedRevenue, and returns the part falling in the range. A plan bought
// with wallet balance is worth the balance it took at the wallet's price
// (planPrices).
func recognizeSubscriptions(r InsightsRange, prices map[int]walletPrice, days map[int64]*FinanceDay) (float64, error) {
	var running []int
	if err := DB.Model(&UserSubscription{}).Distinct("user_id").
		Where("source IN ? AND start_time < ? AND end_time > ?", paidPlanSources, r.End, r.Start).
		Pluck("user_id", &running).Error; err != nil {
		return 0, err
	}
	if len(running) == 0 {
		return 0, nil
	}
	subscriptions, values, err := planPrices(running, prices)
	if err != nil {
		return 0, err
	}
	var total float64
	for _, subscription := range subscriptions {
		value, ok := values[subscription.Id]
		if !ok || subscription.EndTime <= subscription.StartTime {
			continue
		}
		perSecond := value / float64(subscription.EndTime-subscription.StartTime)
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

// quotaAdjustmentActions are the audit actions that change a user's quota by
// hand: the adjustments the funds view counts.
var quotaAdjustmentActions = []string{"user.quota_add", "user.quota_subtract", "user.quota_override"}

// adjustmentListLimit bounds the adjustments the funds view lists, newest
// first; the totals still cover every adjustment in the range.
const adjustmentListLimit = 500

// adjustmentBatch bounds the audit rows held in memory by one read.
const adjustmentBatch = 1000

// eachQuotaAdjustment calls fn with every manual quota adjustment logged in
// [start, end), oldest first. It reads only the columns fn uses, in batches
// keyed by id, so a long range does not hold every log at once.
func eachQuotaAdjustment(start, end int64, fn func(AuditLog)) error {
	lastID := 0
	for {
		var batch []AuditLog
		if err := LOG_DB.Model(&AuditLog{}).Select("id, success, other").
			Where("id > ? AND created_at >= ? AND created_at < ? AND action IN ?", lastID, start, end, quotaAdjustmentActions).
			Order("id").Limit(adjustmentBatch).Find(&batch).Error; err != nil {
			return err
		}
		for _, log := range batch {
			fn(log)
		}
		if len(batch) < adjustmentBatch {
			return nil
		}
		lastID = batch[len(batch)-1].Id
	}
}

func fillQuotaAdjustments(r InsightsRange, result *FinanceInsights) error {
	var logs []AuditLog
	err := LOG_DB.Model(&AuditLog{}).
		Where("created_at >= ? AND created_at < ? AND action IN ?", r.Start, r.End, quotaAdjustmentActions).
		Order("id desc").Limit(adjustmentListLimit).Find(&logs).Error
	if err != nil {
		return err
	}
	result.AdjustmentLogsFound = len(logs) > 0
	result.Adjustments = make([]QuotaAdjustment, 0, len(logs))
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
			}
		}
		result.Adjustments = append(result.Adjustments, adjustment)
	}
	// The net and the count cover the whole range, not only the listed rows.
	var net, count int64
	if err := eachQuotaAdjustment(r.Start, r.End, func(log AuditLog) {
		count++
		if !log.Success || log.Other.Op == nil {
			return
		}
		before, hasBefore := auditInt(log.Other.Op.Params, "from")
		after, hasAfter := auditInt(log.Other.Op.Params, "to")
		if hasBefore && hasAfter {
			net += after - before
		}
	}); err != nil {
		return err
	}
	result.AdjustmentNetUSD = quotaUSD(net)
	result.AdjustmentsTotal = count
	result.AdjustmentsTruncated = count > adjustmentListLimit
	return nil
}
