package model

import (
	"cmp"
	"math"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
)

// The model-behavior view answers one question: did a model's behavior change
// without anyone changing it? It reads how each model answers, per request:
// output tokens, reasoning tokens, first-token and total time, the upstream
// errors it returned and the cache it read. They are kept as hourly histograms
// in their own table, apart from the quality rollup, so adding them does not
// change that rollup's version (the keys view reads only hours stored at the
// current version) and a request-log hour is read once more, not rebuilt.
//
// An hour is read by the time its logs were written, not folded by request id:
// a consume log is one served request and an error log one failed try. Hours
// before this table existed are filled newest first by FillInsightBehavior, a
// few per tick; until then an hour is missing and the view says so.
//
// Requests are kept apart by input size (behaviorBandLimits): a long prompt
// brings a longer answer and a slower first token, so a day with more long
// prompts must not look like a model that got wordier. Each band is compared
// only with its own earlier days.

// behaviorBandLimits are the upper bounds, in input tokens, of the bands 1 to
// 3; band 4 is everything larger. Band 0 holds what has no input size: the
// failed tries.
var behaviorBandLimits = []int64{2_000, 16_000, 64_000}

const (
	// behaviorSettle is how long after an hour ends its logs are all written.
	behaviorSettle = insightLogInsertSlack
	// behaviorBaselineDays is how many days before a day its figures are
	// compared with.
	behaviorBaselineDays = 7
	// behaviorMinSamples is the fewest requests (or attempts, for errors) a
	// day and its baseline must each have before a change is judged.
	behaviorMinSamples = 50
	// A change above behaviorYellow is a yellow flag; above behaviorRed, red.
	behaviorYellow = 0.4
	behaviorRed    = 0.6
	// behaviorMinErrorGap is the smallest rise in error rate, in rate points,
	// that counts: 0.5 % to 0.8 % is +60 % and nothing to act on.
	behaviorMinErrorGap = 0.02
	// behaviorModelCap and behaviorModelMinRequests bound the models shown.
	behaviorModelCap         = 30
	behaviorModelMinRequests = 20
	// behaviorFillDays is how far back the fill goes.
	behaviorFillDays = 35
)

// Metrics a flag names.
const (
	BehaviorMetricOutput    = "output"
	BehaviorMetricReasoning = "reasoning"
	BehaviorMetricTTFT      = "ttft"
	BehaviorMetricLatency   = "latency"
	BehaviorMetricErrors    = "errors"
)

// InsightBehaviorHour is one model's behavior in one input band of an hour,
// customers only. The histograms are in JSON as the quality rollup's are. The
// row with an empty ModelName marks the hour as stored, so an hour with no
// request is told from one not read yet.
type InsightBehaviorHour struct {
	HourStart int64  `gorm:"primaryKey;autoIncrement:false"`
	ModelName string `gorm:"primaryKey;type:varchar(191)"`
	Band      int    `gorm:"primaryKey;autoIncrement:false"`
	Requests  int64  `gorm:"not null;default:0"`
	// Tries counts the failed tries the upstream is answerable for, by status
	// code in Statuses (band 0 only). No-channel refusals, the engine's own
	// rejections and the customers' own 4xx are left out.
	Tries    int64  `gorm:"not null;default:0"`
	Statuses string `gorm:"type:text"`
	// Input is the requests' input tokens and CacheRead those read from the
	// cache, so their ratio is the hit rate.
	Input     int64  `gorm:"not null;default:0"`
	CacheRead int64  `gorm:"not null;default:0"`
	Output    string `gorm:"type:text"`
	// Reasoning holds the requests that recorded reasoning tokens: a request
	// with none, or from before they were recorded, is not in it.
	Reasoning string `gorm:"type:text"`
	TTFT      string `gorm:"column:ttft;type:text"`
	Latency   string `gorm:"type:text"`
}

// behaviorBand is the band of a request with input input tokens.
func behaviorBand(input int64) int {
	for i, limit := range behaviorBandLimits {
		if input < limit {
			return i + 1
		}
	}
	return len(behaviorBandLimits) + 1
}

