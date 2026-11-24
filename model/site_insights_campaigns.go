package model

import (
	"slices"

	"github.com/QuantumNous/new-api/common"
)

// The campaigns view answers what each way of winning a customer cost and what
// it brought back: the people who received something in the range, how many of
// them paid afterwards, and how much, up to now.
//
// Money has two units, as everywhere on the dashboard. What was given away is
// quota dollars, which this site sells at ¥1 each, so CostUSD reads as yuan; what
// customers paid is the payment currency (top_ups.money, yuan).
//
// A cohort is the accounts that received in the range, by the time of the
// receipt; what they paid counts from that moment to now, whatever the range's
// end. An account that received two things is in two rows, once in each, and once
// in the total.

// Kinds of campaign, in the order the console lists them.
const (
	// CampaignInviteGift is the plan an inviter gives an invitee
	// (SubscriptionSourceAffiliateGift).
	CampaignInviteGift = "invite_gift"
	// CampaignNewcomerPlan is the plan limited per user that costs money, bought
	// once per account.
	CampaignNewcomerPlan = "newcomer_plan"
	// CampaignForumID is the $3 an administrator adds to an account that left
	// its ID on the forum thread.
	CampaignForumID = "forum_id"
	// CampaignRaffle is the $5 an administrator adds to a raffle winner.
	CampaignRaffle = "raffle"
	// CampaignAdminPlan is a plan an administrator bound to an account.
	CampaignAdminPlan = "admin_plan"
	// CampaignRedemption is quota credited by a redemption code.
	CampaignRedemption = "redemption"
	// CampaignChannelFee is what a paid promotion channel costs, against the
	// accounts it brought in the range.
	CampaignChannelFee = "channel_fee"
	// CampaignManualOther is any other quota an administrator added: refunds and
	// compensation, which are not promotion. It is listed but left out of the
	// total.
	CampaignManualOther = "manual_other"
)

// campaignPromotion says which kinds count toward the total: all but a
// compensation.
var campaignPromotion = map[string]bool{
	CampaignInviteGift: true, CampaignNewcomerPlan: true, CampaignForumID: true, CampaignRaffle: true,
	CampaignAdminPlan: true, CampaignRedemption: true, CampaignChannelFee: true,
}

// Amounts that tell an administrator's hand grant apart, in quota.
const (
	forumIDGrantQuota = 3 * 500000
	raffleGrantQuota  = 5 * 500000
)

// newcomerUsedShare is how much of a newcomer plan's quota must be spent for the
// plan to count as used up; a plan is rarely drained to the last token.
const newcomerUsedShare = 0.9

// CampaignRow is one kind of campaign over the range.
//
// CostUSD is what it cost in quota dollars: the quota given, except a newcomer
// plan, which is sold, so its cost is the quota its buyers used, and a channel
// fee, which is the fee over the range. GivenUSD is the quota handed out, UsedUSD
// the part spent, LyingUSD the part still spendable (a plan that has not ended, or
// for a balance credit the smaller of what was added and what the wallet still
// holds: an estimate, since the wallet does not remember which credit it spent),
// and LapsedUSD the part of a plan that ended unspent.
//
// Recipients received in the range; Payers is those that paid afterwards;
// PaidMoney what they paid after, and PackMoney, for a newcomer plan only, what
// the plan itself cost them.
type CampaignRow struct {
	Kind       string  `json:"kind"`
	CostUSD    float64 `json:"cost_usd"`
	GivenUSD   float64 `json:"given_usd"`
	UsedUSD    float64 `json:"used_usd"`
	LyingUSD   float64 `json:"lying_usd"`
	LapsedUSD  float64 `json:"lapsed_usd"`
	Recipients int64   `json:"recipients"`
	Payers     int64   `json:"payers"`
	PaidMoney  float64 `json:"paid_money"`
	PackMoney  float64 `json:"pack_money"`
}

// NewcomerFunnel follows the buyers of the newcomer plan in the range: bought it,
// used it up, paid again. Repaid counts a payment after the purchase that is not
// the plan itself; RepaidAfterUsedUp is the part of UsedUp that did.
type NewcomerFunnel struct {
	Bought            int64   `json:"bought"`
	UsedUp            int64   `json:"used_up"`
	Repaid            int64   `json:"repaid"`
	RepaidAfterUsedUp int64   `json:"repaid_after_used_up"`
	PackMoney         float64 `json:"pack_money"`
	RepaidMoney       float64 `json:"repaid_money"`
	GivenUSD          float64 `json:"given_usd"`
	UsedUSD           float64 `json:"used_usd"`
	// PriceMoney is the plan's list price, for the plans that make it up.
	PriceMoney float64 `json:"price_money"`
}

