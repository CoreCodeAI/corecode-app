package model

import (
	"cmp"
	"slices"
)

// InviterReturn is what one inviter's invitees brought in over the range.
type InviterReturn struct {
	UserRef
	Invitees      int64   `json:"invitees"`
	ActiveInvitee int64   `json:"active_invitees"`
	SpendUSD      float64 `json:"spend_usd"`
	Payments      float64 `json:"payments"`
	CommissionUSD float64 `json:"commission_usd"`
}

// ModelEconomics allocates the range's revenue to models by their share of
// list-price consumption. It is an estimate: customers pay for balance, not
// for a model.
type ModelEconomics struct {
	Model           string  `json:"model"`
	QuotaUSD        float64 `json:"quota_usd"`
	Share           float64 `json:"share"`
	Requests        int64   `json:"requests"`
	Users           int64   `json:"users"`
	PerRequestUSD   float64 `json:"per_request_usd"`
	RevenueEstimate float64 `json:"revenue_estimate"`
	CacheShare      float64 `json:"cache_share"`
}

// BusinessInsights covers the referral program, model economics, user
// groups and client versions.
type BusinessInsights struct {
	Inviters          int64            `json:"inviters"`
	Invitees          int64            `json:"invitees"`
	InviteeSpendUSD   float64          `json:"invitee_spend_usd"`
	InviteePayments   float64          `json:"invitee_payments"`
	CommissionUSD     float64          `json:"commission_usd"`
	CommissionToSpend float64          `json:"commission_to_spend"`
	TopInviters       []InviterReturn  `json:"top_inviters"`
	Models            []ModelEconomics `json:"models"`
	Revenue           float64          `json:"revenue"`
	Groups            []NamedCount     `json:"groups"`
	Clients           []NamedCount     `json:"clients"`
	ClientsTruncated  bool             `json:"clients_truncated"`
}

