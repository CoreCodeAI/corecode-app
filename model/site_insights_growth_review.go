package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// The figures of the growth and activity views that a business review reads
// beside the daily series: money paid by day, how long paying accounts have been
// silent, sign-up weeks followed week by week, and customers split by what they
// spent. Each is built from reads the views already make, or from one small
// read of its own.

// GrowthTopupDay is the money paid on one day of the range, by the day the order
// was paid. Money is every paid order in the payment currency, PlanMoney the
// part spent on plans, and Payers the accounts that paid on the day. Staff
// payments are left out, as the funnel leaves staff out.
type GrowthTopupDay struct {
	Day       int64   `json:"day"`
	Money     float64 `json:"money"`
	PlanMoney float64 `json:"plan_money"`
	Payers    int64   `json:"payers"`
}

// growthTopups sums the customers' paid orders (money above zero) by day over
// every day of the range, so a day with no order reads zero.
func growthTopups(r InsightsRange, orders []paidOrder, staff []int) []GrowthTopupDay {
	skip := make(map[int]bool, len(staff))
	for _, id := range staff {
		skip[id] = true
	}
	days := make(map[int64]*GrowthTopupDay)
	for _, day := range r.days() {
		days[day] = &GrowthTopupDay{Day: day}
	}
	payers := make(map[int64]map[int]bool)
	for _, order := range orders {
		if order.Money <= 0 || skip[order.UserId] || order.CreateTime < r.Start || order.CreateTime >= r.End {
			continue
		}
		day := days[r.DayStart(order.CreateTime)]
		if day == nil {
			continue
		}
		day.Money += order.Money
		if order.Subscription {
			day.PlanMoney += order.Money
		}
		if payers[day.Day] == nil {
			payers[day.Day] = make(map[int]bool)
		}
		payers[day.Day][order.UserId] = true
	}
	result := make([]GrowthTopupDay, 0, len(days))
	for _, day := range days {
		day.Money = roundTo(day.Money, 2)
		day.PlanMoney = roundTo(day.PlanMoney, 2)
		day.Payers = int64(len(payers[day.Day]))
		result = append(result, *day)
	}
	slices.SortFunc(result, func(a, b GrowthTopupDay) int { return cmp.Compare(a.Day, b.Day) })
	return result
}

// Buckets of SilentPayers, by whole days since an account last spent quota.
// Never is an account that has never sent a request.
const (
	SilentWithinDay  = "within_1d"
	SilentDays1To3   = "days_1_3"
	SilentDays4To7   = "days_4_7"
	SilentDays8To14  = "days_8_14"
	SilentDays15To30 = "days_15_30"
	SilentDays31To60 = "days_31_60"
	SilentOver60     = "over_60"
	SilentNever      = "never"
)

// SilentPayers spreads the customers who paid before the range's end by how
// long ago their keys last spent quota, counted from now. Buckets lists every
// bucket in order, empty ones included. The time is the latest accessed_time
// among the account's keys: a key's use writes it with the charge, so it is the
// time of the last charged request, and an account that deleted its keys has
// lost it and is counted as silent for over 60 days.
type SilentPayers struct {
	Payers  int64        `json:"payers"`
	Buckets []NamedCount `json:"buckets"`
}

func silentBucket(daysSince int64) string {
	switch {
	case daysSince < 1:
		return SilentWithinDay
	case daysSince <= 3:
		return SilentDays1To3
	case daysSince <= 7:
		return SilentDays4To7
	case daysSince <= 14:
		return SilentDays8To14
	case daysSince <= 30:
		return SilentDays15To30
	case daysSince <= 60:
		return SilentDays31To60
	default:
		return SilentOver60
	}
}

var silentBuckets = []string{SilentWithinDay, SilentDays1To3, SilentDays4To7, SilentDays8To14,
	SilentDays15To30, SilentDays31To60, SilentOver60, SilentNever}