// CampaignInsights is the campaigns view. Total sums the promotion rows, an
// account once however many it appears in.
type CampaignInsights struct {
	Rows     []CampaignRow   `json:"rows"`
	Total    CampaignRow     `json:"total"`
	Newcomer *NewcomerFunnel `json:"newcomer,omitempty"`
}

// campaignCohort is the accounts of one kind and what each received.
type campaignCohort struct {
	row   CampaignRow
	first map[int]int64
	given map[int]int64 // balance credits only, quota
}

func newCampaignCohort(kind string) *campaignCohort {
	return &campaignCohort{row: CampaignRow{Kind: kind}, first: map[int]int64{}, given: map[int]int64{}}
}

// receive records that userID received at at.
func (c *campaignCohort) receive(userID int, at int64) {
	if known, ok := c.first[userID]; !ok || at < known {
		c.first[userID] = at
	}
}

// classifyHandGrant names the kind of an administrator's balance credit of delta
// quota: the two amounts the owner gives on purpose, or any other.
func classifyHandGrant(delta int64) string {
	switch delta {
	case forumIDGrantQuota:
		return CampaignForumID
	case raffleGrantQuota:
		return CampaignRaffle
	}
	return CampaignManualOther
}

func GetCampaignInsights(r InsightsRange) (*CampaignInsights, error) {
	var users []struct {
		Id        int
		InviterId int
		CreatedAt int64
		Quota     int64
		Role      int
	}
	if err := DB.Model(&User{}).Select("id, inviter_id, created_at, quota, role").Find(&users).Error; err != nil {
		return nil, err
	}
	customer := make(map[int]bool, len(users))
	quota := make(map[int]int64, len(users))
	for _, user := range users {
		if user.Role < customerRoleBound {
			customer[user.Id] = true
			quota[user.Id] = user.Quota
		}
	}
	inRange := func(at int64) bool { return at >= r.Start && at < r.End }

	var plans []SubscriptionPlan
	if err := DB.Select("id, price_amount, max_purchase_per_user").Find(&plans).Error; err != nil {
		return nil, err
	}
	newcomerPlans := map[int]float64{}
	for _, plan := range plans {
		if plan.MaxPurchasePerUser > 0 && plan.PriceAmount > 0 {
			newcomerPlans[plan.Id] = plan.PriceAmount
		}
	}

	cohorts := map[string]*campaignCohort{}
	cohort := func(kind string) *campaignCohort {
		if cohorts[kind] == nil {
			cohorts[kind] = newCampaignCohort(kind)
		}
		return cohorts[kind]
	}

	// Plans the range handed out or sold.
	now := common.GetTimestamp()
	var subscriptions []UserSubscription
	if err := DB.Select("id, user_id, plan_id, amount_total, amount_used, end_time, status, source, created_at").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Find(&subscriptions).Error; err != nil {
		return nil, err
	}
	newcomerUsed := map[int]int64{}
	newcomerTotal := map[int]int64{}
	for _, subscription := range subscriptions {
		if !customer[subscription.UserId] {
			continue
		}
		var c *campaignCohort
		switch {
		case subscription.Source == SubscriptionSourceAffiliateGift:
			c = cohort(CampaignInviteGift)
		case subscription.Source == "admin":
			c = cohort(CampaignAdminPlan)
		case newcomerPlans[subscription.PlanId] > 0 && slices.Contains(paidPlanSources, subscription.Source):
			c = cohort(CampaignNewcomerPlan)
			newcomerUsed[subscription.UserId] += subscription.AmountUsed
			newcomerTotal[subscription.UserId] += subscription.AmountTotal
		default:
			continue
		}
		c.receive(subscription.UserId, subscription.CreatedAt)
		c.row.GivenUSD += float64(subscription.AmountTotal)
		c.row.UsedUSD += float64(subscription.AmountUsed)
		left := float64(max(subscription.AmountTotal-subscription.AmountUsed, 0))
		if subscription.Status == "active" && subscription.EndTime > now {
			c.row.LyingUSD += left
		} else {
			c.row.LapsedUSD += left
		}
	}

	// Backfilled enterprise top-ups pay for quota an administrator added by hand;
	// that is a sale, not a gift, so neither the credit nor the payment is counted.
	orders, err := readPaidOrders(0, 0)
	if err != nil {
		return nil, err
	}
	backfilled := map[int]bool{}
	for _, order := range orders {
		if order.PaymentProvider == PaymentProviderOfflineBackfill {
			backfilled[order.UserId] = true
		}
	}

	// Balance credits: the audit log of administrators' quota changes.
	if err := eachTimedQuotaAdjustment(r.Start, r.End, func(log AuditLog) {
		if !log.Success || log.Other.Op == nil {
			return
		}
		params := log.Other.Op.Params
		target, ok := auditInt(params, "target_user_id")
		before, hasBefore := auditInt(params, "from")
		after, hasAfter := auditInt(params, "to")
		if !ok || !hasBefore || !hasAfter || after <= before || auditString(params, "mode") != "add" ||
			!customer[int(target)] || backfilled[int(target)] {
			return
		}
		c := cohort(classifyHandGrant(after - before))
		c.receive(int(target), log.CreatedAt)
		c.given[int(target)] += after - before
	}); err != nil {
		return nil, err
	}

	var redeemed []struct {
		UsedUserId   int
		Quota        int64
		RedeemedTime int64
	}
	if err := DB.Model(&Redemption{}).Unscoped().Select("used_user_id, quota, redeemed_time").
		Where("used_user_id > 0 AND redeemed_time >= ? AND redeemed_time < ?", r.Start, r.End).Find(&redeemed).Error; err != nil {
		return nil, err
	}
	for _, code := range redeemed {
		if !customer[code.UsedUserId] || backfilled[code.UsedUserId] {
			continue
		}
		c := cohort(CampaignRedemption)
		c.receive(code.UsedUserId, code.RedeemedTime)
		c.given[code.UsedUserId] += code.Quota
	}

	// A paid channel: the accounts it brought in the range, against its fee.
	costs, _, err := readEffectiveChannelCosts()
	if err != nil {
		return nil, err
	}
	fees := channelFeesIn(costs, r.Start, r.End)
	paidChannel := map[int]bool{}
	for channel := range fees {
		paidChannel[channel] = true
	}
	if len(paidChannel) > 0 {
		c := cohort(CampaignChannelFee)
		for _, fee := range fees {
			c.row.CostUSD += fee * common.QuotaPerUnit
		}
		for _, user := range users {
			if customer[user.Id] && paidChannel[user.InviterId] && inRange(user.CreatedAt) {
				c.receive(user.Id, user.CreatedAt)
			}
		}
	}

	// What each account paid, after each moment. The newcomer plan's own orders are
	// told apart so a plan is not counted as the account paying again.
	packOrders := map[string]bool{}
	if len(newcomerPlans) > 0 {
		var tradeNos []string
		if err := DB.Model(&SubscriptionOrder{}).
			Where("status = ? AND plan_id IN ?", common.TopUpStatusSuccess, mapKeys(newcomerPlans)).
			Pluck("trade_no", &tradeNos).Error; err != nil {
			return nil, err
		}
		for _, tradeNo := range tradeNos {
			packOrders[tradeNo] = true
		}
	}
	payments := map[int][]paidOrder{}
	for _, order := range orders {
		if order.Money > 0 && order.PaymentProvider != PaymentProviderOfflineBackfill {
			payments[order.UserId] = append(payments[order.UserId], order)
		}
	}
	// A plan's order opens before the plan starts, so the plan's own order is
	// looked for from a day earlier.
	const packOrderLead = 86400
	paidAfter := func(userID int, since int64, packs bool) (money float64, paid bool) {
		if packs {
			since -= packOrderLead
		}
		for _, order := range payments[userID] {
			if order.CreateTime < since || packOrders[order.TradeNo] != packs {
				continue
			}
			money += order.Money
			paid = true
		}
		return money, paid
	}

	// Close each cohort: payers, money, balance credits and the newcomer plan's price.
	result := &CampaignInsights{}
	total := newCampaignCohort("")
	for _, kind := range []string{CampaignInviteGift, CampaignNewcomerPlan, CampaignForumID, CampaignRaffle,
		CampaignAdminPlan, CampaignRedemption, CampaignChannelFee, CampaignManualOther} {
		c := cohorts[kind]
		if c == nil {
			continue
		}
		c.row.Recipients = int64(len(c.first))
		for userID, at := range c.first {
			if money, paid := paidAfter(userID, at, false); paid {
				c.row.Payers++
				c.row.PaidMoney += money
			}
			if kind == CampaignNewcomerPlan {
				money, _ := paidAfter(userID, at, true)
				c.row.PackMoney += money
			}
			if given := c.given[userID]; given > 0 {
				c.row.GivenUSD += float64(given)
				held := min(given, max(quota[userID], 0))
				c.row.LyingUSD += float64(held)
				c.row.UsedUSD += float64(given - held)
			}
			if campaignPromotion[kind] {
				total.receive(userID, at)
			}
		}
		switch kind {
		case CampaignNewcomerPlan:
			c.row.CostUSD = c.row.UsedUSD
		case CampaignChannelFee:
		default:
			c.row.CostUSD = c.row.GivenUSD
		}
		result.Rows = append(result.Rows, finishCampaignRow(c.row))
	}
	for _, row := range result.Rows {
		if campaignPromotion[row.Kind] {
			total.row.CostUSD += row.CostUSD * common.QuotaPerUnit
			total.row.GivenUSD += row.GivenUSD * common.QuotaPerUnit
			total.row.UsedUSD += row.UsedUSD * common.QuotaPerUnit
			total.row.LyingUSD += row.LyingUSD * common.QuotaPerUnit
			total.row.LapsedUSD += row.LapsedUSD * common.QuotaPerUnit
			total.row.PackMoney += row.PackMoney
		}
	}
	total.row.Recipients = int64(len(total.first))
	for userID, at := range total.first {
		if money, paid := paidAfter(userID, at, false); paid {
			total.row.Payers++
			total.row.PaidMoney += money
		}
	}
	total.row.Kind = "total"
	result.Total = finishCampaignRow(total.row)

	if c := cohorts[CampaignNewcomerPlan]; c != nil {
		funnel := &NewcomerFunnel{Bought: int64(len(c.first)), PackMoney: roundTo(c.row.PackMoney, 2),
			GivenUSD: quotaUSD(int64(c.row.GivenUSD)), UsedUSD: quotaUSD(int64(c.row.UsedUSD))}
		for _, price := range newcomerPlans {
			funnel.PriceMoney = max(funnel.PriceMoney, price)
		}
		for userID, at := range c.first {
			usedUp := newcomerTotal[userID] > 0 && float64(newcomerUsed[userID]) >= newcomerUsedShare*float64(newcomerTotal[userID])
			money, repaid := paidAfter(userID, at, false)
			funnel.RepaidMoney += money
			if usedUp {
				funnel.UsedUp++
			}
			if repaid {
				funnel.Repaid++
				if usedUp {
					funnel.RepaidAfterUsedUp++
				}
			}
		}
		funnel.RepaidMoney = roundTo(funnel.RepaidMoney, 2)
		result.Newcomer = funnel
	}
	return result, nil
}