type behaviorBucket struct {
	row                              InsightBehaviorHour
	output, reasoning, ttft, latency histogram
	statuses                         map[string]int64
}

func newBehaviorBucket(start int64, name string, band int) *behaviorBucket {
	return &behaviorBucket{
		row:    InsightBehaviorHour{HourStart: start, ModelName: name, Band: band},
		output: histogram{}, reasoning: histogram{}, ttft: histogram{}, latency: histogram{},
		statuses: map[string]int64{},
	}
}

func (b *behaviorBucket) encode() InsightBehaviorHour {
	row := b.row
	row.Output, row.Reasoning = b.output.encode(), b.reasoning.encode()
	row.TTFT, row.Latency = b.ttft.encode(), b.latency.encode()
	if len(b.statuses) > 0 {
		data, _ := common.Marshal(b.statuses)
		row.Statuses = string(data)
	}
	return row
}

// behaviorLog is the part of a log the behavior rollup reads.
type behaviorLog struct {
	UserId           int
	Type             int
	Content          string
	ModelName        string
	PromptTokens     int
	CompletionTokens int
	UseTime          int
	IsStream         bool
	Other            string
}

// computeBehaviorHour aggregates the customers' logs written in the hour
// starting at start. staff lists the user ids to leave out.
func computeBehaviorHour(start int64, staff map[int]bool) ([]InsightBehaviorHour, error) {
	var logs []behaviorLog
	err := LOG_DB.Model(&Log{}).
		Select("user_id, type, content, model_name, prompt_tokens, completion_tokens, use_time, is_stream, other").
		Where("created_at >= ? AND created_at < ? AND type IN ? AND model_name <> ''", start, start+3600, []int{LogTypeConsume, LogTypeError}).
		Order("id asc").Limit(insightHourMaxLogRows).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	buckets := map[behaviorKey]*behaviorBucket{}
	bucketOf := func(name string, band int) *behaviorBucket {
		key := behaviorKey{name, band}
		bucket := buckets[key]
		if bucket == nil {
			bucket = newBehaviorBucket(start, name, band)
			buckets[key] = bucket
		}
		return bucket
	}
	for _, log := range logs {
		if staff[log.UserId] || ModelVendor(log.ModelName) == VendorMedia {
			continue
		}
		other := parseLogOther(log.Other)
		if log.Type == LogTypeError {
			if behaviorUpstreamTry(log.Content, other) {
				bucket := bucketOf(log.ModelName, 0)
				bucket.row.Tries++
				bucket.statuses[statusCodeName(logStatusCode(log.Content))]++
			}
			continue
		}
		if other.IsTask || other.ViolationFee || (log.PromptTokens == 0 && log.CompletionTokens == 0) {
			continue
		}
		input := uncachedPrompt(insightLog{PromptTokens: log.PromptTokens}, other) + other.CacheTokens + other.CacheCreationTokens
		bucket := bucketOf(log.ModelName, behaviorBand(input))
		bucket.row.Requests++
		bucket.row.Input += input
		bucket.row.CacheRead += other.CacheTokens
		bucket.output.add(int64(log.CompletionTokens))
		if other.ReasoningTokens > 0 {
			bucket.reasoning.add(other.ReasoningTokens)
		}
		bucket.latency.add(int64(log.UseTime))
		if log.IsStream && other.Frt > 0 {
			bucket.ttft.add(int64(other.Frt))
		}
	}
	rows := make([]InsightBehaviorHour, 0, len(buckets)+1)
	for _, bucket := range buckets {
		rows = append(rows, bucket.encode())
	}
	return append(rows, InsightBehaviorHour{HourStart: start}), nil
}

type behaviorKey struct {
	model string
	band  int
}

// behaviorUpstreamTry reports whether a failed try is one the upstream
// answers for: not a refusal before any channel, not the engine's own
// rejection, not the customer's own request.
func behaviorUpstreamTry(content string, other logOtherFields) bool {
	switch classifyError(content, other) {
	case ErrorNoChannel, ErrorEngineConcurrency, ErrorEngineLimit, ErrorEngineBudget:
		return false
	}
	return !customerFault(content)
}

