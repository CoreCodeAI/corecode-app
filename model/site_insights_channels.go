package model

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// ChannelCostsOptionKey stores the fees paid to promotion channels, as JSON.
const ChannelCostsOptionKey = "ChannelCosts"

// channelCostMonth is the days a monthly fee covers, as for pool accounts.
const channelCostMonth = 30 * 86400

// maxChannelCosts bounds the stored list; a channel's fee history is short.
const maxChannelCosts = 200

// ChannelCost is a fee paid to the channel whose affiliate account is UserID:
// MonthlyUSD for every 30 days from Start until End, or until now when End is
// zero. A changed fee is a new entry starting where the old one ends.
type ChannelCost struct {
	UserID     int     `json:"user_id"`
	MonthlyUSD float64 `json:"monthly_usd"`
	Start      int64   `json:"start"`
	End        int64   `json:"end"`
	Note       string  `json:"note"`
}

// feeIn is the part of the fee falling in [start, end), in USD.
func (c ChannelCost) feeIn(start, end int64) float64 {
	from := max(c.Start, start)
	to := end
	if c.End > 0 {
		to = min(c.End, end)
	}
	if to <= from {
		return 0
	}
	return c.MonthlyUSD * float64(to-from) / channelCostMonth
}

// active reports whether the fee runs at at.
func (c ChannelCost) active(at int64) bool {
	return at >= c.Start && (c.End == 0 || at < c.End)
}

// effectiveChannelCosts ends each entry where the next entry of the same
// channel starts, so an entry added without closing the open one replaces it
// rather than adding to it. It returns the channels that had overlapping
// entries.
func effectiveChannelCosts(costs []ChannelCost) ([]ChannelCost, map[int]bool) {
	sorted := slices.Clone(costs)
	slices.SortStableFunc(sorted, func(a, b ChannelCost) int {
		return cmp.Or(cmp.Compare(a.UserID, b.UserID), cmp.Compare(a.Start, b.Start))
	})
	overlaps := make(map[int]bool)
	for i := 0; i+1 < len(sorted); i++ {
		cost, next := &sorted[i], sorted[i+1]
		if cost.UserID != next.UserID || (cost.End > 0 && cost.End <= next.Start) {
			continue
		}
		overlaps[cost.UserID] = true
		cost.End = next.Start
	}
	return sorted, overlaps
}

// ReadChannelCosts returns the stored channel fees. It reads the option row
// itself rather than the in-memory map, so a fee saved through one server is
// counted at once by the other during a release.
func ReadChannelCosts() ([]ChannelCost, error) {
	var option Option
	err := DB.Where(commonKeyCol+" = ?", ChannelCostsOptionKey).Limit(1).Find(&option).Error
	if err != nil {
		return nil, err
	}
	costs := []ChannelCost{}
	if strings.TrimSpace(option.Value) == "" {
		return costs, nil
	}
	if err := common.UnmarshalJsonStr(option.Value, &costs); err != nil {
		return nil, err
	}
	return costs, nil
}

var errInvalidChannelCost error = common.NewMessage("Invalid channel cost")

// SaveChannelCosts replaces the stored channel fees after checking each one.
func SaveChannelCosts(costs []ChannelCost) error {
	if len(costs) > maxChannelCosts {
		return errInvalidChannelCost
	}
	for i := range costs {
		cost := &costs[i]
		cost.Note = strings.TrimSpace(cost.Note)
		if cost.UserID <= 0 || cost.Start <= 0 || cost.End < 0 ||
			(cost.End > 0 && cost.End <= cost.Start) ||
			math.IsNaN(cost.MonthlyUSD) || cost.MonthlyUSD < 0 || cost.MonthlyUSD > 1e7 ||
			len(cost.Note) > 200 {
			return errInvalidChannelCost
		}
	}
	slices.SortStableFunc(costs, func(a, b ChannelCost) int {
		return cmp.Or(cmp.Compare(a.UserID, b.UserID), cmp.Compare(a.Start, b.Start))
	})
	value, err := common.Marshal(costs)
	if err != nil {
		return err
	}
	return UpdateOption(ChannelCostsOptionKey, string(value))
}

