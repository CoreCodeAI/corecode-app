package model

import (
	"cmp"
	"math"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// IPCostsOptionKey stores what the egress IPs and proxy hosts cost, as JSON.
// Their bills arrive by hand, from several providers and currencies, so the
// operator records each one rather than the dashboard reading it.
const IPCostsOptionKey = "IPCosts"

// CommissionExemptOptionKey stores, as a JSON list of user ids, the affiliate
// accounts whose commission is not a cost: the site's own promotion accounts,
// which never withdraw it.
const CommissionExemptOptionKey = "CommissionExemptUsers"

const (
	maxIPCosts          = 200
	maxCommissionExempt = 200
)

// IPCost is one egress IP or proxy host: Amount in Currency (CNY or USD)
// every CycleMonths of 30 days, from Start until End, or until now when End
// is zero. A changed price is a new entry starting where the old one ends.
type IPCost struct {
	Name        string  `json:"name"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	CycleMonths int     `json:"cycle_months"`
	Start       int64   `json:"start"`
	End         int64   `json:"end"`
	Note        string  `json:"note"`
}

// costIn is the part of the cost falling in [start, end), in its currency.
func (c IPCost) costIn(start, end int64) float64 {
	from := max(c.Start, start)
	to := end
	if c.End > 0 {
		to = min(c.End, end)
	}
	if to <= from || c.CycleMonths <= 0 {
		return 0
	}
	return c.Amount / float64(c.CycleMonths) * float64(to-from) / channelCostMonth
}

// ipCostsIn is the IP cost over [start, end), the US dollar and yuan entries
// apart, each rounded to cents.
func ipCostsIn(costs []IPCost, start, end int64) (usd, cny float64) {
	for _, cost := range costs {
		if cost.Currency == "USD" {
			usd += cost.costIn(start, end)
		} else {
			cny += cost.costIn(start, end)
		}
	}
	return roundTo(usd, 2), roundTo(cny, 2)
}

// readOptionJSON reads an option row itself rather than the in-memory map, so
// a value saved through one server is counted at once by the other during a
// release. An empty row leaves into untouched.
func readOptionJSON(key string, into any) error {
	var option Option
	if err := DB.Where(commonKeyCol+" = ?", key).Limit(1).Find(&option).Error; err != nil {
		return err
	}
	if strings.TrimSpace(option.Value) == "" {
		return nil
	}
	return common.UnmarshalJsonStr(option.Value, into)
}

// ReadIPCosts returns the stored IP costs.
func ReadIPCosts() ([]IPCost, error) {
	costs := []IPCost{}
	if err := readOptionJSON(IPCostsOptionKey, &costs); err != nil {
		return nil, err
	}
	return costs, nil
}

var errInvalidIPCost error = common.NewMessage("Invalid parameters")

// SaveIPCosts replaces the stored IP costs after checking each one.
func SaveIPCosts(costs []IPCost) error {
	if len(costs) > maxIPCosts {
		return errInvalidIPCost
	}
	for i := range costs {
		cost := &costs[i]
		cost.Name = strings.TrimSpace(cost.Name)
		cost.Note = strings.TrimSpace(cost.Note)
		if cost.Name == "" || len(cost.Name) > 100 || len(cost.Note) > 200 ||
			(cost.Currency != "CNY" && cost.Currency != "USD") ||
			!slices.Contains([]int{1, 3, 6, 12}, cost.CycleMonths) ||
			cost.Start <= 0 || cost.End < 0 || (cost.End > 0 && cost.End <= cost.Start) ||
			math.IsNaN(cost.Amount) || cost.Amount < 0 || cost.Amount > 1e7 {
			return errInvalidIPCost
		}
	}
	slices.SortStableFunc(costs, func(a, b IPCost) int {
		return cmp.Or(cmp.Compare(a.Name, b.Name), cmp.Compare(a.Start, b.Start))
	})
	value, err := common.Marshal(costs)
	if err != nil {
		return err
	}
	return UpdateOption(IPCostsOptionKey, string(value))
}

// ReadCommissionExempt returns the accounts whose commission is not a cost.
func ReadCommissionExempt() ([]int, error) {
	ids := []int{}
	if err := readOptionJSON(CommissionExemptOptionKey, &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

var errInvalidCommissionExempt error = common.NewMessage("Invalid parameters")

// SaveCommissionExempt replaces the accounts whose commission is not a cost.
func SaveCommissionExempt(ids []int) error {
	if len(ids) > maxCommissionExempt {
		return errInvalidCommissionExempt
	}
	for _, id := range ids {
		if id <= 0 {
			return errInvalidCommissionExempt
		}
	}
	slices.Sort(ids)
	value, err := common.Marshal(slices.Compact(ids))
	if err != nil {
		return err
	}
	return UpdateOption(CommissionExemptOptionKey, string(value))
}

// readCommissionExempt names the exempt accounts and sums the commission
// they earned in the range, in quota dollars.
func readCommissionExempt(r InsightsRange, ids []int) ([]UserRef, float64, error) {
	refs := make([]UserRef, 0, len(ids))
	if len(ids) == 0 {
		return refs, 0, nil
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, 0, err
	}
	for _, id := range ids {
		refs = append(refs, UserRef{UserID: id, Username: names[id]})
	}
	var earned struct{ Total int64 }
	if err := DB.Model(&AffiliateCommission{}).Select("COALESCE(SUM(amount), 0) AS total").
		Where("created_at >= ? AND created_at < ? AND user_id IN ?", r.Start, r.End, ids).Scan(&earned).Error; err != nil {
		return nil, 0, err
	}
	return refs, quotaUSD(earned.Total), nil
}

// PaymentFeeRatesOptionKey stores, as JSON, what each payment method's
// processor keeps of an order. An empty row means defaultPaymentFeeRates.
const PaymentFeeRatesOptionKey = "PaymentFeeRates"

const maxPaymentFeeRates = 50

// PaymentFeeRate is what the processor of one payment method keeps of an
// order: Percent of its money plus Fixed yuan.
type PaymentFeeRate struct {
	Method  string  `json:"method"`
	Percent float64 `json:"percent"`
	Fixed   float64 `json:"fixed"`
}

// defaultPaymentFeeRates are the rates measured in November 2026. Epay keeps
// 8% of each order and 0.1% of the daily settlement. Stripe's Hong Kong
// account keeps 2.2% + HK$2 of an Alipay or WeChat Pay charge and 3.4% +
// HK$2.35 + 0.5% abroad of a card charge, at about ¥0.92 a Hong Kong dollar.
// On-chain deposits and offline transfers cost nothing.
var defaultPaymentFeeRates = []PaymentFeeRate{
	{Method: "alipay", Percent: 8.11},
	{Method: "wxpay", Percent: 8.11},
	{Method: "stripe", Percent: 2.2, Fixed: 1.84},
	{Method: "stripe_alipay", Percent: 2.2, Fixed: 1.84},
	{Method: "stripe_wechat_pay", Percent: 2.2, Fixed: 1.84},
	{Method: "stripe_card", Percent: 3.9, Fixed: 2.16},
	{Method: "chain_deposit"},
	{Method: "offline"},
}

// ReadPaymentFeeRates returns the stored rates, or the defaults when none
// are stored.
func ReadPaymentFeeRates() ([]PaymentFeeRate, error) {
	rates := []PaymentFeeRate{}
	if err := readOptionJSON(PaymentFeeRatesOptionKey, &rates); err != nil {
		return nil, err
	}
	if len(rates) == 0 {
		return slices.Clone(defaultPaymentFeeRates), nil
	}
	return rates, nil
}

var errInvalidPaymentFeeRate error = common.NewMessage("Invalid parameters")

// SavePaymentFeeRates replaces the stored rates after checking each one. An
// empty list restores the defaults.
func SavePaymentFeeRates(rates []PaymentFeeRate) error {
	if len(rates) > maxPaymentFeeRates {
		return errInvalidPaymentFeeRate
	}
	seen := make(map[string]bool, len(rates))
	for i := range rates {
		rate := &rates[i]
		rate.Method = strings.TrimSpace(rate.Method)
		if rate.Method == "" || len(rate.Method) > 50 || seen[rate.Method] ||
			math.IsNaN(rate.Percent) || rate.Percent < 0 || rate.Percent > 50 ||
			math.IsNaN(rate.Fixed) || rate.Fixed < 0 || rate.Fixed > 1000 {
			return errInvalidPaymentFeeRate
		}
		seen[rate.Method] = true
	}
	slices.SortFunc(rates, func(a, b PaymentFeeRate) int { return cmp.Compare(a.Method, b.Method) })
	value, err := common.Marshal(rates)
	if err != nil {
		return err
	}
	return UpdateOption(PaymentFeeRatesOptionKey, string(value))
}

// PaymentFee is what one payment method's processor kept of the orders paid
// in the range. Orders and Money count the orders still paid; Refunded counts
// those refunded since, whose fee the processor keeps too. Priced is false
// for a method with no recorded rate, whose fee counts as nothing.
type PaymentFee struct {
	Method   string  `json:"method"`
	Orders   int64   `json:"orders"`
	Money    float64 `json:"money"`
	Refunded int64   `json:"refunded"`
	Fee      float64 `json:"fee"`
	Priced   bool    `json:"priced"`
}

// readPaymentFees prices the orders paid in the range, wallet orders left out,
// by method, the largest fee first. Money is in the payment currency, yuan.
func readPaymentFees(r InsightsRange, rates []PaymentFeeRate) ([]PaymentFee, error) {
	var rows []struct {
		PaymentMethod string
		Status        string
		Orders        int64
		Money         float64
	}
	if err := DB.Model(&TopUp{}).
		Select("payment_method, status, COUNT(*) AS orders, COALESCE(SUM(money), 0) AS money").
		Where("create_time >= ? AND create_time < ? AND status IN ? AND (payment_provider IS NULL OR payment_provider <> ?)",
			r.Start, r.End, []string{common.TopUpStatusSuccess, common.TopUpStatusRefunded}, PaymentProviderBalance).
		Group("payment_method, status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	byMethod := make(map[string]PaymentFeeRate, len(rates))
	for _, rate := range rates {
		byMethod[rate.Method] = rate
	}
	fees := map[string]*PaymentFee{}
	for _, row := range rows {
		fee := fees[row.PaymentMethod]
		if fee == nil {
			_, priced := byMethod[row.PaymentMethod]
			fee = &PaymentFee{Method: row.PaymentMethod, Priced: priced}
			fees[row.PaymentMethod] = fee
		}
		if row.Status == common.TopUpStatusSuccess {
			fee.Orders += row.Orders
			fee.Money += row.Money
		} else {
			fee.Refunded += row.Orders
		}
		rate := byMethod[row.PaymentMethod]
		fee.Fee += row.Money*rate.Percent/100 + float64(row.Orders)*rate.Fixed
	}
	list := make([]PaymentFee, 0, len(fees))
	for _, fee := range fees {
		fee.Money, fee.Fee = roundTo(fee.Money, 2), roundTo(fee.Fee, 2)
		list = append(list, *fee)
	}
	slices.SortFunc(list, func(a, b PaymentFee) int {
		return cmp.Or(cmp.Compare(b.Fee, a.Fee), cmp.Compare(b.Money, a.Money), cmp.Compare(a.Method, b.Method))
	})
	return list, nil
}