func loadBehaviorStaff() (map[int]bool, error) {
	var ids []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", customerRoleBound).Pluck("id", &ids).Error; err != nil {
		return nil, err
	}
	staff := make(map[int]bool, len(ids))
	for _, id := range ids {
		staff[id] = true
	}
	return staff, nil
}

func storeBehaviorHour(start int64, rows []InsightBehaviorHour) error {
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("hour_start = ?", start).Delete(&InsightBehaviorHour{}).Error; err != nil {
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
	if DB.Model(&InsightBehaviorHour{}).Where("hour_start = ? AND model_name = ''", start).Count(&marked).Error == nil && marked > 0 {
		return nil
	}
	return err
}

func behaviorHourFinal(start, now int64) bool { return start+3600+behaviorSettle <= now }

// FillInsightBehavior stores the behavior of the final hours of the last
// behaviorFillDays that are not stored, newest first, at most limit of them,
// and returns how many it stored.
func FillInsightBehavior(limit int) (int, error) {
	now := time.Now().Unix()
	newest := insightHourKey(now)
	for !behaviorHourFinal(newest, now) {
		newest -= 3600
	}
	earliest, err := InsightLogsSince()
	if err != nil || earliest == 0 {
		return 0, err
	}
	oldest := max(newest-behaviorFillDays*86400, insightHourKey(earliest))
	var have []int64
	if err := DB.Model(&InsightBehaviorHour{}).Where("hour_start >= ? AND hour_start <= ? AND model_name = ''", oldest, newest).
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
			if staff, err = loadBehaviorStaff(); err != nil {
				return filled, err
			}
		}
		rows, err := computeBehaviorHour(start, staff)
		if err != nil {
			return filled, err
		}
		if err := storeBehaviorHour(start, rows); err != nil {
			return filled, err
		}
		filled++
	}
	return filled, nil
}

// openBehaviorTTL is how long an hour still filling is reused.
const openBehaviorTTL = 5 * time.Minute

var openBehaviorHours struct {
	mu      sync.Mutex
	byStart map[int64]openBehaviorHour
	flight  singleflight.Group
}

type openBehaviorHour struct {
	rows       []InsightBehaviorHour
	computedAt time.Time
}

// recentBehaviorHour reads an hour whose logs may still arrive: it is
// computed and reused for openBehaviorTTL, never stored.
func recentBehaviorHour(start int64) ([]InsightBehaviorHour, error) {
	openBehaviorHours.mu.Lock()
	cached, ok := openBehaviorHours.byStart[start]
	openBehaviorHours.mu.Unlock()
	if ok && time.Since(cached.computedAt) < openBehaviorTTL {
		return cached.rows, nil
	}
	value, err, _ := openBehaviorHours.flight.Do(strconv.FormatInt(start, 10), func() (any, error) {
		staff, err := loadBehaviorStaff()
		if err != nil {
			return nil, err
		}
		rows, err := computeBehaviorHour(start, staff)
		if err != nil {
			return nil, err
		}
		openBehaviorHours.mu.Lock()
		defer openBehaviorHours.mu.Unlock()
		if openBehaviorHours.byStart == nil {
			openBehaviorHours.byStart = map[int64]openBehaviorHour{}
		}
		for key, entry := range openBehaviorHours.byStart {
			if time.Since(entry.computedAt) >= 4*openBehaviorTTL {
				delete(openBehaviorHours.byStart, key)
			}
		}
		openBehaviorHours.byStart[start] = openBehaviorHour{rows: rows, computedAt: time.Now()}
		return rows, nil
	})
	if err != nil {
		return nil, err
	}
	return value.([]InsightBehaviorHour), nil
}

// BehaviorFlag is a metric of a model's day that moved past a threshold
// against the same input band's earlier days.
type BehaviorFlag struct {
	Metric string `json:"metric"`
	// Level is "yellow" past 40 % and "red" past 60 %.
	Level string `json:"level"`
	// Band is the input band compared, the one with most requests that day
	// among those with enough samples; 0 for errors, which have none.
	Band     int     `json:"band"`
	Value    float64 `json:"value"`
	Baseline float64 `json:"baseline"`
	// Change is Value over Baseline, less one.
	Change  float64 `json:"change"`
	Samples int64   `json:"samples"`
}

