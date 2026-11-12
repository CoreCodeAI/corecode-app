package model

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// Plan sources a customer paid for, with money or with wallet balance.
var paidPlanSources = []string{"order", PaymentMethodBalance}

// planRenewalGap is how long after a plan ended a purchase of the same plan
// by the same user still counts as its renewal. A purchase before the end
// stacks a new plan beside the running one and counts too. It is also how far
// ahead a running plan counts as expiring soon.
const planRenewalGap = 7 * 86400

// insightsChunk bounds an IN list.
const insightsChunk = 500

// PlanLiability is what running plans still owe, as of At, whatever the
// range. DeferredValue is the price share of the time not yet run on running
// paid plans, in the payment currency (yuan); a plan bought with balance is
// worth the balance at the wallet's price as of the range's end. Paid plans
// with no order to match (Unmatched) add nothing to it.
//
// Quota left is in quota dollars, split into paid and gifted (admin and
// invite gifts) plans. QuotaLeft covers plans that never reset; PeriodLeft is
// only the current period's remainder of plans that reset, which is not owed
// beyond the period. Unlimited plans have no amount and are counted apart.
type PlanLiability struct {
	At                int64   `json:"at"`
	DeferredValue     float64 `json:"deferred_value"`
	PaidPlans         int64   `json:"paid_plans"`
	PaidUsers         int64   `json:"paid_users"`
	Unmatched         int64   `json:"unmatched"`
	GiftPlans         int64   `json:"gift_plans"`
	Unlimited         int64   `json:"unlimited"`
	PaidQuotaLeftUSD  float64 `json:"paid_quota_left_usd"`
	GiftQuotaLeftUSD  float64 `json:"gift_quota_left_usd"`
	PaidPeriodLeftUSD float64 `json:"paid_period_left_usd"`
	GiftPeriodLeftUSD float64 `json:"gift_period_left_usd"`
}

// PlanBookRow is one plan's movement. Running, expiring and deferred figures
// are as of the liability's At; Sold, Renewed, Gifted, Expired and the used
// share are over the range. Sold counts paid plans started in the range and
// SoldValue their matched price (balance at the wallet's price); Renewed is
// the part of Sold whose buyer held the same plan ending no more than seven
// days before. Expired counts paid plans that ended in the range, cancelled
// ones included. FinishedUsedShare is the quota used over the quota granted
// by paid plans that ended in the range, never reset and had a total
// (FinishedPlans of them); 0 with none.
type PlanBookRow struct {
	PlanID            int     `json:"plan_id"`
	Title             string  `json:"title"`
	Price             float64 `json:"price"`
	OnePerUser        bool    `json:"one_per_user"`
	RunningPaid       int64   `json:"running_paid"`
	RunningGifted     int64   `json:"running_gifted"`
	Sold              int64   `json:"sold"`
	SoldValue         float64 `json:"sold_value"`
	Renewed           int64   `json:"renewed"`
	Gifted            int64   `json:"gifted"`
	Expired           int64   `json:"expired"`
	ExpiringSoon      int64   `json:"expiring_7d"`
	ExpiringValue     float64 `json:"expiring_7d_value"`
	DeferredValue     float64 `json:"deferred_value"`
	FinishedPlans     int64   `json:"finished_plans"`
	FinishedUsedShare float64 `json:"finished_used_share"`
}