func readSilentPayers(r InsightsRange, firstPaid map[int]int64, now int64) (SilentPayers, error) {
	var payers []int
	for id, first := range firstPaid {
		if first < r.End {
			payers = append(payers, id)
		}
	}
	counts := make(map[string]int64, len(silentBuckets))
	var total int64
	for chunk := range slices.Chunk(payers, sharedAddressChunk) {
		var customers []struct {
			Id           int
			RequestCount int
		}
		if err := DB.Model(&User{}).Select("id, request_count").
			Where("id IN ? AND role < ?", chunk, customerRoleBound).Find(&customers).Error; err != nil {
			return SilentPayers{}, err
		}
		ids := make([]int, 0, len(customers))
		for _, customer := range customers {
			ids = append(ids, customer.Id)
		}
		var tokens []struct {
			UserId   int
			Accessed int64
		}
		if len(ids) > 0 {
			if err := DB.Model(&Token{}).Select("user_id, MAX(accessed_time) AS accessed").
				Where("user_id IN ?", ids).Group("user_id").Find(&tokens).Error; err != nil {
				return SilentPayers{}, err
			}
		}
		accessed := make(map[int]int64, len(tokens))
		for _, token := range tokens {
			accessed[token.UserId] = token.Accessed
		}
		for _, customer := range customers {
			total++
			if customer.RequestCount == 0 {
				counts[SilentNever]++
				continue
			}
			last := accessed[customer.Id]
			if last <= 0 {
				counts[SilentOver60]++
				continue
			}
			counts[silentBucket(max(now-last, 0)/86400)]++
		}
	}
	result := SilentPayers{Payers: total, Buckets: make([]NamedCount, 0, len(silentBuckets))}
	for _, name := range silentBuckets {
		result.Buckets = append(result.Buckets, NamedCount{Name: name, Count: counts[name]})
	}
	return result, nil
}

// RetentionWeek is the sign-ups of one week, and how many of them spent quota
// in that week and in each later one: Active[0] is the sign-up week, Active[n]
// the nth week after it. A week counts a user once however many days they were
// active. Weeks start on Monday in the viewer's time zone. Partial marks a week
// whose sign-ups are not all in the range (the range began inside it) or are
// still arriving (it is the current week). Activated and Paid narrow the same
// sign-ups as RetentionCohort does, each with its own counts.
type RetentionWeek struct {
	Week      int64            `json:"week"`
	Size      int64            `json:"size"`
	Partial   bool             `json:"partial"`
	Active    []int64          `json:"active"`
	Activated RetentionSegment `json:"activated"`
	Paid      RetentionSegment `json:"paid"`
}

// retentionWeekCount is how many sign-up weeks the weekly retention reports, the
// current one included.
const retentionWeekCount = 12

// retentionSignups is the sign-ups the retention views follow, and when each
// account that has paid first did.
type retentionSignups struct {
	users     []riskUserRow
	firstPaid map[int]int64
}

// weekStart is the Monday of the viewer's week containing the viewer's day
// that starts at day.
func (r InsightsRange) weekStart(day int64) int64 {
	local := day + r.Offset
	days := local / 86400
	if local%86400 < 0 {
		days--
	}
	weekday := ((days+3)%7 + 7) % 7
	return day - weekday*86400
}

// readRetentionSignups reads the customers who signed up in the newest
// retentionWeekCount weeks of the range, and every account that has paid.
func readRetentionSignups(r InsightsRange) (retentionSignups, error) {
	start := max(r.Start, r.weekStart(r.DayStart(r.End-1))-(retentionWeekCount-1)*7*86400)
	users, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB {
		return tx.Where("created_at >= ? AND created_at < ? AND role < ?", start, r.End, customerRoleBound)
	})
	if err != nil {
		return retentionSignups{}, err
	}
	orders, err := readPaidOrders(0, 0)
	if err != nil {
		return retentionSignups{}, err
	}
	return retentionSignups{users: users, firstPaid: firstPaidTimes(orders)}, nil
}