// BehaviorDay is one model's day. The medians read zero when the day has no
// sample of that kind.
type BehaviorDay struct {
	Day      int64 `json:"day"`
	Requests int64 `json:"requests"`
	Output   int64 `json:"output_p50"`
	// Reasoning is the median over the requests that recorded reasoning
	// tokens, ReasoningShare the part of requests that did.
	Reasoning      int64   `json:"reasoning_p50"`
	ReasoningShare float64 `json:"reasoning_share"`
	TTFT           int64   `json:"ttft_p50_ms"`
	Latency        int64   `json:"latency_p50_s"`
	// Tries is the failed tries the upstream answers for, over Requests plus
	// Tries as ErrorRate.
	Tries      int64          `json:"tries"`
	ErrorRate  float64        `json:"error_rate"`
	Statuses   []NamedCount   `json:"statuses"`
	CacheShare float64        `json:"cache_share"`
	Flags      []BehaviorFlag `json:"flags"`
}

// BehaviorModel is one model's days.
type BehaviorModel struct {
	Model    string        `json:"model"`
	Vendor   string        `json:"vendor"`
	Requests int64         `json:"requests"`
	Daily    []BehaviorDay `json:"daily"`
}

// BehaviorAlert is a flag of the range's last day with its model.
type BehaviorAlert struct {
	Model string `json:"model"`
	BehaviorFlag
}

// ModelBehavior is the model-behavior view. Alerts are the flags of the last
// day of the range, red first. MissingHours counts the range's final hours not
// stored yet.
type ModelBehavior struct {
	Models      []BehaviorModel `json:"models"`
	Alerts      []BehaviorAlert `json:"alerts"`
	BandLimits  []int64         `json:"band_limits"`
	MissingHour int             `json:"missing_hours"`
}

type behaviorDayBucket struct {
	requests, tries, input, cacheRead int64
	bands                             map[int]*behaviorBandHist
	statuses                          map[string]int64
}

type behaviorBandHist struct {
	requests                         int64
	output, reasoning, ttft, latency histogram
}

func (d *behaviorDayBucket) add(row InsightBehaviorHour) {
	if d.bands == nil {
		d.bands, d.statuses = map[int]*behaviorBandHist{}, map[string]int64{}
	}
	d.requests += row.Requests
	d.tries += row.Tries
	d.input += row.Input
	d.cacheRead += row.CacheRead
	if row.Statuses != "" {
		var statuses map[string]int64
		if common.UnmarshalJsonStr(row.Statuses, &statuses) == nil {
			mergeCounts(d.statuses, statuses)
		}
	}
	if row.Requests == 0 {
		return
	}
	band := d.bands[row.Band]
	if band == nil {
		band = &behaviorBandHist{output: histogram{}, reasoning: histogram{}, ttft: histogram{}, latency: histogram{}}
		d.bands[row.Band] = band
	}
	band.requests += row.Requests
	band.output.merge(decodeHistogram(row.Output))
	band.reasoning.merge(decodeHistogram(row.Reasoning))
	band.ttft.merge(decodeHistogram(row.TTFT))
	band.latency.merge(decodeHistogram(row.Latency))
}