// planPrices pairs each paid plan of the given users with the money its
// order brought: orders do not name the plan they created, so the k-th
// successful order of a user for a plan is matched with the k-th plan of that
// user, plan and source. A plan bought with wallet balance is worth the
// balance it took at the wallet's price. It returns the users' paid plans,
// oldest first per user, and the value of each matched one by id.
func planPrices(users []int, prices map[int]walletPrice) ([]UserSubscription, map[int]float64, error) {
	var subscriptions []UserSubscription
	var orders []SubscriptionOrder
	for chunk := range slices.Chunk(users, insightsChunk) {
		var subs []UserSubscription
		if err := DB.Select("id, user_id, plan_id, source, start_time, end_time").
			Where("user_id IN ? AND source IN ?", chunk, paidPlanSources).
			Order("created_at, id").Find(&subs).Error; err != nil {
			return nil, nil, err
		}
		subscriptions = append(subscriptions, subs...)
		var paid []SubscriptionOrder
		if err := DB.Select("id, user_id, plan_id, money, payment_provider, provider_payload, complete_time").
			Where("user_id IN ? AND status = ?", chunk, common.TopUpStatusSuccess).
			Order("complete_time, id").Find(&paid).Error; err != nil {
			return nil, nil, err
		}
		orders = append(orders, paid...)
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
	values := make(map[int]float64, len(subscriptions))
	for _, subscription := range subscriptions {
		key := planKey{subscription.UserId, subscription.PlanId, subscription.Source}
		index := seen[key]
		seen[key]++
		if index < len(paid[key]) {
			values[subscription.Id] = paid[key][index]
		}
	}
	return subscriptions, values, nil
}

// unrunValue is the share of value for the time a plan has left after now.
func unrunValue(value float64, subscription UserSubscription, now int64) float64 {
	if subscription.EndTime <= subscription.StartTime || subscription.EndTime <= now {
		return 0
	}
	left := subscription.EndTime - max(now, subscription.StartTime)
	return value * float64(left) / float64(subscription.EndTime-subscription.StartTime)
}

// readPlanBook returns what running plans owe as of now and each plan's
// movement over the range. Staff plans are left out, as from balances.
func readPlanBook(r InsightsRange, now int64, prices map[int]walletPrice) (PlanLiability, []PlanBookRow, error) {
	liability := PlanLiability{At: now}
	var staff []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", customerRoleBound).Pluck("id", &staff).Error; err != nil {
		return liability, nil, err
	}
	// Every plan the book reads ends after this: running now, ended in the
	// range, started in it, or one a purchase in the range renewed.
	since := min(r.Start, now) - planRenewalGap
	var all []UserSubscription
	if err := DB.Select("id, user_id, plan_id, source, status, amount_total, amount_used, start_time, end_time").
		Where("end_time >= ?", since).Find(&all).Error; err != nil {
		return liability, nil, err
	}
	all = slices.DeleteFunc(all, func(s UserSubscription) bool { return slices.Contains(staff, s.UserId) })
	var payers []int
	for _, subscription := range all {
		if slices.Contains(paidPlanSources, subscription.Source) {
			payers = append(payers, subscription.UserId)
		}
	}
	slices.Sort(payers)
	payers = slices.Compact(payers)
	_, values, err := planPrices(payers, prices)
	if err != nil {
		return liability, nil, err
	}
	var plans []SubscriptionPlan
	if err := DB.Select("id, title, price_amount, max_purchase_per_user, quota_reset_period").Find(&plans).Error; err != nil {
		return liability, nil, err
	}
	planOf := make(map[int]SubscriptionPlan, len(plans))
	for _, plan := range plans {
		planOf[plan.Id] = plan
	}

	rows := make(map[int]*PlanBookRow)
	rowOf := func(planID int) *PlanBookRow {
		row := rows[planID]
		if row == nil {
			plan := planOf[planID]
			row = &PlanBookRow{PlanID: planID, Title: plan.Title, Price: plan.PriceAmount, OnePerUser: plan.MaxPurchasePerUser == 1}
			rows[planID] = row
		}
		return row
	}
	type userPlan struct{ userID, planID int }
	paidByUserPlan := make(map[userPlan][]UserSubscription)
	for _, subscription := range all {
		if slices.Contains(paidPlanSources, subscription.Source) {
			key := userPlan{subscription.UserId, subscription.PlanId}
			paidByUserPlan[key] = append(paidByUserPlan[key], subscription)
		}
	}
	paidUsers := make(map[int]struct{})
	type usage struct{ used, total int64 }
	finished := make(map[int]*usage)
	for _, subscription := range all {
		paid := slices.Contains(paidPlanSources, subscription.Source)
		resets := NormalizeResetPeriod(planOf[subscription.PlanId].QuotaResetPeriod) != SubscriptionResetNever
		row := rowOf(subscription.PlanId)
		value, matched := values[subscription.Id]
		// A cancelled plan's end is moved to the moment it was cancelled; an
		// expired one may keep status active until the expiry task runs.
		if subscription.Status == "active" && subscription.StartTime <= now && subscription.EndTime > now {
			if subscription.AmountTotal <= 0 {
				liability.Unlimited++
			}
			if paid {
				row.RunningPaid++
				liability.PaidPlans++
				paidUsers[subscription.UserId] = struct{}{}
				if !matched {
					liability.Unmatched++
				}
				deferred := unrunValue(value, subscription, now)
				row.DeferredValue += deferred
				liability.DeferredValue += deferred
				if subscription.EndTime <= now+planRenewalGap {
					row.ExpiringSoon++
					row.ExpiringValue += deferred
				}
			} else {
				row.RunningGifted++
				liability.GiftPlans++
			}
			if subscription.AmountTotal > 0 {
				left := quotaUSD(max(subscription.AmountTotal-subscription.AmountUsed, 0))
				switch {
				case paid && resets:
					liability.PaidPeriodLeftUSD += left
				case paid:
					liability.PaidQuotaLeftUSD += left
				case resets:
					liability.GiftPeriodLeftUSD += left
				default:
					liability.GiftQuotaLeftUSD += left
				}
			}
		}
		started := subscription.StartTime >= r.Start && subscription.StartTime < r.End
		if started && !paid {
			row.Gifted++
		}
		if started && paid {
			row.Sold++
			row.SoldValue += value
			for _, earlier := range paidByUserPlan[userPlan{subscription.UserId, subscription.PlanId}] {
				if earlier.Id != subscription.Id && earlier.StartTime < subscription.StartTime &&
					earlier.EndTime >= subscription.StartTime-planRenewalGap {
					row.Renewed++
					break
				}
			}
		}
		if paid && subscription.EndTime >= r.Start && subscription.EndTime < min(r.End, now+1) {
			row.Expired++
			if !resets && subscription.AmountTotal > 0 {
				entry := finished[subscription.PlanId]
				if entry == nil {
					entry = &usage{}
					finished[subscription.PlanId] = entry
				}
				entry.used += min(subscription.AmountUsed, subscription.AmountTotal)
				entry.total += subscription.AmountTotal
				row.FinishedPlans++
			}
		}
	}
	liability.PaidUsers = int64(len(paidUsers))
	liability.DeferredValue = roundTo(liability.DeferredValue, 2)
	liability.PaidQuotaLeftUSD = roundTo(liability.PaidQuotaLeftUSD, 4)
	liability.GiftQuotaLeftUSD = roundTo(liability.GiftQuotaLeftUSD, 4)
	liability.PaidPeriodLeftUSD = roundTo(liability.PaidPeriodLeftUSD, 4)
	liability.GiftPeriodLeftUSD = roundTo(liability.GiftPeriodLeftUSD, 4)

	book := make([]PlanBookRow, 0, len(rows))
	for planID, row := range rows {
		if row.RunningPaid+row.RunningGifted+row.Sold+row.Gifted+row.Expired == 0 {
			continue
		}
		if entry := finished[planID]; entry != nil {
			row.FinishedUsedShare = ratio(float64(entry.used), float64(entry.total))
		}
		row.SoldValue = roundTo(row.SoldValue, 2)
		row.ExpiringValue = roundTo(row.ExpiringValue, 2)
		row.DeferredValue = roundTo(row.DeferredValue, 2)
		book = append(book, *row)
	}
	slices.SortFunc(book, func(a, b PlanBookRow) int {
		return cmp.Or(cmp.Compare(b.RunningPaid+b.RunningGifted, a.RunningPaid+a.RunningGifted), cmp.Compare(b.Sold, a.Sold), cmp.Compare(a.PlanID, b.PlanID))
	})
	return liability, book, nil
}
