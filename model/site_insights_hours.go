package model

import (
	"cmp"
	"math"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

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
// in flight until created_at. A retried request writes a log per attempt, all
// with its request id; they are folded into one request, in flight from its
// earliest start to its latest end, served when any attempt was, otherwise
// failed under its last error's category. A log without a request id is a
// request of its own, and one refused before any channel was in flight on
// none. A request and all of its logs belong to the hour of its earliest
// start; whole-second use times put its logs' starts up to a second apart,
// and each hour reads insightHourMargin past its edges so that both hours
// fold such a request alike. The per-channel rows count every attempt; the
// status codes, failure reasons and vendor failures count the customers'
// failed tries, every try included. An hour is final once no request started in
// it can still be unlogged: a log is read up to insightHourLookahead after
// the hour ends, so a request that runs longer than that is left out.
//
// The pool peak counts only the requests an engine channel served
// (EngineChannelIDs); the site peak counts every channel. An async task's
// refund, its positive settlement delta and a violation fee move money in
// the hour they were written in, and are no request (moneyOnly).
//
// A row stored under an older version is served as it is, its newer figures
// reading zero, and counted in each view's stale_hours when it has a request
// or an attempt: an empty one is current. The task rebuilds it
// while every log of its hour is still there; once logs before it are
// cleaned it keeps its old row for good. The hour the earliest log falls in
// is rebuilt only while none of its logs was removed (insightFirstHourWhole).
//
// The versions, oldest first: 5 counts the rollup's figures with staff
// included in the model rows and the failed tries, and has no vendor failures
// or staff figures. 6 leaves staff out of every customer figure (the model rows,
// status codes, error reasons and failed tries), counts staff apart in the
// summary's staff_models, and splits failed tries by vendor with their
// reasons and status codes kept to the top ones.
const (
	insightHourVersion   = 6
	insightHourLookahead = 2 * 3600
	insightHourMargin    = 5
	insightHourSettle    = 10 * 60
	// Breakdowns keep this many entries per hour, enough for the views'
	// top lists after merging hours.
	insightHourTopN = 30
)

// insightHourMaxLogRows bounds the logs one hour reads; tests lower it.
var insightHourMaxLogRows = 200_000

// InsightHour holds one hour's site-wide figures. Data is an insightSummary
// in JSON; Version marks the format. A row of an older version is served as
// it is and rebuilt by FillInsightHours while its logs last.
type InsightHour struct {
	HourStart int64  `json:"hour_start" gorm:"primaryKey;autoIncrement:false"`
	Version   int    `json:"version" gorm:"not null"`
	Data      string `json:"data" gorm:"type:text"`
	CreatedAt int64  `json:"created_at"`
}

// InsightUserHour is one user's requests, peak concurrency and consumption in
// an hour. Staff are left out: the capacity and finance views count customers.
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

// InsightModelHour is one model's quality figures in an hour, customers only.
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
	// Output is the hour's completion tokens. Rows stored before it existed
	// hold 0, so a reader that needs it reads only hours where it is set.
	Output  int64  `gorm:"not null;default:0"`
	TTFT    string `gorm:"column:ttft;type:text"`
	Latency string `gorm:"type:text"`
}

