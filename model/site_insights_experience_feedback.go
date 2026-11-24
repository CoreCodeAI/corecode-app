package model

import (
	"cmp"
	"slices"

	"gorm.io/gorm"
)

// fillExperienceConsumption sets what customers consumed over the span the
// logs were read for, from the hourly rollups, the whole the shares are of.
func fillExperienceConsumption(waste *ExperienceWaste, r InsightsRange, staffIDs []int) error {
	var total struct{ Total int64 }
	query := DB.Model(&QuotaData{}).Select("COALESCE(SUM(quota), 0) AS total").
		Where("created_at >= ? AND created_at < ?", insightHourKey(waste.LogStart), r.End)
	if len(staffIDs) > 0 {
		query = query.Where("user_id NOT IN ?", staffIDs)
	}
	if err := query.Scan(&total).Error; err != nil {
		return err
	}
	waste.ConsumedUSD = quotaUSD(total.Total)
	return nil
}

// fillExperienceUsers names the customers who lost the most, and for the most
// wasteful fifty says whether they ever filed a report and whether they have
// gone silent: the silent ones who never wrote are the people to write to.
func fillExperienceUsers(r InsightsRange, tally *experienceWasteTally, waste *ExperienceWaste) error {
	ranked := make([]*ExperienceUser, 0, len(tally.byUser))
	for _, entry := range tally.byUser {
		entry.TotalUSD = roundTo(entry.RefusalUSD+entry.FailedUSD+entry.GateUSD, 4)
		entry.RefusalUSD, entry.FailedUSD = roundTo(entry.RefusalUSD, 4), roundTo(entry.FailedUSD, 4)
		entry.GateUSD = roundTo(entry.GateUSD, 4)
		ranked = append(ranked, entry)
	}
	slices.SortFunc(ranked, func(a, b *ExperienceUser) int {
		return cmp.Or(cmp.Compare(b.TotalUSD, a.TotalUSD), cmp.Compare(a.UserID, b.UserID))
	})
	ranked = ranked[:min(experienceUsersChecked, len(ranked))]
	waste.Top, waste.Silent = []ExperienceUser{}, []ExperienceUser{}
	waste.CheckedTop = int64(len(ranked))
	if len(ranked) == 0 {
		return nil
	}
	ids := make([]int, len(ranked))
	for i, entry := range ranked {
		ids[i] = entry.UserID
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return err
	}
	var reported []int
	if err := DB.Model(&Feedback{}).Distinct().Where("user_id IN ?", ids).Pluck("user_id", &reported).Error; err != nil {
		return err
	}
	filed := make(map[int]bool, len(reported))
	for _, id := range reported {
		filed[id] = true
	}
	var seen []struct {
		UserId int
		Last   int64
	}
	if err := DB.Model(&QuotaData{}).Select("user_id, MAX(created_at) AS last").
		Where("user_id IN ? AND count > 0 AND created_at >= ? AND created_at < ?", ids, r.End-30*86400, r.End).
		Group("user_id").Find(&seen).Error; err != nil {
		return err
	}
	lastRequest := make(map[int]int64, len(seen))
	for _, row := range seen {
		lastRequest[row.UserId] = row.Last
	}
	for _, entry := range ranked {
		entry.Username = names[entry.UserID]
		entry.FiledFeedback = filed[entry.UserID]
		entry.LastRequestAt = lastRequest[entry.UserID]
		entry.Silent = entry.LastRequestAt < r.End-experienceSilentDays*86400
		if entry.FiledFeedback {
			waste.ReportedTop++
		}
		if len(waste.Top) < experienceUsersListed {
			waste.Top = append(waste.Top, *entry)
		}
		if entry.Silent && !entry.FiledFeedback && len(waste.Silent) < experienceUsersListed {
			waste.Silent = append(waste.Silent, *entry)
		}
	}
	return nil
}

// experienceRank is the nearest-rank percentile (0 < p <= 1) of sorted values.
func experienceRank(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(float64(len(sorted))*p+0.999999) - 1
	return sorted[min(max(rank, 0), len(sorted)-1)]
}