// GetModelBehavior reads the behavior of the models in only, or of the busiest
// models when only is empty, over r, with the days before r.Start that the
// first days are compared with.
func GetModelBehavior(r InsightsRange, only []string) (*ModelBehavior, error) {
	now := time.Now().Unix()
	first := insightHourKey(r.DayStart(r.Start) - behaviorBaselineDays*86400)
	var rows []InsightBehaviorHour
	query := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End)
	if len(only) > 0 {
		query = query.Where("model_name IN ?", append([]string{""}, only...))
	}
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}
	stored := map[int64]bool{}
	for _, row := range rows {
		if row.ModelName == "" {
			stored[row.HourStart] = true
		}
	}
	result := &ModelBehavior{BandLimits: behaviorBandLimits, Models: []BehaviorModel{}, Alerts: []BehaviorAlert{}}
	for start := first; start < r.End; start += 3600 {
		if stored[start] {
			continue
		}
		if !behaviorHourFinal(start, now) {
			if start <= now {
				open, err := recentBehaviorHour(start)
				if err != nil {
					return nil, err
				}
				rows = append(rows, open...)
			}
			continue
		}
		if start+3600 > r.Start {
			result.MissingHour++
		}
	}
	requests := map[string]int64{}
	for _, row := range rows {
		if row.ModelName != "" && row.HourStart+3600 > r.Start {
			requests[row.ModelName] += row.Requests
		}
	}
	names := behaviorModelNames(requests, only)
	chosen := make(map[string]bool, len(names))
	for _, name := range names {
		chosen[name] = true
	}
	byModel := map[string]map[int64]*behaviorDayBucket{}
	for _, row := range rows {
		if !chosen[row.ModelName] {
			continue
		}
		days := byModel[row.ModelName]
		if days == nil {
			days = map[int64]*behaviorDayBucket{}
			byModel[row.ModelName] = days
		}
		day := r.DayStart(row.HourStart)
		if days[day] == nil {
			days[day] = &behaviorDayBucket{}
		}
		days[day].add(row)
	}
	shown := r.days()
	for _, name := range names {
		model := BehaviorModel{Model: name, Vendor: ModelVendor(name), Requests: requests[name]}
		for _, day := range shown {
			model.Daily = append(model.Daily, behaviorDayOf(day, byModel[name]))
		}
		result.Models = append(result.Models, model)
		if last := len(model.Daily) - 1; last >= 0 {
			for _, flag := range model.Daily[last].Flags {
				result.Alerts = append(result.Alerts, BehaviorAlert{Model: name, BehaviorFlag: flag})
			}
		}
	}
	slices.SortStableFunc(result.Alerts, func(a, b BehaviorAlert) int {
		return cmp.Or(cmp.Compare(behaviorRank(b.Level), behaviorRank(a.Level)), cmp.Compare(math.Abs(b.Change), math.Abs(a.Change)), cmp.Compare(a.Model, b.Model))
	})
	return result, nil
}

func behaviorRank(level string) int {
	if level == "red" {
		return 2
	}
	return 1
}

// behaviorModelNames is the models only names, or the busiest ones, most
// requests first; a named model with no request is kept.
func behaviorModelNames(requests map[string]int64, only []string) []string {
	var names []string
	if len(only) > 0 {
		names = slices.Clone(only)
	} else {
		for name, count := range requests {
			if count >= behaviorModelMinRequests {
				names = append(names, name)
			}
		}
	}
	slices.SortFunc(names, func(a, b string) int {
		return cmp.Or(cmp.Compare(requests[b], requests[a]), cmp.Compare(a, b))
	})
	return names[:min(len(names), behaviorModelCap)]
}

// behaviorDayOf reads one day of a model and judges it against the seven days
// before it.
func behaviorDayOf(day int64, days map[int64]*behaviorDayBucket) BehaviorDay {
	out := BehaviorDay{Day: day, Statuses: []NamedCount{}, Flags: []BehaviorFlag{}}
	today := days[day]
	if today == nil {
		return out
	}
	baseline := &behaviorDayBucket{}
	for i := 1; i <= behaviorBaselineDays; i++ {
		if earlier := days[day-int64(i)*86400]; earlier != nil {
			baseline.merge(earlier)
		}
	}
	all := &behaviorBandHist{output: histogram{}, reasoning: histogram{}, ttft: histogram{}, latency: histogram{}}
	for _, band := range today.bands {
		all.requests += band.requests
		all.output.merge(band.output)
		all.reasoning.merge(band.reasoning)
		all.ttft.merge(band.ttft)
		all.latency.merge(band.latency)
	}
	out.Requests, out.Tries = today.requests, today.tries
	out.Output, out.Reasoning = all.output.percentile(0.5), all.reasoning.percentile(0.5)
	out.TTFT, out.Latency = all.ttft.percentile(0.5), all.latency.percentile(0.5)
	out.ReasoningShare = ratio(float64(all.reasoning.count()), float64(all.requests))
	out.ErrorRate = ratio(float64(today.tries), float64(today.requests+today.tries))
	out.CacheShare = ratio(float64(today.cacheRead), float64(today.input))
	out.Statuses = sortedCounts(today.statuses)
	out.Flags = behaviorFlags(today, baseline)
	return out
}

