package model

import (
	"cmp"
	"encoding/base64"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"

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
	// Kinds stored besides the wasted ones.
	experienceKindRefund        = "refund"
	experienceKindCacheUnpriced = "cache_unpriced"
	experienceKindCachePaid     = "cache_paid"
	experienceKindCacheSaved    = "cache_saved"
	// experienceHourVersion is stored in the marker's category. An hour stored
	// under another version is served as it is, counted stale, and stored again.
	experienceHourVersion = "v2"
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
	// Requests is how many requests a summed cache row stands for; an event
	// row stands for one and may read 0, as rows stored before the column do.
	Requests int64 `gorm:"not null;default:0"`
	// NoOutput: the request returned no output token.
	NoOutput bool `gorm:"not null;default:false"`
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
// [start, end) from the request logs. A one-hour cache write is judged unread
// only if it was made before judgedUntil and none of the requests read up to
// requestsUntil followed it within the hour. It reports whether the row bound
// cut a scan short.
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
		kind, category := experienceEventKind(other)
		if kind == "" {
			return
		}
		taken[row.Id] = true
		event := experienceEvent(row, kind, quotaUSD(int64(row.Quota)), category)
		event.NoOutput = row.CompletionTokens == 0
		events = append(events, event)
	})
	if err != nil {
		return nil, false, err
	}

	// Task refunds are rare: one read by the created_at index. A refund log is
	// told apart from the settlement delta of a task that ran cheaper than
	// reserved, which carries pre_consumed_quota.
	var refunds []experienceLog
	if err := LOG_DB.Model(&Log{}).Select(experienceLogColumns).
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

	cache, cacheTruncated, err := computeExperienceCache(start, end, judgedUntil, requestsUntil, staff, taken)
	if err != nil {
		return nil, false, err
	}
	return append(events, cache...), truncated || cacheTruncated, nil
}

// experienceEventKind names the kind of a log the event markers matched, and
// its category: the refusal's category, or the cause of a failed or
// cancelled stream.
func experienceEventKind(other experienceOther) (kind, category string) {
	reason, endError := other.StreamStatus.EndReason, other.StreamStatus.EndError
	switch {
	case other.UpstreamRefusal:
		return WasteRefusal, cmp.Or(other.UpstreamRefusalCategory, "unknown")
	case reason == "client_gone" || reason == "scanner_error" && strings.Contains(endError, "context canceled"):
		// Before the relay told them apart, a client hanging up during a read
		// was recorded as scanner_error with the client's "context canceled".
		return ExperienceClientCancel, ""
	case slices.Contains(experienceAbnormalEnds, reason):
		return WasteFailedBilled, experienceFailureCause(reason, endError)
	case other.AdminInfo.LimitedPlanIPGate == LimitedPlanGateWallet:
		return WasteGateWallet, ""
	}
	return "", ""
}

// experienceFailureCause groups an abnormal end by what broke.
func experienceFailureCause(reason, endError string) string {
	if reason != "scanner_error" {
		return reason
	}
	switch {
	case strings.Contains(endError, "connection reset"):
		return "reset"
	case strings.Contains(endError, "stream error") || strings.Contains(endError, "INTERNAL_ERROR"):
		return "http2"
	case strings.Contains(endError, "EOF"):
		return "eof"
	case strings.Contains(endError, "deadline exceeded") || strings.Contains(endError, "timeout"):
		return "timeout"
	}
	return "other"
}

// experienceCacheTally sums one customer's hour of one cache kind.
type experienceCacheTally struct {
	key      experienceCacheKey
	at       int64
	requests int64
	usd      float64
}

type experienceCacheKey struct {
	hour int64
	user int
	kind string
}

// experienceCacheKinds numbers the cache kinds for the log id of their rows.
var experienceCacheKinds = map[string]int{
	experienceKindCachePaid: 1, WasteCache1h: 2, experienceKindCacheSaved: 3, experienceKindCacheUnpriced: 4,
}