// fillExperienceFeedback reads the reports filed in the range: how many, of
// what kind, how fast the first reply came, how many wait, and whether the
// senders stayed.
func fillExperienceFeedback(r InsightsRange, staff map[int]bool, point func(int64) *ExperiencePoint, result *ExperienceInsights) error {
	feedback := &result.Feedback
	feedback.Statuses, feedback.Categories = []NamedCount{}, []NamedCount{}
	feedback.Waiting, feedback.Lapsed = []ExperienceWaiting{}, []ExperienceLapsed{}
	var rows []Feedback
	if err := DB.Model(&Feedback{}).
		Select("id, user_id, category, status, reward_quota, replied_time, created_time").
		Where("created_time >= ? AND created_time < ?", r.Start, r.End).Order("created_time asc, id asc").Find(&rows).Error; err != nil {
		return err
	}
	statuses, categories := make(map[string]int64), make(map[string]int64)
	var delays []int64
	var rewardQuota int64
	type sender struct {
		at       int64
		category string
	}
	senders := make(map[int]sender)
	for _, row := range rows {
		if staff[row.UserId] {
			continue
		}
		feedback.Total++
		statuses[row.Status]++
		categories[row.Category]++
		if p := point(row.CreatedTime); p != nil {
			switch row.Category {
			case FeedbackCategoryBug:
				p.Bug++
			case FeedbackCategorySuggestion:
				p.Suggestion++
			case FeedbackCategoryBilling:
				p.Billing++
			default:
				p.OtherFeedback++
			}
		}
		if row.RepliedTime > 0 && row.RepliedTime >= row.CreatedTime {
			delays = append(delays, row.RepliedTime-row.CreatedTime)
		}
		if row.RewardQuota > 0 {
			feedback.Rewarded++
			rewardQuota += int64(row.RewardQuota)
		}
		if _, first := senders[row.UserId]; !first {
			senders[row.UserId] = sender{row.CreatedTime, row.Category}
		}
	}
	feedback.Statuses, feedback.Categories = sortedCounts(statuses), sortedCounts(categories)
	slices.Sort(delays)
	feedback.Replied = int64(len(delays))
	feedback.FirstReplyP50, feedback.FirstReplyP90 = experienceRank(delays, 0.5), experienceRank(delays, 0.9)
	feedback.RewardUSD = quotaUSD(rewardQuota)

	// The queue now: all time, as of the range's end.
	staffList := make([]int, 0, len(staff))
	for id := range staff {
		staffList = append(staffList, id)
	}
	queue := func(condition string, args ...any) *gorm.DB {
		query := DB.Model(&Feedback{}).Where(condition, args...)
		if len(staffList) > 0 {
			query = query.Where("user_id NOT IN ?", staffList)
		}
		return query
	}
	if err := queue("status IN ? AND created_time < ?", []string{FeedbackStatusPending, FeedbackStatusProcessing}, r.End).
		Count(&feedback.Open).Error; err != nil {
		return err
	}
	untouched := func() *gorm.DB {
		// A report closed before replied_time was recorded still reads 0 there;
		// only one that is still open is waiting.
		return queue("replied_time = 0 AND created_time <= ? AND status IN ?", r.End-experienceWaitingSeconds,
			[]string{FeedbackStatusPending, FeedbackStatusProcessing})
	}
	if err := untouched().Count(&feedback.Unanswered24h).Error; err != nil {
		return err
	}
	var waits []Feedback
	if err := untouched().Select("id, user_id, category, title, created_time").
		Order("created_time asc, id asc").Limit(experienceWaitingKept).Find(&waits).Error; err != nil {
		return err
	}
	ids := make([]int, 0, len(waits)+len(senders))
	for _, wait := range waits {
		ids = append(ids, wait.UserId)
	}
	for id := range senders {
		ids = append(ids, id)
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return err
	}
	for _, wait := range waits {
		title := []rune(wait.Title)
		if len(title) > experienceTitleRunes {
			title = append(title[:experienceTitleRunes-1], '…')
		}
		feedback.Waiting = append(feedback.Waiting, ExperienceWaiting{
			UserRef: UserRef{UserID: wait.UserId, Username: names[wait.UserId]}, ID: wait.Id,
			Category: wait.Category, Title: string(title), CreatedTime: wait.CreatedTime,
		})
	}

	feedback.Senders = int64(len(senders))
	if len(senders) == 0 {
		return nil
	}
	senderIDs := make([]int, 0, len(senders))
	var earliest, latest int64
	for id, s := range senders {
		senderIDs = append(senderIDs, id)
		if earliest == 0 || s.at < earliest {
			earliest = s.at
		}
		latest = max(latest, s.at)
	}
	follow := int64(experienceFollowDays * 86400)
	var hours []struct {
		UserId   int
		CreateAt int64 `gorm:"column:created_at"`
		Quota    int64
		Requests int64
	}
	if err := DB.Model(&QuotaData{}).Select("user_id, created_at, SUM(quota) AS quota, SUM(count) AS requests").
		Where("user_id IN ? AND created_at >= ? AND created_at < ?", senderIDs, insightHourKey(earliest)-follow, min(r.End, latest+follow)).
		Group("user_id, created_at").Find(&hours).Error; err != nil {
		return err
	}
	byUser := make(map[int][]struct{ at, quota, requests int64 }, len(senderIDs))
	for _, hour := range hours {
		byUser[hour.UserId] = append(byUser[hour.UserId], struct{ at, quota, requests int64 }{hour.CreateAt, hour.Quota, hour.Requests})
	}
	var beforeQuota, afterQuota int64
	for _, id := range senderIDs {
		s := senders[id]
		at := insightHourKey(s.at)
		if at+follow+3600 > r.End {
			feedback.Pending++
			continue
		}
		var before, after, requests int64
		for _, hour := range byUser[id] {
			switch {
			case hour.at >= at-follow && hour.at < at:
				before += hour.quota
			case hour.at > at && hour.at < at+follow:
				after += hour.quota
				requests += hour.requests
			}
		}
		feedback.Judged++
		beforeQuota += before
		afterQuota += after
		if requests > 0 {
			feedback.Active++
			continue
		}
		feedback.Lapsed = append(feedback.Lapsed, ExperienceLapsed{
			UserRef: UserRef{UserID: id, Username: names[id]}, Category: s.category, At: s.at, BeforeUSD: quotaUSD(before),
		})
	}
	feedback.BeforeUSD, feedback.AfterUSD = quotaUSD(beforeQuota), quotaUSD(afterQuota)
	slices.SortFunc(feedback.Lapsed, func(a, b ExperienceLapsed) int {
		return cmp.Or(cmp.Compare(b.BeforeUSD, a.BeforeUSD), cmp.Compare(a.UserID, b.UserID))
	})
	if len(feedback.Lapsed) > experienceUsersListed {
		feedback.Lapsed = feedback.Lapsed[:experienceUsersListed]
	}
	return nil
}