// finishCampaignRow converts a row's quota figures to quota dollars and rounds.
// The fee of a channel is already in dollars.
func finishCampaignRow(row CampaignRow) CampaignRow {
	row.CostUSD = roundTo(row.CostUSD/common.QuotaPerUnit, 4)
	row.GivenUSD = roundTo(row.GivenUSD/common.QuotaPerUnit, 4)
	row.UsedUSD = roundTo(row.UsedUSD/common.QuotaPerUnit, 4)
	row.LyingUSD = roundTo(row.LyingUSD/common.QuotaPerUnit, 4)
	row.LapsedUSD = roundTo(row.LapsedUSD/common.QuotaPerUnit, 4)
	row.PaidMoney = roundTo(row.PaidMoney, 2)
	row.PackMoney = roundTo(row.PackMoney, 2)
	return row
}

func mapKeys(m map[int]float64) []int {
	keys := make([]int, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

// readEffectiveChannelCosts is the stored channel fees with overlapping entries
// resolved, as the channels view reads them.
func readEffectiveChannelCosts() ([]ChannelCost, map[int]bool, error) {
	stored, err := ReadChannelCosts()
	if err != nil {
		return nil, nil, err
	}
	costs, overlaps := effectiveChannelCosts(stored)
	return costs, overlaps, nil
}

// eachTimedQuotaAdjustment is eachQuotaAdjustment with the time of each
// adjustment read as well, for views that follow an account from the moment it
// was credited.
func eachTimedQuotaAdjustment(start, end int64, fn func(AuditLog)) error {
	lastID := 0
	for {
		var batch []AuditLog
		if err := LOG_DB.Model(&AuditLog{}).Select("id, created_at, success, other").
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