// retentionWeeks groups the sign-ups by week, newest week first, and counts
// from activeByDay the users with usage in each week from the sign-up week on,
// up to the current one.
func retentionWeeks(r InsightsRange, activeByDay map[int64]map[int]bool, signups retentionSignups) []RetentionWeek {
	type cohort struct{ ids, activated, paid []int }
	weeks := make(map[int64]*cohort)
	for _, user := range signups.users {
		week := r.weekStart(r.DayStart(user.CreatedAt))
		if weeks[week] == nil {
			weeks[week] = &cohort{}
		}
		members := weeks[week]
		members.ids = append(members.ids, user.Id)
		if user.RequestCount > 0 {
			members.activated = append(members.activated, user.Id)
		}
		if hasPaid(signups, user.Id) {
			members.paid = append(members.paid, user.Id)
		}
	}
	firstDay := r.DayStart(r.Start)
	thisWeek := r.weekStart(r.DayStart(r.End - 1))
	result := make([]RetentionWeek, 0, len(weeks))
	for week, members := range weeks {
		row := RetentionWeek{
			Week:      week,
			Size:      int64(len(members.ids)),
			Partial:   week < firstDay || week >= thisWeek,
			Activated: RetentionSegment{Size: int64(len(members.activated))},
			Paid:      RetentionSegment{Size: int64(len(members.paid))},
		}
		for later := week; later <= thisWeek; later += 7 * 86400 {
			seen := make(map[int]bool)
			for day := later; day < later+7*86400 && day < r.End; day += 86400 {
				for id := range activeByDay[day] {
					seen[id] = true
				}
			}
			row.Active = append(row.Active, countActive(seen, members.ids))
			row.Activated.Active = append(row.Activated.Active, countActive(seen, members.activated))
			row.Paid.Active = append(row.Paid.Active, countActive(seen, members.paid))
		}
		result = append(result, row)
	}
	slices.SortFunc(result, func(a, b RetentionWeek) int { return cmp.Compare(b.Week, a.Week) })
	return result
}

// SpendTier is one band of customers by what they spent in the range, in quota
// dollars (what new-api charged, ¥1 each): Users spent at least FloorUSD and
// less than the band above, and QuotaUSD is what they spent between them.
type SpendTier struct {
	Tier     string  `json:"tier"`
	FloorUSD float64 `json:"floor_usd"`
	Users    int64   `json:"users"`
	QuotaUSD float64 `json:"quota_usd"`
}

// SpendTierGroup is the bands for one vendor group: "all" counts every model,
// "claude", "gpt" and "other" only that group's models, so a customer is in a
// band by what they spent on that group alone.
type SpendTierGroup struct {
	Vendor string      `json:"vendor"`
	Tiers  []SpendTier `json:"tiers"`
}

// The bands, richest first, by floor in quota dollars. A customer who spent
// nothing is in no band.
var spendTierBands = []SpendTier{
	{Tier: "whale", FloorUSD: 500},
	{Tier: "large", FloorUSD: 100},
	{Tier: "mid", FloorUSD: 10},
	{Tier: "tail", FloorUSD: 0},
}

// The vendor groups of SpendTiers, in order.
var spendTierVendors = []string{"all", "claude", "gpt", "other"}

// spendGroup is the group of SpendTiers a model's spend counts in.
func spendGroup(modelName string) string {
	switch ModelVendor(modelName) {
	case VendorClaude:
		return "claude"
	case VendorCodex:
		return "gpt"
	default:
		return "other"
	}
}

// vendorSpend is each customer's quota by vendor group.
type vendorSpend map[string]map[int]int64

func newVendorSpend() vendorSpend {
	spend := make(vendorSpend, len(spendTierVendors))
	for _, vendor := range spendTierVendors {
		spend[vendor] = make(map[int]int64)
	}
	return spend
}

func (s vendorSpend) add(userID int, modelName string, quota int64) {
	s["all"][userID] += quota
	s[spendGroup(modelName)][userID] += quota
}

// tiers bands each vendor group's customers.
func (s vendorSpend) tiers() []SpendTierGroup {
	groups := make([]SpendTierGroup, 0, len(spendTierVendors))
	for _, vendor := range spendTierVendors {
		bands := slices.Clone(spendTierBands)
		for _, quota := range s[vendor] {
			if quota <= 0 {
				continue
			}
			dollars := float64(quota) / common.QuotaPerUnit
			for i := range bands {
				if dollars >= bands[i].FloorUSD {
					bands[i].Users++
					bands[i].QuotaUSD += float64(quota)
					break
				}
			}
		}
		for i := range bands {
			bands[i].QuotaUSD = quotaUSD(int64(bands[i].QuotaUSD))
		}
		groups = append(groups, SpendTierGroup{Vendor: vendor, Tiers: bands})
	}
	return groups
}

func hasPaid(signups retentionSignups, id int) bool {
	_, ok := signups.firstPaid[id]
	return ok
}