func GetBusinessInsights(r InsightsRange) (*BusinessInsights, error) {
	result := &BusinessInsights{}
	var invitees []struct {
		Id        int
		InviterId int
	}
	if err := DB.Model(&User{}).Select("id, inviter_id").Where("inviter_id > 0").Find(&invitees).Error; err != nil {
		return nil, err
	}
	inviterOf := make(map[int]int, len(invitees))
	inviters := make(map[int]*InviterReturn)
	for _, invitee := range invitees {
		inviterOf[invitee.Id] = invitee.InviterId
		inviter := inviters[invitee.InviterId]
		if inviter == nil {
			inviter = &InviterReturn{UserRef: UserRef{UserID: invitee.InviterId}}
			inviters[invitee.InviterId] = inviter
		}
		inviter.Invitees++
	}
	result.Inviters, result.Invitees = int64(len(inviters)), int64(len(invitees))

	quota, err := readInsightQuota(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	activeInvitees := make(map[int]bool)
	type modelBucket struct {
		quota, requests, tokens, cache int64
		users                          map[int]bool
	}
	models := make(map[string]*modelBucket)
	var total int64
	for _, row := range quota {
		total += int64(row.Quota)
		bucket := models[row.ModelName]
		if bucket == nil {
			bucket = &modelBucket{users: make(map[int]bool)}
			models[row.ModelName] = bucket
		}
		bucket.quota += int64(row.Quota)
		bucket.requests += int64(row.Count)
		bucket.tokens += int64(row.TokenUsed)
		bucket.cache += row.CacheReadTokens
		bucket.users[row.UserID] = true
		if inviterID, ok := inviterOf[row.UserID]; ok {
			inviter := inviters[inviterID]
			inviter.SpendUSD += float64(row.Quota)
			if !activeInvitees[row.UserID] {
				activeInvitees[row.UserID] = true
				inviter.ActiveInvitee++
			}
		}
	}
	orders, err := readOrdersPaidIn(r.Start, r.End)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		result.Revenue += order.Money
		if inviterID, ok := inviterOf[order.UserId]; ok {
			inviters[inviterID].Payments += order.Money
			result.InviteePayments += order.Money
		}
	}
	result.Revenue = roundTo(result.Revenue, 2)
	result.InviteePayments = roundTo(result.InviteePayments, 2)
	var commissions []struct {
		UserId int
		Total  int64
	}
	if err := DB.Model(&AffiliateCommission{}).Select("user_id, SUM(amount) AS total").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).Group("user_id").Find(&commissions).Error; err != nil {
		return nil, err
	}
	var commissionTotal int64
	for _, commission := range commissions {
		commissionTotal += commission.Total
		inviter := inviters[commission.UserId]
		if inviter == nil {
			// Second-level commission reaches a channel with no direct
			// invitee in the users table's sense; still list it.
			inviter = &InviterReturn{UserRef: UserRef{UserID: commission.UserId}}
			inviters[commission.UserId] = inviter
		}
		inviter.CommissionUSD += float64(commission.Total)
	}
	var inviteeSpend int64
	ids := make([]int, 0, len(inviters))
	list := make([]InviterReturn, 0, len(inviters))
	for id, inviter := range inviters {
		inviteeSpend += int64(inviter.SpendUSD)
		inviter.SpendUSD = quotaUSD(int64(inviter.SpendUSD))
		inviter.CommissionUSD = quotaUSD(int64(inviter.CommissionUSD))
		inviter.Payments = roundTo(inviter.Payments, 2)
		ids = append(ids, id)
		list = append(list, *inviter)
	}
	result.InviteeSpendUSD = quotaUSD(inviteeSpend)
	result.CommissionUSD = quotaUSD(commissionTotal)
	result.CommissionToSpend = ratio(float64(commissionTotal), float64(inviteeSpend))
	slices.SortFunc(list, func(a, b InviterReturn) int {
		return cmp.Or(cmp.Compare(b.SpendUSD, a.SpendUSD), cmp.Compare(b.Invitees, a.Invitees))
	})
	list = list[:min(len(list), insightsTopN*2)]
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Username = names[list[i].UserID]
	}
	result.TopInviters = list

	for name, bucket := range models {
		share := ratio(float64(bucket.quota), float64(total))
		result.Models = append(result.Models, ModelEconomics{
			Model:           name,
			QuotaUSD:        quotaUSD(bucket.quota),
			Share:           share,
			Requests:        bucket.requests,
			Users:           int64(len(bucket.users)),
			PerRequestUSD:   ratio(quotaUSD(bucket.quota), float64(bucket.requests)),
			RevenueEstimate: roundTo(result.Revenue*share, 2),
			CacheShare:      ratio(float64(bucket.cache), float64(bucket.tokens+bucket.cache)),
		})
	}
	slices.SortFunc(result.Models, func(a, b ModelEconomics) int { return cmp.Compare(b.QuotaUSD, a.QuotaUSD) })

	var groups []struct {
		UserGroup string
		Users     int64
	}
	if err := DB.Model(&User{}).Select(commonGroupCol + " AS user_group, COUNT(*) AS users").
		Group(commonGroupCol).Find(&groups).Error; err != nil {
		return nil, err
	}
	groupCounts := make(map[string]int64, len(groups))
	for _, group := range groups {
		groupCounts[group.UserGroup] = group.Users
	}
	result.Groups = sortedCounts(groupCounts)

	clients, truncated, err := clientBreakdown(r)
	if err != nil {
		return nil, err
	}
	result.Clients, result.ClientsTruncated = clients, truncated
	return result, nil
}

// clientBreakdown counts successful requests by the client product token
// logs carry since it was added; older logs have none and count as unknown.
func clientBreakdown(r InsightsRange) ([]NamedCount, bool, error) {
	hours, err := loadInsightHours(r)
	if err != nil {
		return nil, false, err
	}
	counts := make(map[string]int64)
	truncated := false
	for _, hour := range hours {
		mergeCounts(counts, hour.summary.Clients)
		truncated = truncated || hour.summary.Truncated
	}
	result := sortedCounts(counts)
	return result[:min(len(result), 20)], truncated, nil
}