// insightSummary is an hour's site-wide figures. Staff (customerRoleBound and
// up) are left out of every customer figure: the capacity and quality figures,
// the failed tries, the users and the groups and plans. Their requests are
// counted apart in StaffModels and their cost in RootQuota, a name kept from
// when only root was staff. The clients count everyone. Requests and Errors
// count requests, a request failed when no attempt was served; Attempts and
// AttemptErrors count the attempts, retries included. Peak is the most
// requests in flight on every channel; PoolPeak the most served through the
// engine.
type insightSummary struct {
	Requests          int64            `json:"requests"`
	Errors            int64            `json:"errors"`
	Attempts          int64            `json:"attempts"`
	AttemptErrors     int64            `json:"attempt_errors"`
	Peak              int              `json:"peak"`
	PeakAt            int64            `json:"peak_at"`
	PoolPeak          int              `json:"pool_peak"`
	PoolPeakAt        int64            `json:"pool_peak_at"`
	PeakRPM           int64            `json:"peak_rpm"`
	PeakRPMAt         int64            `json:"peak_rpm_at"`
	EngineRejections  int64            `json:"engine_rejections"`
	UpstreamRateLimit int64            `json:"upstream_rate_limits"`
	Categories        map[string]int64 `json:"categories,omitempty"`
	StreamEnds        map[string]int64 `json:"stream_ends,omitempty"`
	StatusCodes       map[string]int64 `json:"status_codes,omitempty"`
	ErrorReasons      map[string]int64 `json:"error_reasons,omitempty"`
	// ErrorReasonsOther counts the failed tries whose reason is not in
	// ErrorReasons, so the two add up to the failed tries of the hour.
	ErrorReasonsOther int64            `json:"error_reasons_other,omitempty"`
	Clients           map[string]int64 `json:"clients,omitempty"`
	// RootQuota is what staff's own requests cost at list price.
	RootQuota int64 `json:"root_quota,omitempty"`
	// Groups is the customers' requests and consumption by the group each
	// request was billed in; Plans the customers' consumption each
	// subscription plan (by plan id) covered.
	Groups map[string]*insightGroupUse `json:"groups,omitempty"`
	Plans  map[int]int64               `json:"plans,omitempty"`
	// Vendors splits the capacity figures by the vendor a model is sold
	// under (ModelVendor), customers only, as the site-wide ones are.
	Vendors map[string]*vendorCapacity `json:"vendors,omitempty"`
	// VendorFailures splits the customers' failed tries by the vendor of
	// their model: the reasons and status codes the quality view names media
	// failures by. Absent from a row of an older version.
	VendorFailures map[string]*vendorFailures `json:"vendor_failures,omitempty"`
	// StaffModels is each model's staff requests and failed staff requests,
	// which no customer figure includes.
	StaffModels map[string]*insightStaffUse `json:"staff_models,omitempty"`
	Truncated   bool                        `json:"truncated,omitempty"`
}

// insightStaffUse is one model's staff requests and the ones that failed.
type insightStaffUse struct {
	Requests int64 `json:"requests"`
	Errors   int64 `json:"errors"`
}

// vendorFailures is one vendor's failed tries in an hour, by reason and by
// status code. Each keeps its insightHourTopN largest entries; ReasonsOther
// and StatusOther count the rest, so the kept entries and the rest sum to
// Tries.
type vendorFailures struct {
	Tries        int64            `json:"tries"`
	Reasons      map[string]int64 `json:"reasons,omitempty"`
	ReasonsOther int64            `json:"reasons_other,omitempty"`
	StatusCodes  map[string]int64 `json:"status_codes,omitempty"`
	StatusOther  int64            `json:"status_other,omitempty"`
}

// insightGroupUse is one billing group's requests and consumption in an hour.
type insightGroupUse struct {
	Requests int64 `json:"requests"`
	Quota    int64 `json:"quota"`
}

