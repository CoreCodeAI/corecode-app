package service

import (
	"cmp"
	"math"
	"slices"

	"github.com/QuantumNous/new-api/model"
)

// EnginePlanValue is what one plan's accounts serve in a full week at
// official prices. Only accounts calibrated from their own requests count:
// a peer capacity is the median of other accounts, not a measurement.
type EnginePlanValue struct {
	Plan     string `json:"plan"`
	Tier     string `json:"tier"`
	Accounts int    `json:"accounts"`
	Measured int    `json:"measured"`
	// WeekUSD is the median measured account; Low and High the extremes.
	WeekUSD     float64 `json:"week_usd"`
	WeekLowUSD  float64 `json:"week_low_usd"`
	WeekHighUSD float64 `json:"week_high_usd"`
}

// EnginePlanValues groups the pool's accounts by plan and tier and keeps the
// groups with at least one measured weekly capacity, smallest first.
func EnginePlanValues(accounts []EngineAccount) []EnginePlanValue {
	type key struct{ plan, tier string }
	totals := make(map[key]int)
	capacities := make(map[key][]float64)
	for _, account := range accounts {
		group := key{account.Plan, account.Tier}
		totals[group]++
		capacity := account.SevenDayCapacityUSD
		source := account.SevenDayCapacitySource
		if capacity == nil || *capacity <= 0 || math.IsInf(*capacity, 0) || (source != "measured" && source != "recent") {
			continue
		}
		capacities[group] = append(capacities[group], *capacity)
	}
	plans := []EnginePlanValue{}
	for group, values := range capacities {
		slices.Sort(values)
		middle := len(values) / 2
		median := values[middle]
		if len(values)%2 == 0 {
			median = (values[middle-1] + values[middle]) / 2
		}
		plans = append(plans, EnginePlanValue{
			Plan: group.plan, Tier: group.tier, Accounts: totals[group], Measured: len(values),
			WeekUSD: median, WeekLowUSD: values[0], WeekHighUSD: values[len(values)-1],
		})
	}
	slices.SortFunc(plans, func(a, b EnginePlanValue) int {
		return cmp.Or(cmp.Compare(a.WeekUSD, b.WeekUSD), cmp.Compare(a.Plan, b.Plan), cmp.Compare(a.Tier, b.Tier))
	})
	return plans
}

// EnginePlanCount is how many of the pool's accounts hold one plan and tier
// for one vendor, whatever their status: an account costs its plan's price
// while it is listed. Vendor is the vendor its group's channel serves
// (ChannelProvider), empty for an account outside every group.
type EnginePlanCount struct {
	Vendor   string `json:"vendor"`
	Plan     string `json:"plan"`
	Tier     string `json:"tier"`
	Accounts int    `json:"accounts"`
	Eligible int    `json:"eligible"`
}

// EnginePlanCounts counts the pool's accounts by vendor, plan and tier.
func EnginePlanCounts(pool EnginePool) []EnginePlanCount {
	channels := make(map[int]string, len(pool.Groups))
	for _, group := range pool.Groups {
		channels[group.ID] = group.Channel
	}
	type key struct{ vendor, plan, tier string }
	index := make(map[key]int)
	counts := []EnginePlanCount{}
	for _, account := range pool.Accounts {
		vendor := ""
		if channel, ok := channels[account.GroupID]; ok {
			vendor = ChannelProvider(channel)
		}
		group := key{vendor, account.Plan, account.Tier}
		at, ok := index[group]
		if !ok {
			at = len(counts)
			index[group] = at
			counts = append(counts, EnginePlanCount{Vendor: vendor, Plan: account.Plan, Tier: account.Tier})
		}
		counts[at].Accounts++
		if account.Eligible {
			counts[at].Eligible++
		}
	}
	slices.SortFunc(counts, func(a, b EnginePlanCount) int {
		return cmp.Or(cmp.Compare(a.Vendor, b.Vendor), cmp.Compare(a.Plan, b.Plan), cmp.Compare(a.Tier, b.Tier))
	})
	return counts
}

// MatchedSince is where the engine's reported days begin within [start, end):
// the earliest reported day, not before start, or end when it reported none.
func MatchedSince(start, end int64, cost EngineDailyCost) int64 {
	since := end
	for _, day := range cost.Daily {
		since = min(since, day.Day)
	}
	return max(start, since)
}