// merge adds another day's figures to d, for a baseline over several days.
func (d *behaviorDayBucket) merge(other *behaviorDayBucket) {
	if d.bands == nil {
		d.bands, d.statuses = map[int]*behaviorBandHist{}, map[string]int64{}
	}
	d.requests += other.requests
	d.tries += other.tries
	d.input += other.input
	d.cacheRead += other.cacheRead
	for band, hist := range other.bands {
		into := d.bands[band]
		if into == nil {
			into = &behaviorBandHist{output: histogram{}, reasoning: histogram{}, ttft: histogram{}, latency: histogram{}}
			d.bands[band] = into
		}
		into.requests += hist.requests
		into.output.merge(hist.output)
		into.reasoning.merge(hist.reasoning)
		into.ttft.merge(hist.ttft)
		into.latency.merge(hist.latency)
	}
}

// behaviorFlags compares a day with its baseline. Each size metric is judged in
// one input band: the band with most of the day's samples of that metric among
// those with behaviorMinSamples on both sides, so a change in the mix of long
// and short prompts is not read as a change in the model. Error rate has no
// band and is judged on a rise only.
func behaviorFlags(today, baseline *behaviorDayBucket) []BehaviorFlag {
	flags := []BehaviorFlag{}
	metrics := []struct {
		name string
		hist func(*behaviorBandHist) histogram
	}{
		{BehaviorMetricOutput, func(b *behaviorBandHist) histogram { return b.output }},
		{BehaviorMetricReasoning, func(b *behaviorBandHist) histogram { return b.reasoning }},
		{BehaviorMetricTTFT, func(b *behaviorBandHist) histogram { return b.ttft }},
		{BehaviorMetricLatency, func(b *behaviorBandHist) histogram { return b.latency }},
	}
	for _, metric := range metrics {
		best, samples := 0, int64(0)
		for band, hist := range today.bands {
			n := metric.hist(hist).count()
			base := baseline.bands[band]
			if base == nil || n < behaviorMinSamples || metric.hist(base).count() < behaviorMinSamples {
				continue
			}
			if n > samples || (n == samples && band < best) {
				best, samples = band, n
			}
		}
		if samples == 0 {
			continue
		}
		value := float64(metric.hist(today.bands[best]).percentile(0.5))
		reference := float64(metric.hist(baseline.bands[best]).percentile(0.5))
		if flag, ok := behaviorFlag(metric.name, best, value, reference, samples, false); ok {
			flags = append(flags, flag)
		}
	}
	attempts, baseAttempts := today.requests+today.tries, baseline.requests+baseline.tries
	if attempts >= behaviorMinSamples && baseAttempts >= behaviorMinSamples {
		rate := float64(today.tries) / float64(attempts)
		reference := float64(baseline.tries) / float64(baseAttempts)
		if rate-reference >= behaviorMinErrorGap {
			if flag, ok := behaviorFlag(BehaviorMetricErrors, 0, rate, reference, attempts, true); ok {
				flags = append(flags, flag)
			}
		}
	}
	return flags
}

// behaviorFlag judges value against reference; riseOnly ignores a fall.
func behaviorFlag(metric string, band int, value, reference float64, samples int64, riseOnly bool) (BehaviorFlag, bool) {
	var change float64
	switch {
	case reference > 0:
		change = value/reference - 1
	case value > 0 && riseOnly:
		change = 1
	default:
		return BehaviorFlag{}, false
	}
	size := math.Abs(change)
	if riseOnly && change < 0 {
		return BehaviorFlag{}, false
	}
	level := ""
	switch {
	case size > behaviorRed:
		level = "red"
	case size > behaviorYellow:
		level = "yellow"
	default:
		return BehaviorFlag{}, false
	}
	return BehaviorFlag{Metric: metric, Level: level, Band: band, Value: value, Baseline: reference, Change: change, Samples: samples}, true
}