// Segments other than a named channel.
const (
	ChannelSegmentChannel = "channel"
	// ChannelSegmentInvited is sign-ups through an invitation code that is
	// not a channel's.
	ChannelSegmentInvited = "invited"
	ChannelSegmentOrganic = "organic"
)

// ChannelRow is one acquisition source over the range. A channel is an
// affiliate account marked as a channel, or one with a recorded fee.
//
// Registered to Repeat follow the accounts created in the range up to now,
// as on the growth view. The money figures cover every account the source
// ever brought, over the range: Revenue is what they paid in the range, in
// the payment currency; ConsumptionUSD what their requests cost at list
// price; GiftConsumptionUSD the part no payment covers (given plans, and the
// unpaid share of each wallet as its credits stood at the end of each hour);
// InviteGiftUSD the part of it invite gift plans covered, for accounts that
// hold no administrator's plan; GrantedUSD the credit given to them in the
// range (given plans, and administrators' balance increases);
// ClawedBackUSD administrators' balance decreases in the range; FeeUSD the
// channel's fee over the range; CommissionUSD the commission earned on the
// consumption of the source's accounts, whoever earned it.
// GiftOutstandingUSD is given credit not yet spent, now, on enabled
// accounts; GiftDormantUSD the same on disabled accounts, spendable only if
// they are enabled again. Deleted accounts hold none.
//
// A channel's own account counts with whoever invited it, but its given
// credit and gift spend count in its own row.
//
// RevenueNewAccounts is the part of Revenue paid by accounts created in the
// range. FeeStart is the start of the channel's first fee, and
// RevenueSinceFee the part of Revenue paid by accounts created on or after
// it. CommissionEarnedUSD is the commission the channel's own account
// earned in the range, and CommissionAccruingUSD the part of it earned while
// a fee ran: a fee channel is not charged it, but it is credited all the
// same. FeeOverlap marks a channel whose fee entries overlapped; the later
// entry replaces the earlier from its start.
type ChannelRow struct {
	Segment               string  `json:"segment"`
	Channel               UserRef `json:"channel"`
	Tier                  string  `json:"tier"`
	Accounts              int64   `json:"accounts"`
	Registered            int64   `json:"registered"`
	Activated             int64   `json:"activated"`
	Paid                  int64   `json:"paid"`
	Repeat                int64   `json:"repeat"`
	Revenue               float64 `json:"revenue"`
	RevenueNewAccounts    float64 `json:"revenue_new_accounts"`
	RevenueSinceFee       float64 `json:"revenue_since_fee"`
	FeeStart              int64   `json:"fee_start"`
	Payers                int64   `json:"payers"`
	NewPayers             int64   `json:"new_payers"`
	ConsumptionUSD        float64 `json:"consumption_usd"`
	GiftConsumptionUSD    float64 `json:"gift_consumption_usd"`
	InviteGiftUSD         float64 `json:"invite_gift_usd"`
	GrantedUSD            float64 `json:"granted_usd"`
	ClawedBackUSD         float64 `json:"clawed_back_usd"`
	GiftOutstandingUSD    float64 `json:"gift_outstanding_usd"`
	GiftDormantUSD        float64 `json:"gift_dormant_usd"`
	CommissionUSD         float64 `json:"commission_usd"`
	CommissionEarnedUSD   float64 `json:"commission_earned_usd"`
	CommissionAccruingUSD float64 `json:"commission_accruing"`
	FeeUSD                float64 `json:"fee_usd"`
	FeeOverlap            bool    `json:"fee_overlap"`
}

// ChannelInsights compares what each acquisition source brought in with what
// it cost over the range, and lists the recorded fees.
type ChannelInsights struct {
	Channels []ChannelRow  `json:"channels"`
	Costs    []ChannelCost `json:"costs"`
	// StaleHours counts the range's hours still stored under an older rollup
	// version, until they are rebuilt; omitted when none.
	StaleHours int `json:"stale_hours"`
}

