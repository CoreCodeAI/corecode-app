package model

import (
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// The gate view shows what the newcomer-plan address gate did over the range: the
// requests it moved to the wallet or turned away (LimitedPlanGate*), the shared
// exits it spared (LimitedPlanExit*), the accounts an administrator marked as one
// studio's, and the accounts exempted by hand, which are the gate's known
// mistakes.
//
// The only record of a gated request is the marker on its log (admin_info
// limited_plan_ip_gate), so the view scans the range's logs for it. It is the
// costliest of the dashboard's reads, and is bounded to InsightsMaxGateDays. The
// scan is a read of the range's request logs from the first row of the range, a
// LIKE on other (one pass for both markers), grouped by account, kind and hour in the database, so only the
// groups arrive.

// InsightsMaxGateDays bounds the gate view, which scans request logs for a marker.
const InsightsMaxGateDays = 14

// crowdRemarkPrefix starts the remark an administrator writes on an account of a
// studio that bought the newcomer plan many times over.
const crowdRemarkPrefix = "新人包多号 "

// gateAnyMarker matches a log that carries either marker: the gate's action
// (limited_plan_ip_gate) or the exit it let through (limited_plan_ip_gate_exit).
// Both are read in one pass over the rows, which is the view's whole cost.
const gateAnyMarker = `%"limited_plan_ip_gate%`

// A kind read from the marker: the gate's three actions, then the exits, which
// carry the prefix gateExitKindPrefix.
const gateExitKindPrefix = "exit_"

// GateDay is one day of the gate's work. Wallet, OtherPlan and Refused count log
// rows by what the gate did; WalletUSD is the quota the wallet paid for the
// Wallet rows, which the plan would otherwise have paid; Users is the accounts
// the gate acted on that day; Exits the requests let through as a shared exit.
type GateDay struct {
	Day       int64   `json:"day"`
	Wallet    int64   `json:"wallet"`
	OtherPlan int64   `json:"other_plan"`
	Refused   int64   `json:"refused"`
	WalletUSD float64 `json:"wallet_usd"`
	Users     int64   `json:"users"`
	Exits     int64   `json:"exits"`
}

// GateExit counts the requests let through as a shared exit, by why, and the
// accounts that sent them.
type GateExit struct {
	Kind     string `json:"kind"`
	Requests int64  `json:"requests"`
	Users    int64  `json:"users"`
}

// GateCrowd is the accounts marked as a studio's (their remark starts with
// crowdRemarkPrefix), as of now. Granted is the quota of the newcomer plans they
// bought, Used what they spent before the gate and the review stopped them,
// Unused what is left of it, which they could not spend: the money the plan did not
// lose. Gated is how many of them the gate acted on in the range.
type GateCrowd struct {
	Accounts   int64   `json:"accounts"`
	Gated      int64   `json:"gated"`
	GrantedUSD float64 `json:"granted_usd"`
	UsedUSD    float64 `json:"used_usd"`
	UnusedUSD  float64 `json:"unused_usd"`
}

// GateExemptions is the accounts an administrator confirmed as not a studio's
// (SubscriptionAddressExemption): the gate's known mistakes. Accounts is every
// exemption, InRange those granted in the range, Gated those of them the gate
// acted on in the range. WalletBeforeUSD is what the gate moved to the wallet of
// those accounts before they were exempted, and RefundedUSD what administrators
// added to their balance after.
type GateExemptions struct {
	Accounts        int64   `json:"accounts"`
	InRange         int64   `json:"in_range"`
	Gated           int64   `json:"gated"`
	WalletBeforeUSD float64 `json:"wallet_before_usd"`
	RefundedUSD     float64 `json:"refunded_usd"`
}

// GateInsights is the gate view. Users is the distinct accounts the gate acted
// on in the range.
type GateInsights struct {
	Days       []GateDay      `json:"days"`
	Exits      []GateExit     `json:"exits"`
	Wallet     int64          `json:"wallet"`
	OtherPlan  int64          `json:"other_plan"`
	Refused    int64          `json:"refused"`
	WalletUSD  float64        `json:"wallet_usd"`
	Users      int64          `json:"users"`
	Crowd      GateCrowd      `json:"crowd"`
	Exemptions GateExemptions `json:"exemptions"`
}

type gateGroup struct {
	UserId int
	Kind   string
	Bucket int64
	N      int64
	Q      int64
}

// readGateGroups counts the range's log rows that carry marker, by account, by
// the kind the CASE names and by hour. A day that ended more than an hour ago can
// no longer change, so its groups are kept (gateDayCache) and only the days still
// running are scanned again: a range ending now reads one day, not the whole
// range, on every load after the first.
func readGateGroups(r InsightsRange, marker, kindCase string, kindArgs []any) ([]gateGroup, error) {
	now := common.GetTimestamp()
	var all []gateGroup
	for _, day := range r.days() {
		start, end := max(day, r.Start), min(r.DayStart(day)+86400, r.End)
		if start >= end {
			continue
		}
		key := gateDayKey(start, end, marker)
		settled := end+3600 <= now
		if settled {
			if groups, ok := gateDayCache.get(key); ok {
				all = append(all, groups...)
				continue
			}
		}
		groups, err := scanGateGroups(InsightsRange{Start: start, End: end, Offset: r.Offset}, marker, kindCase, kindArgs)
		if err != nil {
			return nil, err
		}
		if settled {
			gateDayCache.put(key, groups)
		}
		all = append(all, groups...)
	}
	return all, nil
}

// gateDayCacheMaxDays bounds the kept days; a view covers at most InsightsMaxGateDays.
const gateDayCacheMaxDays = 4 * InsightsMaxGateDays

// gateDayCache keeps the groups of days that ended. The key names the log
// database too, so a test that swaps databases never reads another's days.
var gateDayCache = &gateDayStore{entries: map[string][]gateGroup{}}

type gateDayStore struct {
	mu      sync.Mutex
	entries map[string][]gateGroup
	order   []string
}

func gateDayKey(start, end int64, marker string) string {
	return fmt.Sprintf("%p|%d|%d|%s", LOG_DB, start, end, marker)
}

func (c *gateDayStore) get(key string) ([]gateGroup, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	groups, ok := c.entries[key]
	return groups, ok
}

func (c *gateDayStore) put(key string, groups []gateGroup) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.entries[key]; !ok {
		c.order = append(c.order, key)
	}
	c.entries[key] = groups
	for len(c.order) > gateDayCacheMaxDays {
		delete(c.entries, c.order[0])
		c.order = c.order[1:]
	}
}