// computeExperienceCache prices the one-hour cache of the customers' requests
// in [start, end): what its writes cost over five-minute ones, the part of
// that nothing read, and what its reads saved. A read saved money when the
// key's previous request came more than five minutes and at most an hour
// before it: a five-minute entry would have expired and the read would have
// been a write. Both are estimates by the key, which may carry several
// threads. They are thousands an hour, so they are stored summed per
// customer, hour and kind, under a negative log id.
func computeExperienceCache(start, end, judgedUntil, requestsUntil int64, staff map[int]bool, taken map[int]bool) ([]InsightExperienceHour, bool, error) {
	var rows []experienceLog
	_, truncated, err := scanExperienceLogs(start, end, experienceCacheWindow, experienceCacheMarkers, experienceTailBudget, func(row experienceLog) {
		if !staff[row.UserId] && row.Quota > 0 && !taken[row.Id] {
			rows = append(rows, row)
		}
	})
	if err != nil || len(rows) == 0 {
		return nil, truncated, err
	}

	type keyOf struct{ user, token int }
	writers := make(map[int]bool)
	for _, row := range rows {
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
			Where("type = ? AND created_at >= ? AND created_at < ? AND user_id IN ?", LogTypeConsume,
				start-experienceCacheReuseSeconds, requestsUntil, ids[from:min(from+experienceCacheUsersPerRead, len(ids))]).
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

	sums := make(map[experienceCacheKey]*experienceCacheTally)
	add := func(row experienceLog, kind string, usd float64) {
		hour := insightHourKey(row.CreatedAt)
		key := experienceCacheKey{hour, row.UserId, kind}
		sum := sums[key]
		if sum == nil {
			sum = &experienceCacheTally{key: key, at: max(hour, start)}
			sums[key] = sum
		}
		sum.requests++
		sum.usd += usd
	}
	for _, row := range rows {
		var other experienceOther
		if err := common.UnmarshalJsonStr(row.Other, &other); err != nil {
			continue
		}
		price, ok := experienceCachePricing(row, other)
		series := times[keyOf{row.UserId, row.TokenId}]
		at, _ := slices.BinarySearch(series, row.CreatedAt)
		if !ok {
			if other.CacheCreationTokens1h > 0 || other.CacheTokens > 0 {
				add(row, experienceKindCacheUnpriced, 0)
			}
			continue
		}
		if other.CacheCreationTokens1h > 0 {
			premium := price.premium()
			add(row, experienceKindCachePaid, premium)
			following, _ := slices.BinarySearch(series, row.CreatedAt+experienceCacheReuseSeconds+1)
			// The write's own request is in the series; another one of the key
			// within the hour may have read it.
			if row.CreatedAt <= judgedUntil && following-at < 2 {
				add(row, WasteCache1h, premium)
			}
		}
		if other.CacheTokens > 0 && at > 0 {
			gap := row.CreatedAt - series[at-1]
			if gap > experienceCacheShortSeconds && gap <= experienceCacheReuseSeconds {
				if saved := price.saved(); saved > 0 {
					add(row, experienceKindCacheSaved, saved)
				}
			}
		}
	}

	events := make([]InsightExperienceHour, 0, len(sums))
	for _, sum := range sums {
		events = append(events, InsightExperienceHour{
			HourStart: sum.key.hour, LogId: -(sum.key.user*16 + experienceCacheKinds[sum.key.kind]),
			UserId: sum.key.user, EventAt: sum.at, Kind: sum.key.kind,
			Usd: roundTo(sum.usd/common.QuotaPerUnit, 6), Requests: sum.requests,
		})
	}
	slices.SortFunc(events, func(a, b InsightExperienceHour) int {
		return cmp.Or(cmp.Compare(a.HourStart, b.HourStart), cmp.Compare(a.LogId, b.LogId))
	})
	return events, truncated, nil
}

// experienceCachePrice prices a log's cache tokens in quota, by its ratios or
// by the tiered expression it was billed with.
type experienceCachePrice struct {
	params billingexpr.TokenParams
	expr   string
	// ratio pricing
	write5m, write1h, read, scale float64
}

func experienceCachePricing(row experienceLog, other experienceOther) (experienceCachePrice, bool) {
	price := experienceCachePrice{}
	cc1h := float64(other.CacheCreationTokens1h)
	cc := max(0, float64(other.CacheCreationTokens)-cc1h)
	cr := float64(other.CacheTokens)
	p := float64(row.PromptTokens)
	price.params = billingexpr.TokenParams{P: p, C: float64(row.CompletionTokens), Len: p + cr + cc + cc1h, CR: cr, CC: cc, CC1h: cc1h}
	if other.BillingMode == "tiered_expr" {
		expr, err := base64.StdEncoding.DecodeString(other.ExprB64)
		if err != nil || len(expr) == 0 || other.GroupRatio <= 0 {
			return price, false
		}
		price.expr = string(expr)
		price.scale = common.QuotaPerUnit / 1_000_000 * other.GroupRatio
		_, ok := price.cost(price.params)
		return price, ok
	}
	price.write5m = cmp.Or(other.CacheCreationRatio5m, other.CacheCreationRatio)
	price.write1h = other.CacheCreationRatio1h
	price.read = other.CacheRatio
	price.scale = other.ModelRatio * other.GroupRatio
	if price.scale <= 0 || price.write5m <= 0 || price.write5m <= price.read {
		return price, false
	}
	if cc1h > 0 && price.write1h <= price.write5m {
		return price, false
	}
	return price, true
}

func (price experienceCachePrice) cost(params billingexpr.TokenParams) (float64, bool) {
	cost, _, err := billingexpr.RunExpr(price.expr, params)
	if err != nil {
		return 0, false
	}
	return cost * price.scale, true
}

// premium is what the one-hour writes cost over five-minute ones.
func (price experienceCachePrice) premium() float64 {
	if price.expr == "" {
		return price.params.CC1h * (price.write1h - price.write5m) * price.scale
	}
	as5m := price.params
	as5m.CC, as5m.CC1h = as5m.CC+as5m.CC1h, 0
	paid, _ := price.cost(price.params)
	instead, _ := price.cost(as5m)
	return max(0, paid-instead)
}

// saved is what the cache reads would have cost written as five-minute entries.
func (price experienceCachePrice) saved() float64 {
	if price.expr == "" {
		return price.params.CR * (price.write5m - price.read) * price.scale
	}
	missed := price.params
	missed.CC, missed.CR = missed.CC+missed.CR, 0
	paid, _ := price.cost(price.params)
	instead, _ := price.cost(missed)
	return max(0, instead-paid)
}

func storeExperienceHour(start int64, events []InsightExperienceHour) error {
	rows := make([]InsightExperienceHour, 0, len(events)+1)
	rows = append(rows, InsightExperienceHour{HourStart: start, Category: experienceHourVersion})
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
	if DB.Model(&InsightExperienceHour{}).Where("hour_start = ? AND log_id = 0 AND category = ?", start, experienceHourVersion).
		Count(&marked).Error == nil && marked > 0 {
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
	if err := DB.Model(&InsightExperienceHour{}).
		Where("hour_start >= ? AND hour_start <= ? AND log_id = 0 AND category = ?", oldest, newest, experienceHourVersion).
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
func readExperienceEvents(r InsightsRange, now int64, staff map[int]bool) (events []InsightExperienceHour, covered int64, truncated bool, stale int, err error) {
	finalNewest := newestFinalExperienceHour(now)
	liveFrom := finalNewest + 3600
	covered = r.Start
	bottom := insightHourKey(r.Start)
	top := min(finalNewest, insightHourKey(r.End-1))
	if top >= bottom {
		var have []InsightExperienceHour
		if err = DB.Model(&InsightExperienceHour{}).Select("hour_start, category").
			Where("hour_start >= ? AND hour_start <= ? AND log_id = 0", bottom, top).
			Find(&have).Error; err != nil {
			return
		}
		stored := make(map[int64]bool, len(have))
		for _, marker := range have {
			stored[marker.HourStart] = true
			if marker.Category != experienceHourVersion {
				stale++
			}
		}
		first := top + 3600
		for first-3600 >= bottom && stored[first-3600] {
			first -= 3600
		}
		covered = max(r.Start, first)
		if first <= top {
			var rows []InsightExperienceHour
			if err = DB.Where("hour_start >= ? AND hour_start <= ? AND log_id <> 0 AND event_at >= ? AND event_at < ?", first, top, r.Start, r.End).
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
	return events, covered, truncated, stale, nil
}
