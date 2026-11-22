package model

import (
	"github.com/QuantumNous/new-api/common"
)

// LimitedPlanNoticeWindow is how far back the notice counts gated requests.
const LimitedPlanNoticeWindow int64 = 24 * 3600

// LimitedPlanNotice tells a customer whose newcomer plan the gate paused what
// it did to their recent requests. The console shows it as a banner and as a
// paused mark on the plan; it names no address and no other account.
type LimitedPlanNotice struct {
	WindowSeconds int64 `json:"window_seconds"`
	// Wallet, OtherPlan and Refused count the requests of the window by outcome:
	// charged to the balance, charged to another plan, turned away.
	Wallet    int   `json:"wallet"`
	OtherPlan int   `json:"other_plan"`
	Refused   int   `json:"refused"`
	LastAt    int64 `json:"last_at"`
	// SubscriptionIds are the customer's active plans the gate guards.
	SubscriptionIds []int `json:"subscription_ids"`
}

// GetLimitedPlanNotice reads, from the customer's own logs, how many requests
// of the last day the gate kept off a newcomer plan. It returns nil for a
// customer who holds no plan the gate guards, whatever their logs say: the
// plan is the thing being paused, and a plan that ended has nothing to show.
func GetLimitedPlanNotice(userId int, now int64) (*LimitedPlanNotice, error) {
	owned, err := limitedPlanOwned(userId, now)
	if err != nil || len(owned) == 0 {
		return nil, err
	}
	notice := &LimitedPlanNotice{WindowSeconds: LimitedPlanNoticeWindow, SubscriptionIds: owned}
	since := now - LimitedPlanNoticeWindow

	tx := LOG_DB.Model(&Log{}).
		Where("logs.user_id = ? AND logs.created_at >= ? AND logs.type IN ?", userId, since, []int{LogTypeConsume, LogTypeError}).
		Where("logs.other LIKE ?", `%"limited_plan_gate":"%`)
	if !common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// The customer's rows are read through idx_user_id_id from the first
		// row of the window on, not through every request the customer ever made.
		var first []int
		if err := LOG_DB.Model(&Log{}).Where("created_at >= ?", since).
			Order("created_at asc, id asc").Limit(1).Pluck("id", &first).Error; err != nil {
			return nil, err
		}
		if len(first) == 0 {
			return notice, nil
		}
		tx = tx.Where("logs.id >= ?", first[0])
	}

	var rows []struct {
		Kind   string
		N      int
		LastAt int64
	}
	err = tx.Select(
		"CASE WHEN logs.other LIKE ? THEN 'wallet' WHEN logs.other LIKE ? THEN 'other_plan' ELSE 'refused' END AS kind, COUNT(*) AS n, MAX(logs.created_at) AS last_at",
		`%"limited_plan_gate":"wallet"%`, `%"limited_plan_gate":"other_plan"%`,
	).Group("kind").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		switch row.Kind {
		case LimitedPlanGateWallet:
			notice.Wallet = row.N
		case LimitedPlanGateOtherPlan:
			notice.OtherPlan = row.N
		default:
			notice.Refused = row.N
		}
		notice.LastAt = max(notice.LastAt, row.LastAt)
	}
	return notice, nil
}