// reset forgets every kept day.
func (c *gateDayStore) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries, c.order = map[string][]gateGroup{}, nil
}

// scanGateGroups is one scan of the range's logs.
func scanGateGroups(r InsightsRange, marker, kindCase string, kindArgs []any) ([]gateGroup, error) {
	query := LOG_DB.Model(&Log{}).
		Where("created_at >= ? AND created_at < ? AND type IN ?", r.Start, r.End, []int{LogTypeConsume, LogTypeError}).
		Where("other LIKE ?", marker+"%")
	if !common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// Read by primary key from the first row of the range on, not through every
		// log the table holds.
		var first []int
		if err := LOG_DB.Model(&Log{}).Where("created_at >= ?", r.Start).
			Order("created_at asc, id asc").Limit(1).Pluck("id", &first).Error; err != nil {
			return nil, err
		}
		if len(first) == 0 {
			return nil, nil
		}
		query = query.Where("id >= ?", first[0])
	}
	var groups []gateGroup
	err := query.Select("user_id, "+kindCase+" AS kind, created_at - (created_at % 3600) AS bucket, COUNT(*) AS n, COALESCE(SUM(quota), 0) AS q", kindArgs...).
		Group("user_id, kind, bucket").Scan(&groups).Error
	return groups, err
}

func GetGateInsights(r InsightsRange) (*GateInsights, error) {
	result := &GateInsights{Days: []GateDay{}, Exits: []GateExit{}}
	days := make(map[int64]*GateDay)
	dayUsers := make(map[int64]map[int]bool)
	for _, day := range r.days() {
		days[day] = &GateDay{Day: day}
		dayUsers[day] = map[int]bool{}
	}
	dayOf := func(bucket int64) *GateDay {
		if day := days[r.DayStart(bucket)]; day != nil {
			return day
		}
		return &GateDay{}
	}

	groups, err := readGateGroups(r, gateAnyMarker,
		`CASE
			WHEN other LIKE ? THEN 'wallet'
			WHEN other LIKE ? THEN 'other_plan'
			WHEN other LIKE ? THEN 'refused'
			WHEN other LIKE ? THEN 'exit_listed'
			WHEN other LIKE ? THEN 'exit_crowd'
			WHEN other LIKE ? THEN 'exit_traffic'
			ELSE 'exit_unread' END`,
		[]any{
			`%"limited_plan_ip_gate":"wallet"%`, `%"limited_plan_ip_gate":"other_plan"%`, `%"limited_plan_ip_gate":"%`,
			`%"limited_plan_ip_gate_exit":"listed"%`, `%"limited_plan_ip_gate_exit":"crowd"%`, `%"limited_plan_ip_gate_exit":"traffic"%`,
		})
	if err != nil {
		return nil, err
	}
	gated := map[int]bool{}
	walletBy := map[int][]gateGroup{}
	exitRequests := map[string]int64{}
	exitUsers := map[string]map[int]bool{}
	for _, group := range groups {
		day := dayOf(group.Bucket)
		if exit, isExit := strings.CutPrefix(group.Kind, gateExitKindPrefix); isExit {
			day.Exits += group.N
			exitRequests[exit] += group.N
			if exitUsers[exit] == nil {
				exitUsers[exit] = map[int]bool{}
			}
			exitUsers[exit][group.UserId] = true
			continue
		}
		switch group.Kind {
		case LimitedPlanGateWallet:
			day.Wallet += group.N
			day.WalletUSD += float64(group.Q)
			result.Wallet += group.N
			result.WalletUSD += float64(group.Q)
			walletBy[group.UserId] = append(walletBy[group.UserId], group)
		case LimitedPlanGateOtherPlan:
			day.OtherPlan += group.N
			result.OtherPlan += group.N
		default:
			day.Refused += group.N
			result.Refused += group.N
		}
		gated[group.UserId] = true
		if users := dayUsers[r.DayStart(group.Bucket)]; users != nil {
			users[group.UserId] = true
		}
	}
	result.Users = int64(len(gated))
	for _, kind := range []string{LimitedPlanExitListed, LimitedPlanExitCrowd, LimitedPlanExitTraffic, LimitedPlanExitUnread} {
		if exitRequests[kind] > 0 {
			result.Exits = append(result.Exits, GateExit{Kind: kind, Requests: exitRequests[kind], Users: int64(len(exitUsers[kind]))})
		}
	}

	for _, day := range r.days() {
		entry := days[day]
		entry.Users = int64(len(dayUsers[day]))
		entry.WalletUSD = roundTo(entry.WalletUSD/common.QuotaPerUnit, 4)
		result.Days = append(result.Days, *entry)
	}
	result.WalletUSD = roundTo(result.WalletUSD/common.QuotaPerUnit, 4)

	if err := fillGateCrowd(result, gated); err != nil {
		return nil, err
	}
	if err := fillGateExemptions(r, result, gated, walletBy); err != nil {
		return nil, err
	}
	return result, nil
}