// MatchClaudeCost sums the engine's official-price Claude cost and what
// new-api charged for Claude over the days the engine reported, so a day the
// engine no longer keeps does not count on one side only.
func MatchClaudeCost(daily []model.FinanceDay, cost EngineDailyCost) (official float64, charged float64) {
	reported := make(map[int64]float64, len(cost.Daily))
	for _, day := range cost.Daily {
		reported[day.Day] += day.CostUSD
	}
	for _, day := range daily {
		if usd, ok := reported[day.Day]; ok {
			official += usd
			charged += day.ClaudeUSD
		}
	}
	return official, charged
}

// EngineUsageTotal is official-price usage summed over some accounts. Accounts
// counts the distinct credentials; it is zero for the unattributed row.
type EngineUsageTotal struct {
	Accounts  int     `json:"accounts"`
	Requests  int64   `json:"requests"`
	Failures  int64   `json:"failures"`
	ServedUSD float64 `json:"served_usd"`
}

// EnginePlanUsageRow is one plan and tier of the pool with what its accounts
// served over the range. Accounts with no usage in the range are listed with
// zeros. AddedInRange counts the served accounts whose credential was created
// after the range began.
type EnginePlanUsageRow struct {
	Plan string `json:"plan"`
	Tier string `json:"tier"`
	EngineUsageTotal
	AddedInRange int `json:"added_in_range"`
}

// EnginePlanUsage splits what the engine served over a range by plan and tier.
// Removed is the usage of credentials no longer in the pool; Unattributed is
// the usage the engine did not tie to an account. The rows and both extra
// totals add up to the engine's total for the same window.
type EnginePlanUsage struct {
	Plans        []EnginePlanUsageRow `json:"plans"`
	Removed      EngineUsageTotal     `json:"removed"`
	Unattributed EngineUsageTotal     `json:"unattributed"`
}

// EnginePlanUsageByCredential joins per-credential usage to the plan and tier of
// the pool's accounts by credential id; a credential in several groups counts
// once. startMS is the range's start, for AddedInRange.
func EnginePlanUsageByCredential(accounts []EngineAccount, usage EngineCredentialUsage, startMS int64) EnginePlanUsage {
	type key struct{ plan, tier string }
	planOf := make(map[int64]key, len(accounts))
	rows := map[key]*EnginePlanUsageRow{}
	for _, account := range accounts {
		group := key{account.Plan, account.Tier}
		planOf[int64(account.CredentialID)] = group
		if rows[group] == nil {
			rows[group] = &EnginePlanUsageRow{Plan: group.plan, Tier: group.tier}
		}
	}
	result := EnginePlanUsage{Plans: []EnginePlanUsageRow{}}
	removed := map[int64]struct{}{}
	served := map[key]map[int64]struct{}{}
	added := map[key]map[int64]struct{}{}
	for _, row := range usage.Credentials {
		cost := row.CostUSD
		if row.CredentialID == 0 {
			result.Unattributed.Requests += row.Requests
			result.Unattributed.Failures += row.Failures
			result.Unattributed.ServedUSD += cost
			continue
		}
		group, inPool := planOf[row.CredentialID]
		if !inPool {
			removed[row.CredentialID] = struct{}{}
			result.Removed.Requests += row.Requests
			result.Removed.Failures += row.Failures
			result.Removed.ServedUSD += cost
			continue
		}
		target := rows[group]
		target.Requests += row.Requests
		target.Failures += row.Failures
		target.ServedUSD += cost
		if served[group] == nil {
			served[group], added[group] = map[int64]struct{}{}, map[int64]struct{}{}
		}
		served[group][row.CredentialID] = struct{}{}
		if row.CreatedAtMS != nil && *row.CreatedAtMS > startMS {
			added[group][row.CredentialID] = struct{}{}
		}
	}
	result.Removed.Accounts = len(removed)
	for group, target := range rows {
		target.Accounts = len(served[group])
		target.AddedInRange = len(added[group])
		result.Plans = append(result.Plans, *target)
	}
	slices.SortFunc(result.Plans, func(a, b EnginePlanUsageRow) int {
		return cmp.Or(cmp.Compare(a.Plan, b.Plan), cmp.Compare(a.Tier, b.Tier))
	})
	return result
}
