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

// The capacity, quality and business views read the request logs through
// hourly rollups. A finished hour is aggregated once and stored in three
// tables, so a view over weeks reads one row per hour, user and model instead
// of every log. The hours still open are aggregated from the logs and reused
// for insightOpenHourTTL, so the views that share them, and the capacity
// view's 30 s refresh, scan those logs at most once a minute. A rollup
// outlives the logs it came from.
//
// A request belongs to the hour it started in (created_at - use_time), and is
// in flight until created_at. An hour is final once no request started in it
// can still be unlogged: a log is read up to insightHourLookahead after the
// hour ends, so a request that runs longer than that is left out.
const (
	insightHourVersion    = 3
	insightHourLookahead  = 2 * 3600
	insightHourSettle     = 10 * 60
	insightHourMaxLogRows = 200_000
	// Breakdowns keep this many entries per hour, enough for the views'
	// top lists after merging hours.
	insightHourTopN = 30
)

// InsightHour holds one hour's site-wide figures. Data is an insightSummary
// in JSON; Version marks the format, and a row of another version is rebuilt
// from the logs while they last.
type InsightHour struct {
	HourStart int64  `json:"hour_start" gorm:"primaryKey;autoIncrement:false"`
	Version   int    `json:"version" gorm:"not null"`
	Data      string `json:"data" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

// InsightUserHour is one user's requests, peak concurrency and consumption in
// an hour. Root is left out: the capacity and finance views count customers.
// Quota is what the user's requests cost at list price; WalletQuota is the
// part the wallet paid, and GiftQuota the part covered by plans an
// administrator or an inviter gave. The rest came from bought plans.
type InsightUserHour struct {
	HourStart   int64 `gorm:"primaryKey;autoIncrement:false"`
	UserId      int   `gorm:"primaryKey;autoIncrement:false"`
	Requests    int64 `gorm:"not null;default:0"`
	Peak        int   `gorm:"not null;default:0"`
	PeakAt      int64 `gorm:"not null;default:0"`
	Quota       int64 `gorm:"not null;default:0"`
	WalletQuota int64 `gorm:"not null;default:0"`
	GiftQuota   int64 `gorm:"not null;default:0"`
}

// InsightModelHour is one model's quality figures in an hour, root included.
// TTFT and Latency are histograms in JSON: a value rounded to two significant
// digits, mapped to its count.
type InsightModelHour struct {
	HourStart  int64  `gorm:"primaryKey;autoIncrement:false"`
	ModelName  string `gorm:"primaryKey;type:varchar(191)"`
	Requests   int64  `gorm:"not null;default:0"`
	Errors     int64  `gorm:"not null;default:0"`
	CacheRead  int64  `gorm:"not null;default:0"`
	CacheWrite int64  `gorm:"not null;default:0"`
	Uncached   int64  `gorm:"not null;default:0"`
	TTFT       string `gorm:"column:ttft;type:text"`
	Latency    string `gorm:"type:text"`
}

// insightSummary is an hour's site-wide figures. The capacity figures leave
// root out; the quality breakdowns and clients count everyone.
type insightSummary struct {
	Requests          int64            `json:"requests"`
	Errors            int64            `json:"errors"`
	Peak              int              `json:"peak"`
	PeakAt            int64            `json:"peak_at"`
	PeakRPM           int64            `json:"peak_rpm"`
	PeakRPMAt         int64            `json:"peak_rpm_at"`
	EngineRejections  int64            `json:"engine_rejections"`
	UpstreamRateLimit int64            `json:"upstream_rate_limits"`
	Categories        map[string]int64 `json:"categories,omitempty"`
	StreamEnds        map[string]int64 `json:"stream_ends,omitempty"`
	StatusCodes       map[string]int64 `json:"status_codes,omitempty"`
	ErrorReasons      map[string]int64 `json:"error_reasons,omitempty"`
	Clients           map[string]int64 `json:"clients,omitempty"`
	// RootQuota is what root's own requests cost at list price.
	RootQuota int64 `json:"root_quota,omitempty"`
	// Vendors splits the capacity figures by the vendor a model is sold
	// under (ModelVendor), customers only, as the site-wide ones are.
	Vendors   map[string]*vendorCapacity `json:"vendors,omitempty"`
	Truncated bool                       `json:"truncated,omitempty"`
}

// vendorCapacity is one vendor's capacity figures in an hour.
type vendorCapacity struct {
	Requests          int64            `json:"requests"`
	Errors            int64            `json:"errors"`
	Peak              int              `json:"peak"`
	PeakAt            int64            `json:"peak_at"`
	PeakRPM           int64            `json:"peak_rpm"`
	PeakRPMAt         int64            `json:"peak_rpm_at"`
	EngineRejections  int64            `json:"engine_rejections"`
	UpstreamRateLimit int64            `json:"upstream_rate_limits"`
	Categories        map[string]int64 `json:"categories,omitempty"`
}

// peakInHour is the most events in flight at once within [start, end): the
// count when the hour opens, then after each start inside it. Ends sort
// before starts at the same second.
func peakInHour(events []concurrencyEvent, start, end int64) (int, int64) {
	slices.SortFunc(events, func(a, b concurrencyEvent) int {
		return cmp.Or(cmp.Compare(a.at, b.at), cmp.Compare(a.delta, b.delta))
	})
	current, peak, at := 0, 0, start
	opened := false
	for _, event := range events {
		if event.at >= end {
			break
		}
		if !opened && event.at >= start {
			opened = true
			if current > peak {
				peak, at = current, start
			}
		}
		current += event.delta
		if event.delta > 0 && event.at >= start && current > peak {
			peak, at = current, event.at
		}
	}
	if !opened && current > peak {
		peak, at = current, start
	}
	return peak, at
}

// insightHour is one hour in memory: its summary, users and models.
type insightHour struct {
	start   int64
	summary insightSummary
	users   map[int]*InsightUserHour
	models  map[string]*insightModel
}

type insightModel struct {
	row     InsightModelHour
	ttft    histogram
	latency histogram
}

// histogram maps a value rounded to two significant digits to its count, so
// an hour of any traffic stores a few hundred entries at most.
type histogram map[int64]int64

func histogramKey(value int64) int64 {
	if value < 100 {
		return value
	}
	scale := int64(math.Pow10(int(math.Log10(float64(value))) - 1))
	return (value + scale/2) / scale * scale
}

func (h histogram) add(value int64) { h[histogramKey(value)]++ }

func (h histogram) merge(other histogram) {
	for value, count := range other {
		h[value] += count
	}
}

// percentile returns the value at index total*p of the sorted values the
// histogram stands for.
func (h histogram) percentile(p float64) int64 {
	var total int64
	values := make([]int64, 0, len(h))
	for value, count := range h {
		total += count
		values = append(values, value)
	}
	if total == 0 {
		return 0
	}
	slices.Sort(values)
	index := min(total-1, int64(float64(total)*p))
	var seen int64
	for _, value := range values {
		seen += h[value]
		if seen > index {
			return value
		}
	}
	return values[len(values)-1]
}

func (h histogram) encode() string {
	encoded := make(map[string]int64, len(h))
	for value, count := range h {
		encoded[strconv.FormatInt(value, 10)] = count
	}
	data, _ := common.Marshal(encoded)
	return string(data)
}

func decodeHistogram(data string) histogram {
	var encoded map[string]int64
	h := histogram{}
	if data == "" || common.UnmarshalJsonStr(data, &encoded) != nil {
		return h
	}
	for key, count := range encoded {
		if value, err := strconv.ParseInt(key, 10, 64); err == nil {
			h[value] = count
		}
	}
	return h
}

// keepTop trims a breakdown to its n largest entries.
func keepTop(counts map[string]int64, n int) map[string]int64 {
	if len(counts) <= n {
		return counts
	}
	kept := make(map[string]int64, n)
	for _, item := range sortedCounts(counts)[:n] {
		kept[item.Name] = item.Count
	}
	return kept
}

func mergeCounts(into map[string]int64, from map[string]int64) {
	for name, count := range from {
		into[name] += count
	}
}

// insightHourScope is what an hour's aggregation needs besides the logs: who
// root is, and which plans were given away rather than bought.
type insightHourScope struct {
	roots map[int]bool
	gifts map[int]bool
}

func loadInsightHourScope() (insightHourScope, error) {
	var roots, gifts []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", common.RoleRootUser).Pluck("id", &roots).Error; err != nil {
		return insightHourScope{}, err
	}
	if err := DB.Model(&UserSubscription{}).Where("source IN ?", []string{"admin", SubscriptionSourceAffiliateGift}).Pluck("id", &gifts).Error; err != nil {
		return insightHourScope{}, err
	}
	scope := insightHourScope{roots: make(map[int]bool, len(roots)), gifts: make(map[int]bool, len(gifts))}
	for _, id := range roots {
		scope.roots[id] = true
	}
	for _, id := range gifts {
		scope.gifts[id] = true
	}
	return scope, nil
}

// computeInsightHour aggregates the logs of the hour starting at start.
func computeInsightHour(start int64, scope insightHourScope) (*insightHour, error) {
	end := start + 3600
	var logs []insightLog
	err := LOG_DB.Model(&Log{}).
		Select("user_id, username, created_at, type, content, model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, ip, other").
		Where("created_at >= ? AND created_at < ? AND created_at - use_time < ? AND type IN ?",
			start, end+insightHourLookahead, end, []int{LogTypeConsume, LogTypeError}).
		Order("id desc").Limit(insightHourMaxLogRows + 1).Find(&logs).Error
	if err != nil {
		return nil, err
	}
	hour := &insightHour{
		start:   start,
		summary: insightSummary{Truncated: len(logs) > insightHourMaxLogRows},
		users:   make(map[int]*InsightUserHour),
		models:  make(map[string]*insightModel),
	}
	if hour.summary.Truncated {
		logs = logs[:insightHourMaxLogRows]
	}
	summary := &hour.summary
	summary.Categories = make(map[string]int64)
	summary.StreamEnds = make(map[string]int64)
	summary.StatusCodes = make(map[string]int64)
	summary.ErrorReasons = make(map[string]int64)
	summary.Clients = make(map[string]int64)
	perMinute := make(map[int64]int64)
	events := make([]concurrencyEvent, 0, len(logs)*2)
	summary.Vendors = make(map[string]*vendorCapacity)
	vendorEvents := make(map[string][]concurrencyEvent)
	vendorMinutes := make(map[string]map[int64]int64)
	vendorOf := func(name string) *vendorCapacity {
		vendor := summary.Vendors[name]
		if vendor == nil {
			vendor = &vendorCapacity{Categories: make(map[string]int64)}
			summary.Vendors[name] = vendor
			vendorMinutes[name] = make(map[int64]int64)
		}
		return vendor
	}
	for _, log := range logs {
		began := log.CreatedAt - int64(max(log.UseTime, 0))
		finished := max(log.CreatedAt, began+1)
		customer := !scope.roots[log.UserId]
		vendorName := ModelVendor(log.ModelName)
		if customer {
			events = append(events, concurrencyEvent{began, 1, log.UserId}, concurrencyEvent{finished, -1, log.UserId})
			vendorEvents[vendorName] = append(vendorEvents[vendorName], concurrencyEvent{began, 1, log.UserId}, concurrencyEvent{finished, -1, log.UserId})
		}
		if began < start {
			// In flight during this hour but counted in the hour it began.
			continue
		}
		if customer {
			summary.Requests++
			perMinute[began-began%60]++
			vendorOf(vendorName).Requests++
			vendorMinutes[vendorName][began-began%60]++
			user := hour.users[log.UserId]
			if user == nil {
				user = &InsightUserHour{HourStart: start, UserId: log.UserId}
				hour.users[log.UserId] = user
			}
			user.Requests++
		}
		model := hour.models[log.ModelName]
		if model == nil {
			model = &insightModel{row: InsightModelHour{HourStart: start, ModelName: log.ModelName}, ttft: histogram{}, latency: histogram{}}
			hour.models[log.ModelName] = model
		}
		model.row.Requests++
		if log.Type == LogTypeError {
			model.row.Errors++
			summary.StatusCodes[statusCodeName(logStatusCode(log.Content))]++
			summary.ErrorReasons[errorReason(log.Content)]++
			if customer {
				summary.Errors++
				category := classifyErrorLog(log.Content)
				summary.Categories[category]++
				vendor := vendorOf(vendorName)
				vendor.Errors++
				vendor.Categories[category]++
				switch category {
				case ErrorEngineConcurrency:
					summary.EngineRejections++
					vendor.EngineRejections++
				case ErrorUpstreamRateLimit:
					summary.UpstreamRateLimit++
					vendor.UpstreamRateLimit++
				}
			}
			continue
		}
		other := parseLogOther(log.Other)
		if customer {
			hour.users[log.UserId].addConsumption(log.Quota, other, scope.gifts)
		} else {
			summary.RootQuota += int64(log.Quota)
		}
		client := other.AdminInfo.Client
		if client == "" {
			client = "unknown"
		}
		summary.Clients[client]++
		model.latency.add(int64(log.UseTime))
		if log.IsStream {
			if other.Frt > 0 {
				model.ttft.add(int64(other.Frt))
			}
			reason := other.StreamStatus.EndReason
			if reason == "" {
				reason = "unknown"
			}
			summary.StreamEnds[reason]++
		}
		model.row.CacheRead += other.CacheTokens
		model.row.CacheWrite += other.CacheCreationTokens
		model.row.Uncached += int64(log.PromptTokens)
	}
	summary.ErrorReasons = keepTop(summary.ErrorReasons, insightHourTopN)
	summary.Clients = keepTop(summary.Clients, insightHourTopN)
	for minute, count := range perMinute {
		if count > summary.PeakRPM || count == summary.PeakRPM && minute < summary.PeakRPMAt {
			summary.PeakRPM, summary.PeakRPMAt = count, minute
		}
	}
	// A vendor in flight during the hour but with no request starting in it
	// still has its peak.
	for name, list := range vendorEvents {
		vendor := vendorOf(name)
		vendor.Peak, vendor.PeakAt = peakInHour(list, start, end)
		for minute, count := range vendorMinutes[name] {
			if count > vendor.PeakRPM || count == vendor.PeakRPM && minute < vendor.PeakRPMAt {
				vendor.PeakRPM, vendor.PeakRPMAt = count, minute
			}
		}
	}
	for name, vendor := range summary.Vendors {
		if vendor.Requests == 0 && vendor.Peak == 0 {
			delete(summary.Vendors, name)
		}
	}

	// Ends sort before starts at the same second, so back-to-back requests
	// are not counted as overlapping. The count when the hour opens is a
	// candidate too: requests that began earlier may still be running.
	slices.SortFunc(events, func(a, b concurrencyEvent) int {
		return cmp.Or(cmp.Compare(a.at, b.at), cmp.Compare(a.delta, b.delta))
	})
	current := 0
	perUser := make(map[int]int)
	userPeak := func(userID int, at int64) {
		user := hour.users[userID]
		if user == nil {
			user = &InsightUserHour{HourStart: start, UserId: userID}
			hour.users[userID] = user
		}
		if perUser[userID] > user.Peak {
			user.Peak, user.PeakAt = perUser[userID], at
		}
	}
	opened := false
	open := func() {
		opened = true
		if current > summary.Peak {
			summary.Peak, summary.PeakAt = current, start
		}
		for userID, count := range perUser {
			if count > 0 {
				userPeak(userID, start)
			}
		}
	}
	for _, event := range events {
		if event.at >= end {
			break
		}
		if !opened && event.at >= start {
			open()
		}
		current += event.delta
		perUser[event.userID] += event.delta
		if event.delta < 0 || event.at < start {
			continue
		}
		if current > summary.Peak {
			summary.Peak, summary.PeakAt = current, event.at
		}
		userPeak(event.userID, event.at)
	}
	if !opened {
		open()
	}
	return hour, nil
}

// addConsumption adds a consumed request to the user's hour, split by what
// paid for it. A request is billed to one source, and when that source runs
// short the other covers the rest (billing_overflow_quota). A log without a
// source predates the field and was billed to the wallet. A plan that covers
// a wallet-first request's overflow is not named in the log, so that part
// counts as bought.
func (u *InsightUserHour) addConsumption(quota int, other logOtherFields, gifts map[int]bool) {
	total := int64(quota)
	overflow := min(max(other.BillingOverflowQuota, 0), max(total, 0))
	wallet := total - overflow
	if other.BillingSource == "subscription" {
		wallet = 0
		if other.BillingOverflowSource == "wallet" {
			wallet = overflow
		}
		if gifts[other.SubscriptionId] {
			u.GiftQuota += total - wallet
		}
	}
	u.Quota += total
	u.WalletQuota += wallet
}

func (h *insightHour) save() error {
	data, err := common.Marshal(h.summary)
	if err != nil {
		return err
	}
	users := make([]InsightUserHour, 0, len(h.users))
	for _, user := range h.users {
		users = append(users, *user)
	}
	models := make([]InsightModelHour, 0, len(h.models))
	for _, model := range h.models {
		row := model.row
		row.TTFT, row.Latency = model.ttft.encode(), model.latency.encode()
		models = append(models, row)
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, table := range []any{&InsightHour{}, &InsightUserHour{}, &InsightModelHour{}} {
			if err := tx.Where("hour_start = ?", h.start).Delete(table).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(&InsightHour{HourStart: h.start, Version: insightHourVersion, Data: string(data), CreatedAt: time.Now().Unix()}).Error; err != nil {
			return err
		}
		if len(users) > 0 {
			if err := tx.CreateInBatches(users, 500).Error; err != nil {
				return err
			}
		}
		if len(models) > 0 {
			if err := tx.CreateInBatches(models, 500).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// insightHourFinal reports whether no log of the hour can still arrive.
func insightHourFinal(start, now int64) bool {
	return start+3600+insightHourLookahead+insightHourSettle <= now
}

// firstLogAt is the earliest log's time, or 0 without logs. Hours before it
// are empty and never computed.
func firstLogAt() (int64, error) {
	var first *int64
	if err := LOG_DB.Model(&Log{}).Select("MIN(created_at)").Scan(&first).Error; err != nil {
		return 0, err
	}
	if first == nil {
		return 0, nil
	}
	return *first, nil
}

// insightOpenHourTTL is how long a computed open hour is served as is. An
// older one, up to insightOpenHourStaleLimit, is still served at once while a
// new computation runs in the background, so the capacity view's 30 s refresh
// does not wait on a log scan. The live figures (in-flight requests and users)
// do not come from these hours.
var (
	insightOpenHourTTL        = time.Minute
	insightOpenHourStaleLimit = 5 * time.Minute
)

type cachedInsightHour struct {
	hour       *insightHour
	computedAt time.Time
}

// openInsightHours holds the open hours computed in this process. A cached
// hour is shared by concurrent readers and must not be modified.
var openInsightHours struct {
	mu      sync.Mutex
	byStart map[int64]cachedInsightHour
	flight  singleflight.Group
}

// recentOpenInsightHour returns the open hour starting at start. One computed
// within insightOpenHourTTL is returned as is; one computed within
// insightOpenHourStaleLimit is returned too, and starts a new computation in
// the background; otherwise the hour is computed now. Concurrent callers for
// the same hour share one computation.
func recentOpenInsightHour(start int64) (*insightHour, error) {
	openInsightHours.mu.Lock()
	cached, ok := openInsightHours.byStart[start]
	openInsightHours.mu.Unlock()
	key := strconv.FormatInt(start, 10)
	compute := func() (any, error) {
		scope, err := loadInsightHourScope()
		if err != nil {
			return nil, err
		}
		hour, err := computeInsightHour(start, scope)
		if err != nil {
			return nil, err
		}
		openInsightHours.mu.Lock()
		defer openInsightHours.mu.Unlock()
		if openInsightHours.byStart == nil {
			openInsightHours.byStart = make(map[int64]cachedInsightHour)
		}
		for key, entry := range openInsightHours.byStart {
			if time.Since(entry.computedAt) >= insightOpenHourStaleLimit {
				delete(openInsightHours.byStart, key)
			}
		}
		openInsightHours.byStart[start] = cachedInsightHour{hour: hour, computedAt: time.Now()}
		return hour, nil
	}
	if ok {
		age := time.Since(cached.computedAt)
		if age < insightOpenHourTTL {
			return cached.hour, nil
		}
		if age < insightOpenHourStaleLimit {
			openInsightHours.flight.DoChan(key, compute)
			return cached.hour, nil
		}
	}
	value, err, _ := openInsightHours.flight.Do(key, compute)
	if err != nil {
		return nil, err
	}
	return value.(*insightHour), nil
}

// loadInsightHours returns every hour that starts in [r.Start, r.End),
// whole hours in UTC, oldest first. Stored hours are read; a final hour that
// is missing or of an old version is computed and stored; an open hour comes
// from recentOpenInsightHour.
func loadInsightHours(r InsightsRange) ([]*insightHour, error) {
	first := r.Start - ((r.Start%3600)+3600)%3600
	now := time.Now().Unix()
	var stored []InsightHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&stored).Error; err != nil {
		return nil, err
	}
	hours := make(map[int64]*insightHour, len(stored))
	for _, row := range stored {
		if row.Version != insightHourVersion {
			continue
		}
		hour := &insightHour{start: row.HourStart, users: map[int]*InsightUserHour{}, models: map[string]*insightModel{}}
		if err := common.UnmarshalJsonStr(row.Data, &hour.summary); err != nil {
			continue
		}
		hours[row.HourStart] = hour
	}
	var users []InsightUserHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&users).Error; err != nil {
		return nil, err
	}
	for i := range users {
		if hour := hours[users[i].HourStart]; hour != nil {
			hour.users[users[i].UserId] = &users[i]
		}
	}
	var models []InsightModelHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&models).Error; err != nil {
		return nil, err
	}
	for _, row := range models {
		if hour := hours[row.HourStart]; hour != nil {
			hour.models[row.ModelName] = &insightModel{row: row, ttft: decodeHistogram(row.TTFT), latency: decodeHistogram(row.Latency)}
		}
	}

	earliest, err := firstLogAt()
	if err != nil {
		return nil, err
	}
	var scope *insightHourScope
	result := make([]*insightHour, 0, (r.End-first)/3600+1)
	for start := first; start < r.End; start += 3600 {
		hour := hours[start]
		final := insightHourFinal(start, now)
		if hour == nil || !final {
			if earliest == 0 || start+3600+insightHourLookahead <= earliest || start > now {
				result = append(result, &insightHour{start: start})
				continue
			}
			if !final {
				if hour, err = recentOpenInsightHour(start); err != nil {
					return nil, err
				}
				result = append(result, hour)
				continue
			}
			if scope == nil {
				loaded, err := loadInsightHourScope()
				if err != nil {
					return nil, err
				}
				scope = &loaded
			}
			if hour, err = computeInsightHour(start, *scope); err != nil {
				return nil, err
			}
			if err := hour.save(); err != nil {
				// The other color stored it first; the figures are the same.
				common.SysLog(common.LogText("site insights hour %d not stored: %s", start, err.Error()))
			}
		}
		result = append(result, hour)
	}
	return result, nil
}

// FillInsightHours stores the final hours of the last days that are missing,
// newest first, at most limit of them, and returns how many it stored. The
// views compute a missing hour on demand; this keeps them from having to.
func FillInsightHours(days int64, limit int) (int, error) {
	now := time.Now().Unix()
	newest := now - now%3600
	for !insightHourFinal(newest, now) {
		newest -= 3600
	}
	oldest := newest - days*86400
	earliest, err := firstLogAt()
	if err != nil || earliest == 0 {
		return 0, err
	}
	oldest = max(oldest, earliest-earliest%3600-insightHourLookahead)
	var have []int64
	if err := DB.Model(&InsightHour{}).Where("hour_start >= ? AND hour_start <= ? AND version = ?", oldest, newest, insightHourVersion).
		Pluck("hour_start", &have).Error; err != nil {
		return 0, err
	}
	stored := make(map[int64]bool, len(have))
	for _, start := range have {
		stored[start] = true
	}
	scope, err := loadInsightHourScope()
	if err != nil {
		return 0, err
	}
	filled := 0
	for start := newest; start >= oldest && filled < limit; start -= 3600 {
		if stored[start] {
			continue
		}
		hour, err := computeInsightHour(start, scope)
		if err != nil {
			return filled, err
		}
		if err := hour.save(); err != nil {
			return filled, err
		}
		filled++
	}
	return filled, nil
}