// walletCredit is one credit to a wallet: paid quota with the money paid for
// it, or given quota (negative when taken away).
type walletCredit struct {
	at          int64
	money       float64
	paid, given int64
}

// walletHistory is each wallet's credits, oldest first, from the sources
// readWalletPrices reads.
type walletHistory map[int][]walletCredit

func readWalletHistory(end int64) (walletHistory, error) {
	history := make(walletHistory)
	orders, err := readPaidOrders(0, end)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		if !order.Subscription {
			history[order.UserId] = append(history[order.UserId], walletCredit{
				at: order.CreateTime, money: order.Money, paid: order.Amount*int64(common.QuotaPerUnit) + order.BonusQuota,
			})
		}
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
			history[int(target)] = append(history[int(target)], walletCredit{at: log.CreatedAt, given: after - before})
		}
	}
	var redeemed []struct {
		UsedUserId   int
		Quota        int64
		RedeemedTime int64
	}
	if err := DB.Model(&Redemption{}).Unscoped().Select("used_user_id, quota, redeemed_time").
		Where("used_user_id > 0 AND redeemed_time > 0 AND redeemed_time < ?", end).Find(&redeemed).Error; err != nil {
		return nil, err
	}
	for _, row := range redeemed {
		history[row.UsedUserId] = append(history[row.UsedUserId], walletCredit{at: row.RedeemedTime, given: row.Quota})
	}
	for _, credits := range history {
		slices.SortStableFunc(credits, func(a, b walletCredit) int { return cmp.Compare(a.at, b.at) })
	}
	return history, nil
}

// paidShare is the share of a wallet's credits before before that was paid
// for, as readWalletPrices takes it at its end.
func (h walletHistory) paidShare(userID int, before int64) float64 {
	var money float64
	var paid, given int64
	for _, credit := range h[userID] {
		if credit.at >= before {
			break
		}
		money += credit.money
		paid += credit.paid
		given += credit.given
	}
	if money <= 0 || paid <= 0 {
		return 0
	}
	return float64(paid) / float64(max(paid, paid+given))
}