// fillGateCrowd reads the accounts marked as a studio's and the newcomer plans
// they hold.
func fillGateCrowd(result *GateInsights, gated map[int]bool) error {
	var ids []int
	if err := DB.Model(&User{}).Where("remark LIKE ? AND role < ?", crowdRemarkPrefix+"%", customerRoleBound).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	result.Crowd.Accounts = int64(len(ids))
	var granted, used int64
	for chunk := range slices.Chunk(ids, insightsChunk) {
		var rows []struct {
			Total int64
			Used  int64
		}
		if err := DB.Table("user_subscriptions").
			Joins("JOIN subscription_plans ON subscription_plans.id = user_subscriptions.plan_id").
			Select("user_subscriptions.amount_total AS total, user_subscriptions.amount_used AS used").
			Where("user_subscriptions.user_id IN ? AND subscription_plans.max_purchase_per_user > 0 AND subscription_plans.price_amount > 0 AND user_subscriptions.source <> ?",
				chunk, "admin").Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			granted += row.Total
			used += min(row.Used, row.Total)
		}
	}
	for _, id := range ids {
		if gated[id] {
			result.Crowd.Gated++
		}
	}
	result.Crowd.GrantedUSD = quotaUSD(granted)
	result.Crowd.UsedUSD = quotaUSD(used)
	result.Crowd.UnusedUSD = quotaUSD(granted - used)
	return nil
}

// fillGateExemptions reads the accounts exempted by hand and what the gate cost
// them.
func fillGateExemptions(r InsightsRange, result *GateInsights, gated map[int]bool, walletBy map[int][]gateGroup) error {
	var exempt []SubscriptionAddressExemption
	if err := DB.Select("user_id, created_at").Find(&exempt).Error; err != nil {
		return err
	}
	result.Exemptions.Accounts = int64(len(exempt))
	exemptedAt := make(map[int]int64, len(exempt))
	for _, row := range exempt {
		exemptedAt[row.UserId] = row.CreatedAt
		if row.CreatedAt >= r.Start && row.CreatedAt < r.End {
			result.Exemptions.InRange++
		}
		if gated[row.UserId] {
			result.Exemptions.Gated++
		}
		for _, group := range walletBy[row.UserId] {
			if group.Bucket+3600 <= row.CreatedAt {
				result.Exemptions.WalletBeforeUSD += float64(group.Q)
			}
		}
	}
	result.Exemptions.WalletBeforeUSD = roundTo(result.Exemptions.WalletBeforeUSD/common.QuotaPerUnit, 4)
	if len(exempt) == 0 {
		return nil
	}
	var refunded int64
	if err := eachTimedQuotaAdjustment(r.Start, r.End, func(log AuditLog) {
		if !log.Success || log.Other.Op == nil {
			return
		}
		params := log.Other.Op.Params
		target, ok := auditInt(params, "target_user_id")
		before, hasBefore := auditInt(params, "from")
		after, hasAfter := auditInt(params, "to")
		at, exempted := exemptedAt[int(target)]
		if ok && hasBefore && hasAfter && exempted && after > before && log.CreatedAt >= at &&
			auditString(params, "mode") == "add" {
			refunded += after - before
		}
	}); err != nil {
		return err
	}
	result.Exemptions.RefundedUSD = quotaUSD(refunded)
	return nil
}