// vendorCapacity is one vendor's capacity figures in an hour.
type vendorCapacity struct {
	Requests          int64            `json:"requests"`
	Errors            int64            `json:"errors"`
	Attempts          int64            `json:"attempts"`
	AttemptErrors     int64            `json:"attempt_errors"`
	Peak              int              `json:"peak"`
	PeakAt            int64            `json:"peak_at"`
	PoolPeak          int              `json:"pool_peak"`
	PoolPeakAt        int64            `json:"pool_peak_at"`
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

// insightHour is one hour in memory: its summary, users and models. stale is
// a stored hour of an older version, whose newer figures read zero.
type insightHour struct {
	start    int64
	stale    bool
	summary  insightSummary
	users    map[int]*InsightUserHour
	models   map[string]*insightModel
	channels map[insightChannelKey]*insightChannel
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

// trimTop keeps the n largest entries of a breakdown and returns the sum of
// the rest, so that the kept entries and the rest still add up to the total.
func trimTop(counts map[string]int64, n int) (map[string]int64, int64) {
	if len(counts) <= n {
		return counts, 0
	}
	kept := make(map[string]int64, n)
	var rest int64
	for i, item := range sortedCounts(counts) {
		if i < n {
			kept[item.Name] = item.Count
		} else {
			rest += item.Count
		}
	}
	return kept, rest
}

func mergeCounts(into map[string]int64, from map[string]int64) {
	for name, count := range from {
		into[name] += count
	}
}

// countFailedTry counts a customer's failed try, an error log, by its status
// code, its reason and its model's vendor. Every try is counted, retries
// included, so the status codes and the reasons add up to the failed tries.
func (s *insightSummary) countFailedTry(log insightLog) {
	code := statusCodeName(logStatusCode(log.Content))
	reason := errorReason(log.Content)
	s.StatusCodes[code]++
	s.ErrorReasons[reason]++
	vendor := ModelVendor(log.ModelName)
	failures := s.VendorFailures[vendor]
	if failures == nil {
		failures = &vendorFailures{Reasons: make(map[string]int64), StatusCodes: make(map[string]int64)}
		s.VendorFailures[vendor] = failures
	}
	failures.Tries++
	failures.Reasons[reason]++
	failures.StatusCodes[code]++
}

// staffOf is one model's staff figures in the hour, created on first use.
func (s *insightSummary) staffOf(model string) *insightStaffUse {
	use := s.StaffModels[model]
	if use == nil {
		use = &insightStaffUse{}
		s.StaffModels[model] = use
	}
	return use
}

// insightHourScope is what an hour's aggregation needs besides the logs: who
// is staff (StaffUserIDs), which plans were given away rather than bought, and
// which channels the engine serves (EngineChannelIDs).
type insightHourScope struct {
	staff   map[int]bool
	gifts   map[int]bool
	engines map[int]bool
}

func loadInsightHourScope() (insightHourScope, error) {
	var staff, gifts []int
	if err := DB.Model(&User{}).Unscoped().Where("role >= ?", customerRoleBound).Pluck("id", &staff).Error; err != nil {
		return insightHourScope{}, err
	}
	if err := DB.Model(&UserSubscription{}).Where("source IN ?", []string{"admin", SubscriptionSourceAffiliateGift}).Pluck("id", &gifts).Error; err != nil {
		return insightHourScope{}, err
	}
	engines, err := EngineChannelIDs(operation_setting.EngineControlURL)
	if err != nil {
		return insightHourScope{}, err
	}
	scope := insightHourScope{staff: make(map[int]bool, len(staff)), gifts: make(map[int]bool, len(gifts)), engines: engines}
	for _, id := range staff {
		scope.staff[id] = true
	}
	for _, id := range gifts {
		scope.gifts[id] = true
	}
	return scope, nil
}

// insightRequest is one request: its logs folded by request id. Each failed
// attempt writes an error log timed from the request's start, and the attempt
// that served it a consume log.
type insightRequest struct {
	userID        int
	modelName     string
	group         string
	began         int64
	attempts      int64
	attemptErrors int64
	served        bool
	// pool is a request an engine channel served.
	pool bool
	// category is the last error's, the one a failed request is counted
	// under.
	category string
	// held is whether the request was in flight on a channel, from heldFrom
	// to heldTo; one refused before any channel was not.
	held             bool
	heldFrom, heldTo int64
}

func (h *insightHour) modelOf(name string) *insightModel {
	model := h.models[name]
	if model == nil {
		model = &insightModel{row: InsightModelHour{HourStart: h.start, ModelName: name}, ttft: histogram{}, latency: histogram{}}
		h.models[name] = model
	}
	return model
}

func (h *insightHour) userOf(userID int) *InsightUserHour {
	user := h.users[userID]
	if user == nil {
		user = &InsightUserHour{HourStart: h.start, UserId: userID}
		h.users[userID] = user
	}
	return user
}

// computeInsightHour aggregates the logs of the hour starting at start. The
// per-channel rows, status codes and failure reasons count attempts; the
// other figures count requests, folding a request's logs by its request id.
// A log without one is a request of its own.
//
// An async task's refund, its positive settlement delta and a violation fee
// move money in the hour they were written in and are no request
// (moneyOnly). A task's submit log times its submission only, not the task,
// so it stays out of the latency and first-token histograms.
func computeInsightHour(start int64, scope insightHourScope) (*insightHour, error) {
	end := start + 3600
	logs, truncated, err := readInsightHourLogs(start, end)
	if err != nil {
		return nil, err
	}
	hour := &insightHour{
		start:    start,
		summary:  insightSummary{Truncated: truncated},
		users:    make(map[int]*InsightUserHour),
		models:   make(map[string]*insightModel),
		channels: make(map[insightChannelKey]*insightChannel),
	}
	summary := &hour.summary
	summary.Categories = make(map[string]int64)
	summary.StreamEnds = make(map[string]int64)
	summary.StatusCodes = make(map[string]int64)
	summary.ErrorReasons = make(map[string]int64)
	summary.Clients = make(map[string]int64)
	summary.Groups = make(map[string]*insightGroupUse)
	summary.Plans = make(map[int]int64)
	summary.VendorFailures = make(map[string]*vendorFailures)
	summary.StaffModels = make(map[string]*insightStaffUse)
	requests := make([]*insightRequest, 0, len(logs))
	byID := make(map[string]*insightRequest, len(logs))
	others := make([]logOtherFields, len(logs))
	// requestOf is each log's request; nil for a log that only moves money.
	requestOf := make([]*insightRequest, len(logs))
	// Every log is folded before any is counted: whether a request is this
	// hour's depends on the earliest start among all of its logs.
	for i, log := range logs {
		other := parseLogOther(log.Other)
		others[i] = other
		if _, ok := moneyOnly(log, other); ok || log.Type == LogTypeRefund {
			continue
		}
		began := log.CreatedAt - int64(max(log.UseTime, 0))
		finished := max(log.CreatedAt, began+1)
		request := byID[log.RequestId]
		if request == nil {
			request = &insightRequest{userID: log.UserId, began: began}
			requests = append(requests, request)
			if log.RequestId != "" {
				byID[log.RequestId] = request
			}
		}
		requestOf[i] = request
		request.began = min(request.began, began)
		request.modelName = log.ModelName
		request.group = log.Group
		request.attempts++
		category := ""
		if log.Type == LogTypeError {
			category = classifyError(log.Content, other)
			request.attemptErrors++
			request.category = category
		} else {
			request.served = true
			request.pool = request.pool || scope.engines[log.ChannelId]
		}
		if category != ErrorNoChannel {
			if !request.held {
				request.held, request.heldFrom, request.heldTo = true, began, finished
			}
			request.heldFrom, request.heldTo = min(request.heldFrom, began), max(request.heldTo, finished)
		}
	}
	for i, log := range logs {
		other := others[i]
		if quota, ok := moneyOnly(log, other); ok {
			if log.CreatedAt >= start && log.CreatedAt < end {
				hour.addQuota(log, other, quota, scope)
			}
			continue
		}
		request := requestOf[i]
		if request == nil || request.began < start || request.began >= end {
			// In flight during this hour, perhaps, but another hour's.
			continue
		}
		customer := !scope.staff[log.UserId]
		channel := hour.channelOf(log.ChannelId, log.ModelName)
		if log.Type == LogTypeError {
			channel.addError(log.Content)
			if customer {
				summary.countFailedTry(log)
			}
			continue
		}
		channel.addConsumption(log, other, customer)
		hour.addQuota(log, other, int64(log.Quota), scope)
		client := other.AdminInfo.Client
		if client == "" {
			client = "unknown"
		}
		summary.Clients[client]++
		if !customer {
			continue
		}
		model := hour.modelOf(log.ModelName)
		if !other.IsTask {
			model.latency.add(int64(log.UseTime))
		}
		if log.IsStream {
			if other.Frt > 0 && !other.IsTask {
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
		model.row.Uncached += uncachedPrompt(log, other)
		model.row.Output += int64(log.CompletionTokens)
	}
	summary.ErrorReasons, summary.ErrorReasonsOther = trimTop(summary.ErrorReasons, insightHourTopN)
	summary.Clients = keepTop(summary.Clients, insightHourTopN)
	for _, failures := range summary.VendorFailures {
		failures.Reasons, failures.ReasonsOther = trimTop(failures.Reasons, insightHourTopN)
		failures.StatusCodes, failures.StatusOther = trimTop(failures.StatusCodes, insightHourTopN)
	}

	perMinute := make(map[int64]int64)
	events := make([]concurrencyEvent, 0, len(requests)*2)
	var poolEvents []concurrencyEvent
	summary.Vendors = make(map[string]*vendorCapacity)
	vendorEvents := make(map[string][]concurrencyEvent)
	vendorPoolEvents := make(map[string][]concurrencyEvent)
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
	for _, request := range requests {
		customer := !scope.staff[request.userID]
		vendorName := ModelVendor(request.modelName)
		if customer && request.held {
			in, out := concurrencyEvent{request.heldFrom, 1, request.userID}, concurrencyEvent{request.heldTo, -1, request.userID}
			events = append(events, in, out)
			vendorEvents[vendorName] = append(vendorEvents[vendorName], in, out)
			// Only a request the engine served held a slot of the pool.
			if request.pool {
				poolEvents = append(poolEvents, in, out)
				vendorPoolEvents[vendorName] = append(vendorPoolEvents[vendorName], in, out)
			}
		}
		if request.began < start || request.began >= end {
			continue
		}
		if !customer {
			staff := summary.staffOf(request.modelName)
			staff.Requests++
			if !request.served {
				staff.Errors++
			}
			continue
		}
		model := hour.modelOf(request.modelName)
		model.row.Requests++
		if !request.served {
			model.row.Errors++
		}
		summary.Requests++
		summary.Attempts += request.attempts
		summary.AttemptErrors += request.attemptErrors
		minute := request.began - request.began%60
		perMinute[minute]++
		vendor := vendorOf(vendorName)
		vendor.Requests++
		vendor.Attempts += request.attempts
		vendor.AttemptErrors += request.attemptErrors
		vendorMinutes[vendorName][minute]++
		hour.userOf(request.userID).Requests++
		if request.group != "" {
			hour.groupOf(request.group).Requests++
		}
		if request.served {
			continue
		}
		summary.Errors++
		summary.Categories[request.category]++
		vendor.Errors++
		vendor.Categories[request.category]++
		switch request.category {
		case ErrorEngineConcurrency:
			summary.EngineRejections++
			vendor.EngineRejections++
		case ErrorUpstreamRateLimit:
			summary.UpstreamRateLimit++
			vendor.UpstreamRateLimit++
		}
	}
	for minute, count := range perMinute {
		if count > summary.PeakRPM || count == summary.PeakRPM && minute < summary.PeakRPMAt {
			summary.PeakRPM, summary.PeakRPMAt = count, minute
		}
	}
	if len(poolEvents) > 0 {
		summary.PoolPeak, summary.PoolPeakAt = peakInHour(poolEvents, start, end)
	}
	// A vendor in flight during the hour but with no request starting in it
	// still has its peak.
	for name, list := range vendorEvents {
		vendor := vendorOf(name)
		vendor.Peak, vendor.PeakAt = peakInHour(list, start, end)
		if pool := vendorPoolEvents[name]; len(pool) > 0 {
			vendor.PoolPeak, vendor.PoolPeakAt = peakInHour(pool, start, end)
		}
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
		user := hour.userOf(userID)
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

// readInsightHourLogs reads the logs the hour starting at start folds: those
// of the requests that may have started in it, up to insightHourLookahead
// after it ends, and those within insightHourMargin of either edge, so that
// this hour and its neighbours see the same logs of a request whose attempts
// straddle an edge and agree on which hour owns it.
//
// Past the row cap the earliest rows are kept, so the start of the hour is
// whole, and the result says it was truncated. A request with an error log
// among them may have its later attempts past the cut; those are read by
// request id, so the request is not judged failed from part of its logs.
func readInsightHourLogs(start, end int64) ([]insightLog, bool, error) {
	query := func() *gorm.DB {
		return LOG_DB.Model(&Log{}).
			Select("id, user_id, username, created_at, type, content, model_name, quota, prompt_tokens, completion_tokens, use_time, is_stream, ip, other, channel_id, request_id, "+logGroupCol).
			Where("created_at >= ? AND created_at < ? AND created_at - use_time < ? AND type IN ?",
				start-insightHourMargin, end+insightHourLookahead, end+insightHourMargin, []int{LogTypeConsume, LogTypeError, LogTypeRefund})
	}
	var logs []insightLog
	if err := query().Order("id asc").Limit(insightHourMaxLogRows + 1).Find(&logs).Error; err != nil {
		return nil, false, err
	}
	if len(logs) <= insightHourMaxLogRows {
		return logs, false, nil
	}
	logs = logs[:insightHourMaxLogRows]
	cut := logs[len(logs)-1].Id
	seen := make(map[string]bool)
	var pending []string
	for _, log := range logs {
		if log.Type == LogTypeError && log.RequestId != "" && !seen[log.RequestId] {
			seen[log.RequestId] = true
			pending = append(pending, log.RequestId)
		}
	}
	for ids := range slices.Chunk(pending, 500) {
		var more []insightLog
		if err := query().Where("request_id IN ? AND id > ?", ids, cut).Order("id asc").Find(&more).Error; err != nil {
			return nil, false, err
		}
		logs = append(logs, more...)
	}
	return logs, true, nil
}

// moneyOnly reports a log that moves money without being a request or an
// attempt, and the quota it adds. An async task's refund (negative) and its
// positive settlement delta, a second consume log carrying
// pre_consumed_quota: a task log is told apart by other.is_task
// (taskBillingOther and the submit log) or, on a Midjourney refund,
// other.task_id; RefundTaskQuota, RecalculateTaskQuota and
// RefundMidjourneyQuota are the only writers of refund logs. And a violation
// fee (ChargeViolationFeeIfNeeded), a consume log written after the refused
// request's error log with its request id: the request stays failed.
func moneyOnly(log insightLog, other logOtherFields) (int64, bool) {
	switch {
	case log.Type == LogTypeRefund && (other.IsTask || other.TaskId != ""):
		return -int64(log.Quota), true
	case log.Type == LogTypeConsume && other.IsTask && other.PreConsumedQuota != nil:
		return int64(log.Quota), true
	case log.Type == LogTypeConsume && other.ViolationFee:
		return int64(log.Quota), true
	}
	return 0, false
}

// uncachedPrompt is a consume log's input tokens that were neither read from
// nor written to the cache. Billing (service/text_quota.go) counts the cache
// inside prompt_tokens unless the usage is Anthropic's
// (IsClaudeUsageSemantic) or legacy Claude-derived OpenAI usage, which
// reports 5m or 1h cache writes with no usage source or semantic. The log
// records that rule as prompt_includes_cache. An older log is judged from
// what it kept: Anthropic usage wrote usage_semantic "anthropic" or
// claude, and only Claude usage writes the 5m and 1h write counts, so a log
// with either is taken as excluding the cache; the usage source is not
// logged, so Claude-derived usage that carried one reads as excluding too.
func uncachedPrompt(log insightLog, other logOtherFields) int64 {
	prompt := int64(log.PromptTokens)
	includes := other.UsageSemantic != "anthropic" && !other.Claude &&
		other.CacheCreationTokens5m == 0 && other.CacheCreationTokens1h == 0
	if other.PromptIncludesCache != nil {
		includes = *other.PromptIncludesCache
	}
	if !includes {
		return prompt
	}
	return max(0, prompt-other.CacheTokens-other.CacheCreationTokens)
}

func (h *insightHour) groupOf(name string) *insightGroupUse {
	group := h.summary.Groups[name]
	if group == nil {
		group = &insightGroupUse{}
		h.summary.Groups[name] = group
	}
	return group
}

// addQuota adds what a log charged, negative for a refund, to its user,
// group, plan and channel, or to staff's own figure. A refund is counted in
// its own hour, which may hold less of the user's, channel's, group's or
// plan's consumption than it returns, so an hour's figure may be negative:
// it is stored as it is, and the views stop a figure at zero only once it is
// summed over what they show.
func (h *insightHour) addQuota(log insightLog, other logOtherFields, quota int64, scope insightHourScope) {
	if scope.staff[log.UserId] {
		h.summary.RootQuota += quota
		return
	}
	h.channelOf(log.ChannelId, log.ModelName).row.Quota += quota
	plan := h.userOf(log.UserId).addConsumption(quota, other, scope.gifts)
	if log.Group != "" {
		h.groupOf(log.Group).Quota += quota
	}
	if other.SubscriptionPlanId != 0 && plan != 0 {
		h.summary.Plans[other.SubscriptionPlanId] += plan
	}
}

// addConsumption adds a log's charge, negative for a refund, to the user's
// hour, split by what paid for it, and returns the part a subscription plan
// covered. A request is billed to one source, and when that source runs
// short the other covers the rest (billing_overflow_quota). A log without a
// source predates the field and was billed to the wallet. A plan that covers
// a wallet-first request's overflow is not named in the log, so that part
// counts as bought and is no named plan's. Whether the plan was given is
// read from the log's subscription_gift, and from the plans given now on a
// log from before it, which loses a given plan since deleted.
func (u *InsightUserHour) addConsumption(quota int64, other logOtherFields, gifts map[int]bool) int64 {
	overflow := min(max(other.BillingOverflowQuota, 0), max(quota, 0))
	wallet := quota - overflow
	var plan int64
	if other.BillingSource == "subscription" {
		wallet = 0
		if other.BillingOverflowSource == "wallet" {
			wallet = overflow
		}
		plan = quota - wallet
		gift := gifts[other.SubscriptionId]
		if other.SubscriptionGift != nil {
			gift = *other.SubscriptionGift
		}
		if gift {
			u.GiftQuota += plan
		}
	}
	u.Quota += quota
	u.WalletQuota += wallet
	return plan
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
	channels := make([]InsightChannelHour, 0, len(h.channels))
	for _, channel := range h.channels {
		channels = append(channels, channel.encode())
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, table := range []any{&InsightHour{}, &InsightUserHour{}, &InsightModelHour{}, &InsightChannelHour{}} {
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
		if len(channels) > 0 {
			if err := tx.CreateInBatches(channels, 500).Error; err != nil {
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

// insightLogInsertSlack is longer than a log can wait between taking its time
// and being inserted, so a log written this long after another has the higher
// id.
const insightLogInsertSlack = 600

// insightFirstHourWhole reports whether the hour the earliest log falls in
// still has every log it is computed from. The earliest log alone does not
// say: cleaning deletes by time, in batches of no fixed order, and may have
// stopped inside the hour. The hour reads logs up to insightHourLookahead
// after it ends. Take the first log written insightLogInsertSlack after that:
// every log the hour reads has a lower id. If each id from 1 up to it is
// still there, none was removed. A gap left by an insert that failed reads as
// cleaned, and so does a table with no log that late yet: the safe side.
func insightFirstHourWhole(hour int64) (bool, error) {
	var next []int64
	if err := LOG_DB.Model(&Log{}).Where("created_at >= ?", hour+3600+insightHourLookahead+insightLogInsertSlack).
		Order("created_at, id").Limit(1).Pluck("id", &next).Error; err != nil {
		return false, err
	}
	if len(next) == 0 || next[0] <= 1 {
		return false, nil
	}
	var below int64
	if err := LOG_DB.Model(&Log{}).Where("id < ?", next[0]).Count(&below).Error; err != nil {
		return false, err
	}
	return below == next[0]-1, nil
}

// insightLogsSinceTTL is how long the earliest log's time is reused. Logs are
// only cleaned from the front, so a reused value is early by at most this
// long, and the hours between the two read as empty, which they are.
const insightLogsSinceTTL = 5 * time.Minute

var insightLogsSince struct {
	mu     sync.Mutex
	readAt time.Time
	value  int64
	flight singleflight.Group
}

// InsightLogsSince is the time of the earliest request log the hourly rollups
// read: the views return it as logs_since, and an hour before it is no data
// rather than zero. It is read once per insightLogsSinceTTL, shared by
// concurrent callers. Without logs it is 0, and that is not kept, so the first
// log is seen at once.
func InsightLogsSince() (int64, error) {
	insightLogsSince.mu.Lock()
	if insightLogsSince.value > 0 && time.Since(insightLogsSince.readAt) < insightLogsSinceTTL {
		value := insightLogsSince.value
		insightLogsSince.mu.Unlock()
		return value, nil
	}
	insightLogsSince.mu.Unlock()
	value, err, _ := insightLogsSince.flight.Do("logs_since", func() (any, error) {
		first, err := firstLogAt()
		if err != nil {
			return nil, err
		}
		if first > 0 {
			insightLogsSince.mu.Lock()
			insightLogsSince.value, insightLogsSince.readAt = first, time.Now()
			insightLogsSince.mu.Unlock()
		}
		return first, nil
	})
	if err != nil {
		return 0, err
	}
	return value.(int64), nil
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
// whole hours in UTC, oldest first (loadInsightHoursStale).
func loadInsightHours(r InsightsRange) ([]*insightHour, error) {
	hours, _, err := loadInsightHoursStale(r)
	return hours, err
}

// loadInsightHoursStale returns every hour that starts in [r.Start, r.End),
// whole hours in UTC, oldest first, and how many of them are stored under an
// older version and would change on a rebuild: a request, an attempt, a model
// row or a status code. A stored hour is served as it is, whatever its version:
// the figures an older version did not have read zero until FillInsightHours
// rebuilds it. An older row that a rebuild would not change is current.
// Only a final hour with no stored row is computed and stored here; an open
// hour comes from recentOpenInsightHour.
func loadInsightHoursStale(r InsightsRange) ([]*insightHour, int, error) {
	first := r.Start - ((r.Start%3600)+3600)%3600
	now := time.Now().Unix()
	var stored []InsightHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&stored).Error; err != nil {
		return nil, 0, err
	}
	hours := make(map[int64]*insightHour, len(stored))
	for _, row := range stored {
		hour := &insightHour{start: row.HourStart, users: map[int]*InsightUserHour{}, models: map[string]*insightModel{}, channels: map[insightChannelKey]*insightChannel{}}
		if err := common.UnmarshalJsonStr(row.Data, &hour.summary); err != nil {
			continue
		}
		hour.stale = row.Version < insightHourVersion
		hours[row.HourStart] = hour
	}
	var users []InsightUserHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	for i := range users {
		if hour := hours[users[i].HourStart]; hour != nil {
			hour.users[users[i].UserId] = &users[i]
		}
	}
	var models []InsightModelHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	for _, row := range models {
		if hour := hours[row.HourStart]; hour != nil {
			hour.models[row.ModelName] = &insightModel{row: row, ttft: decodeHistogram(row.TTFT), latency: decodeHistogram(row.Latency)}
		}
	}
	// An older hour is current only when a rebuild would change nothing
	// (decision 2): a rebuild drops the staff model rows and status codes an
	// older version counted, so those make it stale as well as requests.
	for _, hour := range hours {
		hour.stale = hour.stale && (hour.summary.Requests > 0 || hour.summary.Attempts > 0 || len(hour.models) > 0 || len(hour.summary.StatusCodes) > 0)
	}
	var channelRows []InsightChannelHour
	if err := DB.Where("hour_start >= ? AND hour_start < ?", first, r.End).Find(&channelRows).Error; err != nil {
		return nil, 0, err
	}
	for _, row := range channelRows {
		if hour := hours[row.HourStart]; hour != nil {
			hour.channels[insightChannelKey{row.ChannelId, row.ModelName}] = decodeInsightChannel(row)
		}
	}

	earliest, err := InsightLogsSince()
	if err != nil {
		return nil, 0, err
	}
	var scope *insightHourScope
	stale := 0
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
					return nil, 0, err
				}
				result = append(result, hour)
				continue
			}
			if scope == nil {
				loaded, err := loadInsightHourScope()
				if err != nil {
					return nil, 0, err
				}
				scope = &loaded
			}
			if hour, err = computeInsightHour(start, *scope); err != nil {
				return nil, 0, err
			}
			if err := storeInsightHour(hour); err != nil {
				common.SysLog(common.LogText("site insights hour %d not stored: %s", start, err.Error()))
			}
		} else if hour.stale {
			stale++
		}
		result = append(result, hour)
	}
	return result, stale, nil
}

// storeInsightHour saves a computed hour. During a release both colors may
// store the same hour at once: each save deletes and inserts in one
// transaction, so the hour is never left missing, and the one that loses
// fails on the primary key or a deadlock and rolls back whole. That failure
// is no error when the hour is now stored at this version or a newer one,
// since the other runner wrote the same figures.
func storeInsightHour(hour *insightHour) error {
	err := hour.save()
	if err == nil {
		return nil
	}
	var version []int
	if DB.Model(&InsightHour{}).Where("hour_start = ?", hour.start).Pluck("version", &version).Error == nil &&
		len(version) == 1 && version[0] >= insightHourVersion {
		return nil
	}
	return err
}

// FillInsightHours stores the final hours of the last days, newest first, at
// most limit of them, and returns how many it stored. It first computes the
// hours with no stored row; the views compute a missing hour on demand, and
// this keeps them from having to. With room left, it rebuilds the hours
// stored under an older version, newest first, but only those whose logs are
// all still there: a request belongs to the hour it started in and its logs
// are written after that, so an hour that starts at or after the earliest
// log is whole. So is the hour the earliest log falls in while every log it
// reads is still there (insightFirstHourWhole): nothing started in it before
// that log. An older hour keeps its old row for good, and the views count it
// in stale_hours. The rebuild waits while insightRebuildHeld says a server of
// the last release may still be running.
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
	var have []InsightHour
	if err := DB.Model(&InsightHour{}).Select("hour_start, version, created_at").
		Where("hour_start >= ? AND hour_start <= ?", oldest, newest).Find(&have).Error; err != nil {
		return 0, err
	}
	stored := make(map[int64]int, len(have))
	for _, row := range have {
		stored[row.HourStart] = row.Version
	}
	var scope *insightHourScope
	filled := 0
	store := func(start int64) error {
		if scope == nil {
			loaded, err := loadInsightHourScope()
			if err != nil {
				return err
			}
			scope = &loaded
		}
		hour, err := computeInsightHour(start, *scope)
		if err != nil {
			return err
		}
		if err := storeInsightHour(hour); err != nil {
			return err
		}
		filled++
		return nil
	}
	for start := newest; start >= max(oldest, earliest-earliest%3600-insightHourLookahead) && filled < limit; start -= 3600 {
		if _, ok := stored[start]; ok {
			continue
		}
		if err := store(start); err != nil {
			return filled, err
		}
	}
	if insightRebuildHeld(have, now) {
		return filled, nil
	}
	whole := earliest
	if first := insightHourKey(earliest); first < earliest && filled < limit {
		if version, ok := stored[first]; ok && version < insightHourVersion {
			intact, err := insightFirstHourWhole(first)
			if err != nil {
				return filled, err
			}
			if intact {
				whole = first
			}
		}
	}
	for start := newest; start >= max(oldest, whole) && filled < limit; start -= 3600 {
		if version, ok := stored[start]; !ok || version >= insightHourVersion {
			continue
		}
		if err := store(start); err != nil {
			return filled, err
		}
	}
	return filled, nil
}

// A server of the release before this one treats a row of this version as
// missing and stores the hour again under its own. During a release both run
// until the old one's last request ends, so rebuilding at once would have the
// two rewrite the same hours in turn. The rebuild therefore waits for
// insightRebuildStartDelay after this process started, and for as long as any
// older-version row was stored within insightRebuildQuiet: only a server that
// is still running writes those.
var (
	insightRebuildStartDelay int64 = 15 * 60
	insightRebuildQuiet      int64 = 30 * 60
)

func insightRebuildHeld(rows []InsightHour, now int64) bool {
	if now-common.StartTime < insightRebuildStartDelay {
		return true
	}
	return slices.ContainsFunc(rows, func(row InsightHour) bool {
		return row.Version < insightHourVersion && row.CreatedAt > now-insightRebuildQuiet
	})
}