func GetChannelInsights(r InsightsRange) (*ChannelInsights, error) {
	stored, err := ReadChannelCosts()
	if err != nil {
		return nil, err
	}
	costs, overlaps := effectiveChannelCosts(stored)
	var affiliates []struct {
		UserId  int
		Tier    string
		Channel bool
	}
	if err := DB.Model(&Affiliate{}).Select("user_id, tier, channel").Find(&affiliates).Error; err != nil {
		return nil, err
	}
	rows := make(map[int]*ChannelRow)
	tiers := make(map[int]string)
	channel := func(userID int) {
		if rows[userID] == nil {
			rows[userID] = &ChannelRow{Segment: ChannelSegmentChannel, Channel: UserRef{UserID: userID}, Tier: tiers[userID]}
		}
	}
	for _, affiliate := range affiliates {
		tiers[affiliate.UserId] = affiliate.Tier
		if affiliate.Channel {
			channel(affiliate.UserId)
		}
	}
	feeActive := func(userID int, at int64) bool {
		return slices.ContainsFunc(costs, func(cost ChannelCost) bool { return cost.UserID == userID && cost.active(at) })
	}
	for _, cost := range costs {
		channel(cost.UserID)
		row := rows[cost.UserID]
		row.FeeUSD += cost.feeIn(r.Start, r.End)
		if row.FeeStart == 0 || cost.Start < row.FeeStart {
			row.FeeStart = cost.Start
		}
		row.FeeOverlap = overlaps[cost.UserID]
	}
	invited := &ChannelRow{Segment: ChannelSegmentInvited}
	organic := &ChannelRow{Segment: ChannelSegmentOrganic}

	var users []struct {
		Id           int
		InviterId    int
		RequestCount int
		CreatedAt    int64
		Quota        int64
		Status       int
		DeletedAt    gorm.DeletedAt
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, inviter_id, request_count, created_at, quota, status, deleted_at").
		Where("role < ?", customerRoleBound).Find(&users).Error; err != nil {
		return nil, err
	}
	// rowOf is the source that brought an account; giftRowOf is where its
	// given credit counts, which for a channel's own account is its own row.
	rowOf := make(map[int]*ChannelRow, len(users))
	giftRowOf := make(map[int]*ChannelRow, len(users))
	createdAt := make(map[int]int64, len(users))
	for _, user := range users {
		createdAt[user.Id] = user.CreatedAt
		row := organic
		if found := rows[user.InviterId]; found != nil {
			row = found
		} else if user.InviterId > 0 {
			row = invited
		}
		rowOf[user.Id] = row
		giftRowOf[user.Id] = cmp.Or(rows[user.Id], row)
		row.Accounts++
	}
	inRange := func(at int64) bool { return at >= r.Start && at < r.End }

	orders, err := readPaidOrders(0, 0)
	if err != nil {
		return nil, err
	}
	paidOrders := make(map[int]int)
	firstPaid := firstPaidTimes(orders)
	payers := make(map[int]bool)
	for _, order := range orders {
		if order.Money <= 0 {
			continue
		}
		paidOrders[order.UserId]++
		if !inRange(order.CreateTime) {
			continue
		}
		row := rowOf[order.UserId]
		if row == nil {
			continue
		}
		row.Revenue += order.Money
		created := createdAt[order.UserId]
		if inRange(created) {
			row.RevenueNewAccounts += order.Money
		}
		if row.FeeStart > 0 && created >= row.FeeStart {
			row.RevenueSinceFee += order.Money
		}
		if !payers[order.UserId] {
			payers[order.UserId] = true
			row.Payers++
		}
	}
	for userID, first := range firstPaid {
		if row := rowOf[userID]; row != nil && inRange(first) {
			row.NewPayers++
		}
	}
	for _, user := range users {
		if !inRange(user.CreatedAt) {
			continue
		}
		row := rowOf[user.Id]
		row.Registered++
		if user.RequestCount > 0 {
			row.Activated++
		}
		if paidOrders[user.Id] > 0 {
			row.Paid++
		}
		if paidOrders[user.Id] > 1 {
			row.Repeat++
		}
	}

	now := time.Now().Unix()
	var plans []struct {
		UserId      int
		AmountTotal int64
		AmountUsed  int64
		EndTime     int64
		Status      string
		Source      string
		CreatedAt   int64
	}
	if err := DB.Model(&UserSubscription{}).Select("user_id, amount_total, amount_used, end_time, status, source, created_at").
		Where("source IN ?", []string{"admin", SubscriptionSourceAffiliateGift}).Find(&plans).Error; err != nil {
		return nil, err
	}
	// An account holding an administrator's plan cannot tell which of its
	// given plans covered a request, so none of its gift counts as invite
	// gift.
	inviteGifted := make(map[int]bool)
	adminGifted := make(map[int]bool)
	for _, plan := range plans {
		if plan.Source == SubscriptionSourceAffiliateGift {
			inviteGifted[plan.UserId] = true
		} else {
			adminGifted[plan.UserId] = true
		}
	}

	history, err := readWalletHistory(max(r.End, now+1))
	if err != nil {
		return nil, err
	}
	hours, stale, err := loadInsightHoursStale(r)
	if err != nil {
		return nil, err
	}
	for _, hour := range hours {
		for _, user := range hour.users {
			row := rowOf[user.UserId]
			if row == nil {
				continue
			}
			row.ConsumptionUSD += float64(user.Quota)
			giftRow := giftRowOf[user.UserId]
			share := history.paidShare(user.UserId, min(hour.start+3600, r.End))
			giftRow.GiftConsumptionUSD += float64(user.GiftQuota) + float64(user.WalletQuota)*(1-share)
			if inviteGifted[user.UserId] && !adminGifted[user.UserId] {
				giftRow.InviteGiftUSD += float64(user.GiftQuota)
			}
		}
	}

	type holder struct{ deleted, disabled bool }
	holders := make(map[int]holder, len(users))
	for _, user := range users {
		holders[user.Id] = holder{deleted: user.DeletedAt.Valid, disabled: user.Status != common.UserStatusEnabled}
	}
	outstanding := func(row *ChannelRow, userID int, amount float64) {
		switch account := holders[userID]; {
		case account.deleted:
		case account.disabled:
			row.GiftDormantUSD += amount
		default:
			row.GiftOutstandingUSD += amount
		}
	}
	for _, plan := range plans {
		row := giftRowOf[plan.UserId]
		if row == nil {
			continue
		}
		if inRange(plan.CreatedAt) {
			row.GrantedUSD += float64(plan.AmountTotal)
		}
		if plan.Status == "active" && plan.EndTime > now {
			outstanding(row, plan.UserId, float64(max(plan.AmountTotal-plan.AmountUsed, 0)))
		}
	}
	var logs []AuditLog
	if err := LOG_DB.Model(&AuditLog{}).
		Where("created_at >= ? AND created_at < ? AND success = ? AND action IN ?", r.Start, r.End, true,
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
		row := giftRowOf[int(target)]
		if !ok || !hasBefore || !hasAfter || row == nil {
			continue
		}
		if after > before {
			row.GrantedUSD += float64(after - before)
		} else {
			row.ClawedBackUSD += float64(before - after)
		}
	}
	// Outstanding credit is valued at each wallet's price now.
	for _, user := range users {
		if user.Quota > 0 {
			outstanding(giftRowOf[user.Id], user.Id, float64(user.Quota)*(1-history.paidShare(user.Id, now+1)))
		}
	}

	var commissions []struct {
		UserId       int
		SourceUserId int
		Amount       int64
		CreatedAt    int64
	}
	if err := DB.Model(&AffiliateCommission{}).Select("user_id, source_user_id, amount, created_at").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Find(&commissions).Error; err != nil {
		return nil, err
	}
	for _, commission := range commissions {
		if row := rowOf[commission.SourceUserId]; row != nil {
			row.CommissionUSD += float64(commission.Amount)
		}
		if row := rows[commission.UserId]; row != nil {
			row.CommissionEarnedUSD += float64(commission.Amount)
			if feeActive(commission.UserId, commission.CreatedAt) {
				row.CommissionAccruingUSD += float64(commission.Amount)
			}
		}
	}

	ids := make([]int, 0, len(rows))
	for id := range rows {
		ids = append(ids, id)
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, err
	}
	result := &ChannelInsights{Costs: stored, StaleHours: stale}
	for id, row := range rows {
		row.Channel.Username = names[id]
		result.Channels = append(result.Channels, *row)
	}
	slices.SortFunc(result.Channels, func(a, b ChannelRow) int {
		return cmp.Or(cmp.Compare(b.Revenue, a.Revenue), cmp.Compare(b.Accounts, a.Accounts), cmp.Compare(a.Channel.UserID, b.Channel.UserID))
	})
	result.Channels = append(result.Channels, *invited, *organic)
	for i := range result.Channels {
		row := &result.Channels[i]
		row.Revenue = roundTo(row.Revenue, 2)
		row.RevenueNewAccounts = roundTo(row.RevenueNewAccounts, 2)
		row.RevenueSinceFee = roundTo(row.RevenueSinceFee, 2)
		for _, quota := range []*float64{&row.ConsumptionUSD, &row.GiftConsumptionUSD, &row.InviteGiftUSD, &row.GrantedUSD,
			&row.ClawedBackUSD, &row.GiftOutstandingUSD, &row.GiftDormantUSD, &row.CommissionUSD, &row.CommissionEarnedUSD,
			&row.CommissionAccruingUSD} {
			*quota = roundTo(max(*quota, 0)/common.QuotaPerUnit, 4)
		}
		row.FeeUSD = roundTo(row.FeeUSD, 2)
	}
	return result, nil
}
