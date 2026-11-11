package model

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
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
// price; GiftConsumptionUSD the part no payment covers (given plans and the
// unpaid share of each wallet); GrantedUSD the credit given to them in the
// range (given plans, and administrators' balance changes); FeeUSD the
// channel's fee over the range; CommissionUSD what the channel earned in
// commission. GiftOutstandingUSD is given credit not yet spent, now.
// RevenueNewAccounts is the part of Revenue paid by accounts created in the
// range.
type ChannelRow struct {
	Segment            string  `json:"segment"`
	Channel            UserRef `json:"channel"`
	Tier               string  `json:"tier"`
	Accounts           int64   `json:"accounts"`
	Registered         int64   `json:"registered"`
	Activated          int64   `json:"activated"`
	Paid               int64   `json:"paid"`
	Repeat             int64   `json:"repeat"`
	Revenue            float64 `json:"revenue"`
	RevenueNewAccounts float64 `json:"revenue_new_accounts"`
	Payers             int64   `json:"payers"`
	NewPayers          int64   `json:"new_payers"`
	ConsumptionUSD     float64 `json:"consumption_usd"`
	GiftConsumptionUSD float64 `json:"gift_consumption_usd"`
	GrantedUSD         float64 `json:"granted_usd"`
	GiftOutstandingUSD float64 `json:"gift_outstanding_usd"`
	CommissionUSD      float64 `json:"commission_usd"`
	FeeUSD             float64 `json:"fee_usd"`
}

// ChannelInsights compares what each acquisition source brought in with what
// it cost over the range, and lists the recorded fees.
type ChannelInsights struct {
	Channels []ChannelRow  `json:"channels"`
	Costs    []ChannelCost `json:"costs"`
}

func GetChannelInsights(r InsightsRange) (*ChannelInsights, error) {
	costs, err := ReadChannelCosts()
	if err != nil {
		return nil, err
	}
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
	for _, cost := range costs {
		channel(cost.UserID)
		rows[cost.UserID].FeeUSD += cost.feeIn(r.Start, r.End)
	}
	invited := &ChannelRow{Segment: ChannelSegmentInvited}
	organic := &ChannelRow{Segment: ChannelSegmentOrganic}

	var users []struct {
		Id           int
		InviterId    int
		RequestCount int
		CreatedAt    int64
		Quota        int64
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, inviter_id, request_count, created_at, quota").
		Where("role < ?", common.RoleRootUser).Find(&users).Error; err != nil {
		return nil, err
	}
	rowOf := make(map[int]*ChannelRow, len(users))
	createdInRange := make(map[int]bool)
	for _, user := range users {
		if user.CreatedAt >= r.Start && user.CreatedAt < r.End {
			createdInRange[user.Id] = true
		}
		row := organic
		if found := rows[user.InviterId]; found != nil {
			row = found
		} else if user.InviterId > 0 {
			row = invited
		}
		rowOf[user.Id] = row
		row.Accounts++
	}

	orders, err := readPaidOrders(0, 0)
	if err != nil {
		return nil, err
	}
	paidOrders := make(map[int]int)
	firstPaid := make(map[int]int64)
	payers := make(map[int]bool)
	for _, order := range orders {
		if order.Money <= 0 {
			continue
		}
		paidOrders[order.UserId]++
		if first, ok := firstPaid[order.UserId]; !ok || order.CreateTime < first {
			firstPaid[order.UserId] = order.CreateTime
		}
		if order.CreateTime < r.Start || order.CreateTime >= r.End {
			continue
		}
		row := rowOf[order.UserId]
		if row == nil {
			continue
		}
		row.Revenue += order.Money
		if createdInRange[order.UserId] {
			row.RevenueNewAccounts += order.Money
		}
		if !payers[order.UserId] {
			payers[order.UserId] = true
			row.Payers++
		}
	}
	for userID, first := range firstPaid {
		if row := rowOf[userID]; row != nil && first >= r.Start && first < r.End {
			row.NewPayers++
		}
	}
	for _, user := range users {
		if user.CreatedAt < r.Start || user.CreatedAt >= r.End {
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
	prices, err := readWalletPrices(r.End)
	if err != nil {
		return nil, err
	}
	hours, err := loadInsightHours(r)
	if err != nil {
		return nil, err
	}
	for _, hour := range hours {
		for _, user := range hour.users {
			row := rowOf[user.UserId]
			if row == nil {
				continue
			}
			price := prices[user.UserId]
			row.ConsumptionUSD += float64(user.Quota)
			row.GiftConsumptionUSD += float64(user.GiftQuota) + float64(user.WalletQuota)*(1-price.paidShare)
		}
	}

	var plans []struct {
		UserId      int
		AmountTotal int64
		AmountUsed  int64
		EndTime     int64
		Status      string
		CreatedAt   int64
	}
	if err := DB.Model(&UserSubscription{}).Select("user_id, amount_total, amount_used, end_time, status, created_at").
		Where("source IN ?", []string{"admin", SubscriptionSourceAffiliateGift}).Find(&plans).Error; err != nil {
		return nil, err
	}
	for _, plan := range plans {
		row := rowOf[plan.UserId]
		if row == nil {
			continue
		}
		if plan.CreatedAt >= r.Start && plan.CreatedAt < r.End {
			row.GrantedUSD += float64(plan.AmountTotal)
		}
		if plan.Status == "active" && plan.EndTime > now {
			row.GiftOutstandingUSD += float64(max(plan.AmountTotal-plan.AmountUsed, 0))
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
		row := rowOf[int(target)]
		if ok && hasBefore && hasAfter && row != nil {
			row.GrantedUSD += float64(after - before)
		}
	}
	// Outstanding credit is valued at each wallet's price now.
	current := prices
	if r.End < now {
		if current, err = readWalletPrices(now + 1); err != nil {
			return nil, err
		}
	}
	for _, user := range users {
		if user.Quota > 0 {
			rowOf[user.Id].GiftOutstandingUSD += float64(user.Quota) * (1 - current[user.Id].paidShare)
		}
	}

	var commissions []struct {
		UserId int
		Total  int64
	}
	if err := DB.Model(&AffiliateCommission{}).Select("user_id, COALESCE(SUM(amount), 0) AS total").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Group("user_id").Find(&commissions).Error; err != nil {
		return nil, err
	}
	for _, commission := range commissions {
		if row := rows[commission.UserId]; row != nil {
			row.CommissionUSD += float64(commission.Total)
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
	result := &ChannelInsights{Costs: costs}
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
		row.ConsumptionUSD = roundTo(row.ConsumptionUSD/common.QuotaPerUnit, 4)
		row.GiftConsumptionUSD = roundTo(row.GiftConsumptionUSD/common.QuotaPerUnit, 4)
		row.GrantedUSD = roundTo(row.GrantedUSD/common.QuotaPerUnit, 4)
		row.GiftOutstandingUSD = roundTo(row.GiftOutstandingUSD/common.QuotaPerUnit, 4)
		row.CommissionUSD = roundTo(row.CommissionUSD/common.QuotaPerUnit, 4)
		row.FeeUSD = roundTo(row.FeeUSD, 2)
	}
	return result, nil
}
