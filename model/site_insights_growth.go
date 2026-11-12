package model

import (
	"cmp"
	"slices"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// FunnelRow is one segment of the sign-up funnel. Activated users sent at
// least one request; paid users completed a gateway order; repeat users
// completed two or more.
type FunnelRow struct {
	Segment    string `json:"segment"`
	Registered int64  `json:"registered"`
	Activated  int64  `json:"activated"`
	Paid       int64  `json:"paid"`
	Repeat     int64  `json:"repeat"`
}

// GrowthDay is one day of sign-ups and of what those sign-ups went on to do.
type GrowthDay struct {
	Day        int64 `json:"day"`
	Registered int64 `json:"registered"`
	Activated  int64 `json:"activated"`
	Paid       int64 `json:"paid"`
}

// GrowthHour is one sign-up hour of the GrowthDay figures.
type GrowthHour struct {
	Hour       int64 `json:"hour"`
	Registered int64 `json:"registered"`
	Activated  int64 `json:"activated"`
	Paid       int64 `json:"paid"`
}

// GrowthInsights follows the accounts created in the range through the
// funnel, up to now. Hourly is every UTC hour of a range up to
// insightsHourlySpan.
type GrowthInsights struct {
	Funnel   FunnelRow    `json:"funnel"`
	BySource []FunnelRow  `json:"by_source"`
	ByInvite []FunnelRow  `json:"by_invite"`
	Daily    []GrowthDay  `json:"daily"`
	Hourly   []GrowthHour `json:"hourly,omitempty"`
	// SubscriptionToTopup counts plan buyers among the cohort who later
	// topped up the wallet too: how many trial buyers converted.
	SubscriptionBuyers  int64 `json:"subscription_buyers"`
	SubscriptionToTopup int64 `json:"subscription_to_topup"`
}

func GetGrowthInsights(r InsightsRange) (*GrowthInsights, error) {
	users, err := readRiskUsers(func(tx *gorm.DB) *gorm.DB {
		return tx.Where("created_at >= ? AND created_at < ? AND role < ?", r.Start, r.End, common.RoleRootUser)
	})
	if err != nil {
		return nil, err
	}
	ids := make([]int, 0, len(users))
	for _, user := range users {
		ids = append(ids, user.Id)
	}
	orders, err := readPaidOrders(0, 0)
	if err != nil {
		return nil, err
	}
	cohort := make(map[int]bool, len(ids))
	for _, id := range ids {
		cohort[id] = true
	}
	paidOrders := make(map[int]int)
	boughtPlan := make(map[int]bool)
	toppedUp := make(map[int]bool)
	for _, order := range orders {
		if !cohort[order.UserId] || order.Money <= 0 {
			continue
		}
		paidOrders[order.UserId]++
		if order.Subscription {
			boughtPlan[order.UserId] = true
		} else {
			toppedUp[order.UserId] = true
		}
	}

	result := &GrowthInsights{Funnel: FunnelRow{Segment: "all"}}
	sources := make(map[string]*FunnelRow)
	invites := map[string]*FunnelRow{"invited": {Segment: "invited"}, "organic": {Segment: "organic"}}
	days := make(map[int64]*GrowthDay)
	for _, day := range r.days() {
		days[day] = &GrowthDay{Day: day}
	}
	hourStarts := r.hourStarts()
	hourly := make(map[int64]*GrowthHour, len(hourStarts))
	for _, start := range hourStarts {
		hourly[start] = &GrowthHour{Hour: start}
	}
	add := func(row *FunnelRow, activated, paid, repeat bool) {
		row.Registered++
		if activated {
			row.Activated++
		}
		if paid {
			row.Paid++
		}
		if repeat {
			row.Repeat++
		}
	}
	for _, user := range users {
		activated := user.RequestCount > 0
		paid := paidOrders[user.Id] > 0
		repeat := paidOrders[user.Id] > 1
		add(&result.Funnel, activated, paid, repeat)
		method := signupMethod(user)
		if sources[method] == nil {
			sources[method] = &FunnelRow{Segment: method}
		}
		add(sources[method], activated, paid, repeat)
		invite := "organic"
		if user.InviterId > 0 {
			invite = "invited"
		}
		add(invites[invite], activated, paid, repeat)
		if day := days[r.DayStart(user.CreatedAt)]; day != nil {
			day.Registered++
			if activated {
				day.Activated++
			}
			if paid {
				day.Paid++
			}
		}
		if hour := hourly[insightHourKey(user.CreatedAt)]; hour != nil {
			hour.Registered++
			if activated {
				hour.Activated++
			}
			if paid {
				hour.Paid++
			}
		}
		if boughtPlan[user.Id] {
			result.SubscriptionBuyers++
			if toppedUp[user.Id] {
				result.SubscriptionToTopup++
			}
		}
	}
	for _, row := range sources {
		result.BySource = append(result.BySource, *row)
	}
	slices.SortFunc(result.BySource, func(a, b FunnelRow) int {
		return cmp.Or(cmp.Compare(b.Registered, a.Registered), cmp.Compare(a.Segment, b.Segment))
	})
	result.ByInvite = []FunnelRow{*invites["organic"], *invites["invited"]}
	for _, day := range days {
		result.Daily = append(result.Daily, *day)
	}
	slices.SortFunc(result.Daily, func(a, b GrowthDay) int { return cmp.Compare(a.Day, b.Day) })
	for _, start := range hourStarts {
		result.Hourly = append(result.Hourly, *hourly[start])
	}
	return result, nil
}

// ActivityDay is one day of active users and consumption. ClaudeQuotaUSD is
// the part of QuotaUSD charged for Claude models (VendorClaude).
type ActivityDay struct {
	Day            int64   `json:"day"`
	DAU            int64   `json:"dau"`
	WAU            int64   `json:"wau"`
	Requests       int64   `json:"requests"`
	QuotaUSD       float64 `json:"quota_usd"`
	ClaudeQuotaUSD float64 `json:"claude_quota_usd"`
}

// ActivityHour is one hour of customers' activity: who sent requests, how
// many, and their list-price cost in USD, as on ActivityDay.
type ActivityHour struct {
	Hour        int64   `json:"hour"`
	ActiveUsers int64   `json:"active_users"`
	Requests    int64   `json:"requests"`
	QuotaUSD    float64 `json:"quota_usd"`
}

// RetentionCohort is the share of one day's sign-ups active on each of the
// following days; Days[0] is the sign-up day. Days past now are left out.
type RetentionCohort struct {
	Day  int64     `json:"day"`
	Size int64     `json:"size"`
	Days []float64 `json:"days"`
}

// UserSpend is one user's consumption in the range.
type UserSpend struct {
	UserRef
	QuotaUSD float64 `json:"quota_usd"`
	Requests int64   `json:"requests"`
	Share    float64 `json:"share"`
}

// ActivityInsights reads the hourly quota_data aggregates, customers only:
// root's rows are left out of every figure, as on the capacity and funds
// views, and its consumption is RootQuotaUSD. A user is active in a span when
// a request of theirs came back with usage (tokens or a charge); Requests
// counts every logged request, those without usage included.
// ClaudeQuotaUSD is the part of QuotaUSD charged for Claude models. Hourly is
// every UTC hour of a range up to insightsHourlySpan.
type ActivityInsights struct {
	ActiveUsers    int64             `json:"active_users"`
	QuotaUSD       float64           `json:"quota_usd"`
	ClaudeQuotaUSD float64           `json:"claude_quota_usd"`
	RootQuotaUSD   float64           `json:"root_quota_usd"`
	Requests       int64             `json:"requests"`
	Daily          []ActivityDay     `json:"daily"`
	Hourly         []ActivityHour    `json:"hourly,omitempty"`
	Retention      []RetentionCohort `json:"retention"`
	TopUsers       []UserSpend       `json:"top_users"`
	Top1Share      float64           `json:"top1_share"`
	Top3Share      float64           `json:"top3_share"`
	Top10Share     float64           `json:"top10_share"`
}

const retentionDays = 14

func GetActivityInsights(r InsightsRange) (*ActivityInsights, error) {
	// WAU on the first day needs the six days before it.
	rows, err := readInsightQuota(r.DayStart(r.Start)-6*86400, r.End)
	if err != nil {
		return nil, err
	}
	activeByDay := make(map[int64]map[int]bool)
	result := &ActivityInsights{}
	days := make(map[int64]*ActivityDay)
	for _, day := range r.days() {
		days[day] = &ActivityDay{Day: day}
	}
	hourStarts := r.hourStarts()
	hourly := make(map[int64]*ActivityHour, len(hourStarts))
	activeByHour := make(map[int64]map[int]bool, len(hourStarts))
	for _, start := range hourStarts {
		hourly[start] = &ActivityHour{Hour: start}
		activeByHour[start] = make(map[int]bool)
	}
	roots, err := RootUserIDs()
	if err != nil {
		return nil, err
	}
	spend := make(map[int]*UserSpend)
	active := make(map[int]bool)
	var total, claude, rootQuota int64
	for _, row := range rows {
		if slices.Contains(roots, row.UserID) {
			if row.CreatedAt >= r.Start {
				rootQuota += int64(row.Quota)
			}
			continue
		}
		used := row.Quota > 0 || row.TokenUsed > 0
		day := r.DayStart(row.CreatedAt)
		if used {
			if activeByDay[day] == nil {
				activeByDay[day] = make(map[int]bool)
			}
			activeByDay[day][row.UserID] = true
		}
		if row.CreatedAt < r.Start {
			continue
		}
		if used {
			active[row.UserID] = true
		}
		isClaude := ModelVendor(row.ModelName) == VendorClaude
		total += int64(row.Quota)
		if isClaude {
			claude += int64(row.Quota)
		}
		result.Requests += int64(row.Count)
		if bucket := days[day]; bucket != nil {
			bucket.Requests += int64(row.Count)
			bucket.QuotaUSD += float64(row.Quota)
			if isClaude {
				bucket.ClaudeQuotaUSD += float64(row.Quota)
			}
		}
		if hour := hourly[insightHourKey(row.CreatedAt)]; hour != nil {
			if used {
				activeByHour[hour.Hour][row.UserID] = true
			}
			hour.Requests += int64(row.Count)
			hour.QuotaUSD += float64(row.Quota)
		}
		user := spend[row.UserID]
		if user == nil {
			user = &UserSpend{UserRef: UserRef{UserID: row.UserID, Username: row.Username}}
			spend[row.UserID] = user
		}
		user.QuotaUSD += float64(row.Quota)
		user.Requests += int64(row.Count)
	}
	result.ActiveUsers = int64(len(active))
	result.QuotaUSD = quotaUSD(total)
	result.ClaudeQuotaUSD = quotaUSD(claude)
	result.RootQuotaUSD = quotaUSD(rootQuota)
	for day, bucket := range days {
		bucket.DAU = int64(len(activeByDay[day]))
		week := make(map[int]bool)
		for back := int64(0); back < 7; back++ {
			for id := range activeByDay[day-back*86400] {
				week[id] = true
			}
		}
		bucket.WAU = int64(len(week))
		bucket.QuotaUSD = quotaUSD(int64(bucket.QuotaUSD))
		bucket.ClaudeQuotaUSD = quotaUSD(int64(bucket.ClaudeQuotaUSD))
		result.Daily = append(result.Daily, *bucket)
	}
	slices.SortFunc(result.Daily, func(a, b ActivityDay) int { return cmp.Compare(a.Day, b.Day) })
	for _, start := range hourStarts {
		hour := hourly[start]
		hour.ActiveUsers = int64(len(activeByHour[start]))
		hour.QuotaUSD = quotaUSD(int64(hour.QuotaUSD))
		result.Hourly = append(result.Hourly, *hour)
	}

	users := make([]UserSpend, 0, len(spend))
	for _, user := range spend {
		user.Share = ratio(user.QuotaUSD, float64(total))
		user.QuotaUSD = quotaUSD(int64(user.QuotaUSD))
		users = append(users, *user)
	}
	slices.SortFunc(users, func(a, b UserSpend) int { return cmp.Compare(b.QuotaUSD, a.QuotaUSD) })
	topShare := func(n int) float64 {
		var share float64
		for _, user := range users[:min(n, len(users))] {
			share += user.Share
		}
		return roundTo(share, 4)
	}
	result.Top1Share, result.Top3Share, result.Top10Share = topShare(1), topShare(3), topShare(10)
	result.TopUsers = users[:min(len(users), insightsTopN*2)]

	retention, err := retentionCohorts(r, activeByDay)
	if err != nil {
		return nil, err
	}
	result.Retention = retention
	return result, nil
}

// retentionCohorts groups the range's sign-ups by day, newest 30 days at
// most, and reads their activity from activeByDay.
func retentionCohorts(r InsightsRange, activeByDay map[int64]map[int]bool) ([]RetentionCohort, error) {
	start := max(r.Start, r.DayStart(r.End)-29*86400)
	var users []struct {
		Id        int
		CreatedAt int64
	}
	if err := DB.Model(&User{}).Select("id, created_at").
		Where("created_at >= ? AND created_at < ? AND role < ?", start, r.End, common.RoleRootUser).Find(&users).Error; err != nil {
		return nil, err
	}
	members := make(map[int64][]int)
	for _, user := range users {
		day := r.DayStart(user.CreatedAt)
		members[day] = append(members[day], user.Id)
	}
	today := r.DayStart(r.End - 1)
	result := make([]RetentionCohort, 0, len(members))
	for day, ids := range members {
		cohort := RetentionCohort{Day: day, Size: int64(len(ids))}
		for offset := int64(0); offset < retentionDays && day+offset*86400 <= today; offset++ {
			activeIDs := activeByDay[day+offset*86400]
			var count int64
			for _, id := range ids {
				if activeIDs[id] {
					count++
				}
			}
			cohort.Days = append(cohort.Days, ratio(float64(count), float64(len(ids))))
		}
		result = append(result, cohort)
	}
	slices.SortFunc(result, func(a, b RetentionCohort) int { return cmp.Compare(b.Day, a.Day) })
	return result, nil
}
