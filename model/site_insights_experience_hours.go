package model

import (
	"cmp"
	"slices"
	"time"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// The experience view's events, kept by the hour.
//
// A refusal, a failed stream, a gate charge, a one-hour cache write nothing
// read and a task refund are found by a LIKE over the request logs' other
// column, which no index reaches: reading one hour costs about a quarter of a
// second on production, so a month is minutes and the first version of the
// view, which scanned at request time, took 45 seconds for a day. The events
// are therefore stored, an hour at a time, as the quality rollup and the model
// behavior are: FillInsightExperience stores the hours that are final, newest
// first, a few per tick, and the view reads stored hours and works out only
// the tail that is not final yet.
//
// An hour is final when the logs that decide it are all written. That is its
// own hour, the settle slack, and the hour after it: a one-hour cache write is
// unread only if no request of the same key followed within the hour.

const (
	// experienceFillDays is how far back the fill goes.
	experienceFillDays = 35
	// experienceHourSettle is how long after an hour ends its logs are all written.
	experienceHourSettle = insightLogInsertSlack
	// experienceTailBudget bounds the live read of the hours not final yet.
	experienceTailBudget = 30 * time.Second
	// Kinds stored besides the four wasted ones.
	experienceKindRefund        = "refund"
	experienceKindCacheUnpriced = "cache_unpriced"
)

// InsightExperienceHour is one event of an hour. The row with LogId 0 marks
// the hour as stored, so an hour with no event is told from one not read yet.
type InsightExperienceHour struct {
	HourStart int64 `gorm:"primaryKey;autoIncrement:false"`
	// LogId is the id of the log the event came from; 0 for the marker.
	LogId     int     `gorm:"primaryKey;autoIncrement:false"`
	UserId    int     `gorm:"not null;default:0"`
	EventAt   int64   `gorm:"bigint;not null;default:0"`
	Kind      string  `gorm:"type:varchar(16)"`
	Usd       float64 `gorm:"not null;default:0"`
	ModelName string  `gorm:"type:varchar(191)"`
	Category  string  `gorm:"type:varchar(64)"`
	RequestId string  `gorm:"type:varchar(128)"`
}

func experienceStaff() (map[int]bool, error) {
	ids, err := StaffUserIDs()
	if err != nil {
		return nil, err
	}
	staff := make(map[int]bool, len(ids))
	for _, id := range ids {
		staff[id] = true
	}
	return staff, nil
}

// experienceClip cuts a text to the column it is stored in: an upstream's
// refusal category is not ours to bound, and a value too long for the column
// would fail the insert of its whole hour, again at every tick.
func experienceClip(text string, limit int) string {
	if runes := []rune(text); len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

func experienceEvent(row experienceLog, kind string, usd float64, category string) InsightExperienceHour {
	return InsightExperienceHour{
		HourStart: insightHourKey(row.CreatedAt), LogId: row.Id, UserId: row.UserId, EventAt: row.CreatedAt,
		Kind: kind, Usd: usd, ModelName: experienceClip(row.ModelName, 191),
		Category: experienceClip(category, 64), RequestId: experienceClip(row.RequestId, 128),
	}
}

// computeExperienceEvents reads the events of the customers' logs in
// [start, end) from the request logs. A one-hour cache write is judged only if
// it was made before judgedUntil, and is unread if none of the requests read
// up to requestsUntil followed it within the hour. It reports whether the row
// bound cut a scan short.
func computeExperienceEvents(start, end, judgedUntil, requestsUntil int64, staff map[int]bool) ([]InsightExperienceHour, bool, error) {
	var events []InsightExperienceHour
	taken := make(map[int]bool)

	_, truncated, err := scanExperienceLogs(start, end, experienceEventWindow, experienceEventMarkers, experienceTailBudget, func(row experienceLog) {
		if staff[row.UserId] || row.Quota <= 0 {
			return
		}
		var other experienceOther
		if err := common.UnmarshalJsonStr(row.Other, &other); err != nil {
			return
		}
		kind := ""
		switch {
		case other.UpstreamRefusal:
			kind = WasteRefusal
		case slices.Contains(experienceAbnormalEnds, other.StreamStatus.EndReason):
			kind = WasteFailedBilled
		case other.AdminInfo.LimitedPlanIPGate == LimitedPlanGateWallet:
			kind = WasteGateWallet
		}
		if kind == "" {
			return
		}
		category := ""
		if kind == WasteRefusal {
			category = cmp.Or(other.UpstreamRefusalCategory, "unknown")
		}
		taken[row.Id] = true
		events = append(events, experienceEvent(row, kind, quotaUSD(int64(row.Quota)), category))
	})
	if err != nil {
		return nil, false, err
	}

	// Task refunds are rare: one read by the created_at index. A refund log is
	// told apart from the settlement delta of a task that ran cheaper than
	// reserved, which carries pre_consumed_quota.
	var refunds []experienceLog
	if err := LOG_DB.Model(&Log{}).
		Select("id, user_id, token_id, created_at, model_name, quota, request_id, other").
		Where("type = ? AND created_at >= ? AND created_at < ?", LogTypeRefund, start, end).
		Find(&refunds).Error; err != nil {
		return nil, false, err
	}
	for _, row := range refunds {
		if staff[row.UserId] || row.Quota <= 0 {
			continue
		}
		var other experienceOther
		if err := common.UnmarshalJsonStr(row.Other, &other); err != nil {
			continue
		}
		if other.PreConsumedQuota != nil || (!other.IsTask && other.TaskId == "") {
			continue
		}
		events = append(events, experienceEvent(row, experienceKindRefund, quotaUSD(int64(row.Quota)), ""))
	}

	// One-hour writes: the extra they cost over five minutes, for the ones
	// nothing of the same key was requested after within the hour.
	cacheEnd := min(end, judgedUntil+1)
	if cacheEnd <= start {
		return events, truncated, nil
	}
	var writes []experienceLog
	_, cacheTruncated, err := scanExperienceLogs(start, cacheEnd, experienceCacheWindow, []string{experienceCacheMarker}, experienceTailBudget, func(row experienceLog) {
		if !staff[row.UserId] && row.Quota > 0 && !taken[row.Id] {
			writes = append(writes, row)
		}
	})
	if err != nil {
		return nil, false, err
	}
	truncated = truncated || cacheTruncated
	if len(writes) == 0 {
		return events, truncated, nil
	}

	type keyOf struct{ user, token int }
	// The requests that could follow a write are the same customers'.
	writers := make(map[int]bool)
	for _, row := range writes {
		writers[row.UserId] = true
	}
	ids := make([]int, 0, len(writers))
	for id := range writers {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	times := make(map[keyOf][]int64)
	for from := 0; from < len(ids); from += experienceCacheUsersPerRead {
		var chunk []struct {
			UserId    int
			TokenId   int
			CreatedAt int64
		}
		if err := LOG_DB.Model(&Log{}).Select("user_id, token_id, created_at").
			Where("type = ? AND created_at >= ? AND created_at < ? AND user_id IN ?", LogTypeConsume, start, requestsUntil,
				ids[from:min(from+experienceCacheUsersPerRead, len(ids))]).
			Find(&chunk).Error; err != nil {
			return nil, false, err
		}
		for _, request := range chunk {
			key := keyOf{request.UserId, request.TokenId}
			times[key] = append(times[key], request.CreatedAt)
		}
	}
	for _, series := range times {
		slices.Sort(series)
	}
	for _, row := range writes {
		var other experienceOther
		if err := common.UnmarshalJsonStr(row.Other, &other); err != nil || other.CacheCreationTokens1h <= 0 {
			continue
		}
		series := times[keyOf{row.UserId, row.TokenId}]
		first, _ := slices.BinarySearch(series, row.CreatedAt)
		last, _ := slices.BinarySearch(series, row.CreatedAt+experienceCacheReuseSeconds+1)
		if last-first >= 2 {
			// Something of this key followed within the hour.
			continue
		}
		base := cmp.Or(other.CacheCreationRatio5m, other.CacheCreationRatio)
		if other.ModelRatio <= 0 || other.GroupRatio <= 0 || other.CacheCreationRatio1h <= base || base <= 0 {
			events = append(events, experienceEvent(row, experienceKindCacheUnpriced, 0, ""))
			continue
		}
		premium := float64(other.CacheCreationTokens1h) * (other.CacheCreationRatio1h - base) * other.ModelRatio * other.GroupRatio
		events = append(events, experienceEvent(row, WasteCache1h, roundTo(premium/common.QuotaPerUnit, 6), ""))
	}
	return events, truncated, nil
}

func storeExperienceHour(start int64, events []InsightExperienceHour) error {
	rows := make([]InsightExperienceHour, 0, len(events)+1)
	rows = append(rows, InsightExperienceHour{HourStart: start})
	for _, event := range events {
		event.HourStart = start
		rows = append(rows, event)
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("hour_start = ?", start).Delete(&InsightExperienceHour{}).Error; err != nil {
			return err
		}
		return tx.CreateInBatches(rows, 500).Error
	})
	if err == nil {
		return nil
	}
	// During a release both colors may store the same hour; the loser fails on
	// the key and the hour is there all the same.
	var marked int64
	if DB.Model(&InsightExperienceHour{}).Where("hour_start = ? AND log_id = 0", start).Count(&marked).Error == nil && marked > 0 {
		return nil
	}
	return err
}

// experienceHourFinal: the hour's own logs, the settle slack, and the hour
// the cache reuse looks into have all been written.
func experienceHourFinal(start, now int64) bool {
	return start+3600+experienceCacheReuseSeconds+experienceHourSettle <= now
}

// newestFinalExperienceHour is the start of the newest hour that is final.
func newestFinalExperienceHour(now int64) int64 {
	newest := insightHourKey(now)
	for !experienceHourFinal(newest, now) {
		newest -= 3600
	}
	return newest
}

// FillInsightExperience stores the events of the final hours of the last
// experienceFillDays that are not stored, newest first, at most limit of them,
// and returns how many it stored.
func FillInsightExperience(limit int) (int, error) {
	return fillInsightExperience(time.Now().Unix(), limit)
}

func fillInsightExperience(now int64, limit int) (int, error) {
	newest := newestFinalExperienceHour(now)
	earliest, err := InsightLogsSince()
	if err != nil || earliest == 0 {
		return 0, err
	}
	oldest := max(newest-experienceFillDays*86400, insightHourKey(earliest))
	var have []int64
	if err := DB.Model(&InsightExperienceHour{}).Where("hour_start >= ? AND hour_start <= ? AND log_id = 0", oldest, newest).
		Pluck("hour_start", &have).Error; err != nil {
		return 0, err
	}
	stored := make(map[int64]bool, len(have))
	for _, start := range have {
		stored[start] = true
	}
	var staff map[int]bool
	filled := 0
	for start := newest; start >= oldest && filled < limit; start -= 3600 {
		if stored[start] {
			continue
		}
		if staff == nil {
			if staff, err = experienceStaff(); err != nil {
				return filled, err
			}
		}
		// The hour is final: every write in it is judged, and the requests that
		// could follow the last of them lie before start + 2 hours.
		end := start + 3600
		events, _, err := computeExperienceEvents(start, end, end, end+experienceCacheReuseSeconds, staff)
		if err != nil {
			return filled, err
		}
		if err := storeExperienceHour(start, events); err != nil {
			return filled, err
		}
		filled++
	}
	return filled, nil
}

// readExperienceEvents returns the customers' events in [r.Start, r.End): the
// stored hours, newest first as far back as they run without a gap, and the
// tail that is not final yet, worked out from the logs. covered is where the
// events begin: r.Start when the whole range was read; truncated says the tail
// hit the row bound.
func readExperienceEvents(r InsightsRange, now int64, staff map[int]bool) (events []InsightExperienceHour, covered int64, truncated bool, err error) {
	finalNewest := newestFinalExperienceHour(now)
	liveFrom := finalNewest + 3600
	covered = r.Start
	bottom := insightHourKey(r.Start)
	top := min(finalNewest, insightHourKey(r.End-1))
	if top >= bottom {
		var have []int64
		if err = DB.Model(&InsightExperienceHour{}).Where("hour_start >= ? AND hour_start <= ? AND log_id = 0", bottom, top).
			Pluck("hour_start", &have).Error; err != nil {
			return
		}
		stored := make(map[int64]bool, len(have))
		for _, start := range have {
			stored[start] = true
		}
		first := top + 3600
		for first-3600 >= bottom && stored[first-3600] {
			first -= 3600
		}
		covered = max(r.Start, first)
		if first <= top {
			var rows []InsightExperienceHour
			if err = DB.Where("hour_start >= ? AND hour_start <= ? AND log_id > 0 AND event_at >= ? AND event_at < ?", first, top, r.Start, r.End).
				Find(&rows).Error; err != nil {
				return
			}
			events = rows
		} else {
			// Not even the newest hour is stored: nothing before the tail is read.
			covered = min(max(r.Start, liveFrom), r.End)
		}
	}
	if r.End > liveFrom {
		tailStart := max(r.Start, liveFrom)
		var tail []InsightExperienceHour
		tail, truncated, err = computeExperienceEvents(tailStart, r.End, r.End-experienceCacheReuseSeconds, r.End, staff)
		if err != nil {
			return
		}
		events = append(events, tail...)
	}
	events = slices.DeleteFunc(events, func(event InsightExperienceHour) bool { return staff[event.UserId] })
	return events, covered, truncated, nil
}
