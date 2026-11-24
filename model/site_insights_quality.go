package model

import (
	"cmp"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// ModelQuality is one model's latency over successful requests. TTFT is the
// first-response time of streamed requests.
type ModelQuality struct {
	Model      string  `json:"model"`
	Vendor     string  `json:"vendor"`
	Requests   int64   `json:"requests"`
	Errors     int64   `json:"errors"`
	ErrorRate  float64 `json:"error_rate"`
	TTFTP50    int64   `json:"ttft_p50_ms"`
	TTFTP95    int64   `json:"ttft_p95_ms"`
	LatencyP50 int64   `json:"latency_p50_s"`
	LatencyP95 int64   `json:"latency_p95_s"`
	CacheShare float64 `json:"cache_share"`
}

// VendorQuality is one vendor's figures over every model it sells, merged
// from the models' histograms. The model filter does not narrow it: it is
// what the quick-select cards show before a vendor is picked.
type VendorQuality struct {
	Vendor    string   `json:"vendor"`
	Models    []string `json:"models"`
	Requests  int64    `json:"requests"`
	Errors    int64    `json:"errors"`
	ErrorRate float64  `json:"error_rate"`
	TTFTP50   int64    `json:"ttft_p50_ms"`
	TTFTP95   int64    `json:"ttft_p95_ms"`
	// CacheRead and CacheInput are the vendor's input tokens read from the
	// cache and all its input tokens, whatever the model filter selects, so
	// CacheShare is the hit rate of every model the vendor sells.
	CacheRead  int64   `json:"cache_read"`
	CacheInput int64   `json:"cache_input"`
	CacheShare float64 `json:"cache_share"`
}

// CacheDay is one day of input tokens split by how the cache served them.
type CacheDay struct {
	Day        int64   `json:"day"`
	Read       int64   `json:"read"`
	Write      int64   `json:"write"`
	Uncached   int64   `json:"uncached"`
	ReadShare  float64 `json:"read_share"`
	TTFTP50    int64   `json:"ttft_p50_ms"`
	ErrorRate  float64 `json:"error_rate"`
	Requests   int64   `json:"requests"`
	ErrorCount int64   `json:"errors"`
}

// QualityHour is one hour of the figures CacheDay holds for a day: requests
// and failures of the selected models, customers' only, and their streamed
// first-response times.
type QualityHour struct {
	Hour      int64   `json:"hour"`
	Requests  int64   `json:"requests"`
	Errors    int64   `json:"errors"`
	ErrorRate float64 `json:"error_rate"`
	TTFTP50   int64   `json:"ttft_p50_ms"`
	TTFTP95   int64   `json:"ttft_p95_ms"`
	// ServiceRequests and ServiceErrors are the hour's requests the service
	// could have served and the failed ones it caused, over the selected
	// models: no-channel refusals and the customers' 4xx are left out
	// (serviceFailureCounts). Absent on an hour stored before categories were
	// kept that has failures. The categories are the range's own (the vendor
	// filter applies, the model filter does not), so a model filter narrower
	// than a vendor leaves them an approximation, as the range's rate is.
	ServiceRequests *int64 `json:"service_requests,omitempty"`
	ServiceErrors   *int64 `json:"service_errors,omitempty"`
}

// QualityInsights reads latency, cache use and failures from the request
// logs. Unlike the performance panel it counts every logged failure,
// including requests the pool turned away.
//
// Every headline figure, series and model row counts customers only, as the
// capacity view does, so the two agree on the same range. Staff (administrators
// and root) are counted apart in StaffRequests and StaffErrors on the same
// model filter. Hourly is every hour of a range up to insightsHourlySpan,
// keyed by UTC hour start, and follows the model filter as Daily does.
// ErrorCategories counts customers' failures only; when the filter selects
// models of one vendor it counts that vendor's, otherwise every model's, so
// its sum is Errors for an unfiltered range.
type QualityInsights struct {
	Requests int64 `json:"requests"`
	Errors   int64 `json:"errors"`
	// StaffRequests and StaffErrors are the staff's requests and failed
	// requests on the selected models, which no figure above includes.
	StaffRequests int64 `json:"staff_requests"`
	StaffErrors   int64 `json:"staff_errors"`
	// Attempts and AttemptErrors are customers' tries on a channel, retries
	// included, and the ones that failed, over every model: the rollup keeps
	// them for the whole site only, so the model filter cannot narrow them.
	// Absent while the range has hours stored under an older version.
	Attempts      *int64         `json:"attempts,omitempty"`
	AttemptErrors *int64         `json:"attempt_errors,omitempty"`
	ErrorRate     float64        `json:"error_rate"`
	TTFTP50       int64          `json:"ttft_p50_ms"`
	TTFTP95       int64          `json:"ttft_p95_ms"`
	CacheShare    float64        `json:"cache_share"`
	Models        []ModelQuality `json:"models"`
	// RetiredModels names the models of Models that no enabled channel serves
	// now: taken off sale since they were last requested, so their failures
	// are history and not something to act on.
	RetiredModels []string        `json:"retired_models"`
	Vendors       []VendorQuality `json:"vendors"`
	// AllModels is every model's figures whatever the filter selects, for
	// the quick-select card that clears it. Its Vendor and Models are empty.
	AllModels VendorQuality `json:"all_models"`
	Daily     []CacheDay    `json:"daily"`
	Hourly    []QualityHour `json:"hourly,omitempty"`
	// TTFTVendors is each vendor's first-response time by day, and by hour
	// when the range has hourly rows, over the selected models. A point with
	// no streamed request is left out.
	TTFTVendors []TTFTSeries `json:"ttft_vendors"`
	// VendorTrends is each vendor's requests and failed requests by day, and
	// by hour when the range has hourly rows, over the selected models: the
	// headline's counts split by vendor. A day or hour with no request is left
	// out.
	VendorTrends []VendorTrend `json:"vendor_trends"`
	StreamEnds   []NamedCount  `json:"stream_ends"`
	// StatusCodes and ErrorReasons count the customers' failed tries, every
	// try of a request included, so their sums are FailedTries.
	StatusCodes  []NamedCount `json:"status_codes"`
	ErrorReasons []NamedCount `json:"error_reasons"`
	// ErrorReasonsOther counts the failed tries whose reason is not in
	// ErrorReasons, which keeps the most frequent ones.
	ErrorReasonsOther int64        `json:"error_reasons_other"`
	ErrorCategories   []NamedCount `json:"error_categories"`
	// FailedTries is the customers' failed tries over every model, and
	// VendorFailures splits them by vendor. Each vendor's reasons and status
	// codes are its top ones with the rest counted apart, so each list and its
	// rest add up to the vendor's FailedTries. Older hours carry no vendor
	// split, and their status codes and reasons count other tries, so while
	// StaleHours is above zero both are withheld, as Attempts are.
	FailedTries    *int64                   `json:"failed_tries,omitempty"`
	VendorFailures []VendorFailureBreakdown `json:"vendor_failures"`
	Truncated      bool                     `json:"truncated"`
	// Tasks is how the async tasks submitted in the range ended; their
	// submissions are also requests above, counted as served.
	Tasks *TaskOutcomes `json:"tasks,omitempty"`
	// Refusals is what was turned away before any channel was tried.
	Refusals *QualityRefusals `json:"refusals,omitempty"`
	// StaleHours counts the range's hours stored under an older rollup
	// version, which count attempts rather than requests.
	StaleHours int `json:"stale_hours"`
}

// TTFTSeries is one vendor's first-response time over the range's days, and
// over its hours when the range has hourly rows. Only streamed customers'
// requests with a first-response time count: the points of the TTFT histograms.
type TTFTSeries struct {
	Vendor string      `json:"vendor"`
	Daily  []TTFTPoint `json:"daily"`
	Hourly []TTFTPoint `json:"hourly,omitempty"`
}

// TTFTPoint is one day or hour of a TTFTSeries: Start is its start in unix
// seconds, Requests the streamed requests it holds, and the percentiles are
// read from their merged histogram.
type TTFTPoint struct {
	Start    int64 `json:"start"`
	Requests int64 `json:"requests"`
	TTFTP50  int64 `json:"ttft_p50_ms"`
	TTFTP95  int64 `json:"ttft_p95_ms"`
}

// VendorTrend is one vendor's requests and failures over the range's days,
// and over its hours when the range has hourly rows. They are the counts the
// headline's Requests and Errors add up from, so the vendors' points sum to
// the daily and hourly rows.
type VendorTrend struct {
	Vendor string             `json:"vendor"`
	Daily  []VendorTrendPoint `json:"daily"`
	Hourly []VendorTrendPoint `json:"hourly,omitempty"`
}

// VendorTrendPoint is one day or hour of a VendorTrend: Start is its start in
// unix seconds.
type VendorTrendPoint struct {
	Start    int64 `json:"start"`
	Requests int64 `json:"requests"`
	Errors   int64 `json:"errors"`
}

// VendorFailureBreakdown is one vendor's failed tries by reason and by status
// code. Reasons and StatusCodes hold the vendor's most frequent entries; the
// Other fields count the rest.
type VendorFailureBreakdown struct {
	Vendor           string       `json:"vendor"`
	FailedTries      int64        `json:"failed_tries"`
	Reasons          []NamedCount `json:"reasons"`
	OtherReasons     int64        `json:"other_reasons"`
	StatusCodes      []NamedCount `json:"status_codes"`
	OtherStatusCodes int64        `json:"other_status_codes"`
}

// QualityRefusals counts requests turned away before any channel was tried,
// whatever the model filter. NoChannel is customers' requests no channel of
// their group could take; they are also in Requests, Errors and the
// no_channel error category. RiskGate is the requests the risk gate blocked,
// read from its own events (observe-mode hits left out), by stage in
// RiskGateStages; they are not in Requests.
type QualityRefusals struct {
	NoChannel int64 `json:"no_channel"`
	// NoChannelBy splits NoChannel by the group and model asked for, most
	// first, and NoChannelUsers names the users who asked most. Only hours
	// stored since the split was kept carry it (rollup version 7):
	// NoChannelSplit is how many of NoChannel those hours account for, so a
	// range with older hours reads as split in part.
	NoChannelBy    []NoChannelCount `json:"no_channel_by"`
	NoChannelUsers []UserCount      `json:"no_channel_users"`
	NoChannelSplit int64            `json:"no_channel_split"`
	RiskGate       int64            `json:"risk_gate"`
	RiskGateStages []NamedCount     `json:"risk_gate_stages"`
}

// NoChannelCount is the requests no channel could take for one group and
// model.
type NoChannelCount struct {
	Group string `json:"group"`
	Model string `json:"model"`
	Count int64  `json:"count"`
}

// qualityNoChannelTopN is how many groups and models, and how many users, the
// quality view names for the requests no channel could take.
const qualityNoChannelTopN = 20

// noChannelSplit lists the merged group-and-model counts and user counts of
// the requests no channel could take, most first, with the users' names.
func noChannelSplit(by, users map[string]int64) ([]NoChannelCount, []UserCount, error) {
	split := make([]NoChannelCount, 0, len(by))
	for _, item := range sortedCounts(by) {
		group, modelName, _ := strings.Cut(item.Name, "\x00")
		split = append(split, NoChannelCount{Group: group, Model: modelName, Count: item.Count})
	}
	split = split[:min(len(split), qualityNoChannelTopN)]
	top := make([]UserCount, 0, len(users))
	ids := make([]int, 0, len(users))
	for _, item := range sortedCounts(users) {
		id, err := strconv.Atoi(item.Name)
		if err != nil || len(top) == qualityNoChannelTopN {
			continue
		}
		top = append(top, UserCount{UserRef: UserRef{UserID: id}, Count: item.Count})
		ids = append(ids, id)
	}
	names, err := usernamesByID(ids)
	if err != nil {
		return nil, nil, err
	}
	for i := range top {
		top[i].Username = names[top[i].UserID]
	}
	return split, top, nil
}

// readRiskGateBlocks counts the requests the risk gate blocked in the range,
// by stage.
func readRiskGateBlocks(r InsightsRange) ([]NamedCount, int64, error) {
	stages := []NamedCount{}
	err := DB.Model(&RiskGateEvent{}).Select("stage AS name, COUNT(*) AS count").
		Where("created_at >= ? AND created_at < ? AND action = ?", r.Start, r.End, RiskGateActionBlocked).
		Group("stage").Scan(&stages).Error
	if err != nil {
		return nil, 0, err
	}
	slices.SortFunc(stages, func(a, b NamedCount) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.Name, b.Name))
	})
	var total int64
	for _, stage := range stages {
		total += stage.Count
	}
	return stages, total, nil
}

// logOtherFields is the part of a log's other column the quality, business
// and finance views read.
type logOtherFields struct {
	Frt                   float64 `json:"frt"`
	BillingSource         string  `json:"billing_source"`
	BillingOverflowSource string  `json:"billing_overflow_source"`
	BillingOverflowQuota  int64   `json:"billing_overflow_quota"`
	SubscriptionId        int     `json:"subscription_id"`
	SubscriptionPlanId    int     `json:"subscription_plan_id"`
	// SubscriptionGift is whether the paying plan was given, recorded at
	// billing time; nil on a log from before it was.
	SubscriptionGift      *bool `json:"subscription_gift"`
	CacheTokens           int64 `json:"cache_tokens"`
	CacheCreationTokens   int64 `json:"cache_creation_tokens"`
	CacheCreationTokens5m int64 `json:"cache_creation_tokens_5m"`
	CacheCreationTokens1h int64 `json:"cache_creation_tokens_1h"`
	// ReasoningTokens is the reasoning part of the completion tokens, recorded
	// when the upstream reports it and above zero (PostTextConsumeQuota).
	ReasoningTokens int64 `json:"reasoning_tokens"`
	// PromptIncludesCache is billing's rule for the log's usage, recorded at
	// billing time; nil on a log from before it was (uncachedPrompt).
	PromptIncludesCache *bool  `json:"prompt_includes_cache"`
	UsageSemantic       string `json:"usage_semantic"`
	Claude              bool   `json:"claude"`
	// IsTask marks an async task's billing logs; PreConsumedQuota is set on
	// a task's settlement logs only.
	IsTask           bool   `json:"is_task"`
	TaskId           string `json:"task_id"`
	PreConsumedQuota *int64 `json:"pre_consumed_quota"`
	// ViolationFee marks the consume log of a fee charged for a refused
	// request (ChargeViolationFeeIfNeeded).
	ViolationFee bool `json:"violation_fee"`
	// ErrorType is an error log's error type: new_api_error when new-api
	// raised it, another when an upstream returned it.
	ErrorType    string `json:"error_type"`
	StreamStatus struct {
		EndReason string `json:"end_reason"`
	} `json:"stream_status"`
	AdminInfo struct {
		Client string `json:"client"`
		// UseChannel lists the channels a request tried, in order; the last
		// one served it.
		UseChannel []string `json:"use_channel"`
	} `json:"admin_info"`
}

func parseLogOther(other string) logOtherFields {
	var fields logOtherFields
	if other != "" {
		_ = common.UnmarshalJsonStr(other, &fields)
	}
	return fields
}

// insightReasonRunes caps a failure reason, ellipsis included.
const insightReasonRunes = 120

var (
	// Ids that vary per request: a UUID or a run of letters, digits and
	// underscores, which is an id only when it holds a digit (normalizeReason).
	reasonIDPattern = regexp.MustCompile(`\b[0-9A-Za-z]{8}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{4}-[0-9A-Za-z]{12}\b|\b[A-Za-z0-9_]{20,}\b`)
	// A number of four or more digits standing alone. A dated model name
	// (claude-sonnet-4-5-20250929) is not one: its digits follow a hyphen.
	reasonNumberPattern = regexp.MustCompile(`(^|[\s(=:,])\d{4,}([\s),.:]|$)`)
	// A date, optionally with a time, and a bare clock time: they vary per
	// request, so they must not make a reason of their own.
	reasonTimePattern = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?|\b\d{1,2}:\d{2}(:\d{2})?\b`)
	// An index in a field path: messages.3.content and tools[0].
	reasonDotIndexPattern     = regexp.MustCompile(`([A-Za-z_])\.\d+\.`)
	reasonBracketIndexPattern = regexp.MustCompile(`\[\d+\]`)
	// An amount: a decimal standing alone or after a currency sign, such as a
	// balance (🪙10.675000). A version is not one: gpt-image-2.5 has a hyphen.
	reasonAmountPattern = regexp.MustCompile(`(^|[\s(=:,🪙$¥])\d+\.\d+\b`)
)

// reasonJSONDepth bounds how many error bodies nested in a message are opened.
const reasonJSONDepth = 4

// unwrapJSONReason reads an error body that is JSON, such as a task
// failure that carries the upstream's body as its message, down to the
// innermost message, with the outermost code before it. Capped at
// insightReasonRunes, the raw body kept its noise and lost the message.
// Text that is not a JSON error body is returned as it is.
func unwrapJSONReason(text string) string {
	code, message := "", text
	for range reasonJSONDepth {
		trimmed := strings.TrimSpace(message)
		if !strings.HasPrefix(trimmed, "{") {
			break
		}
		var body map[string]any
		if common.UnmarshalJsonStr(trimmed, &body) != nil {
			break
		}
		if inner, ok := body["error"].(map[string]any); ok {
			body = inner
		}
		next := ""
		for _, key := range []string{"message", "error", "detail", "msg"} {
			if value, ok := body[key].(string); ok && strings.TrimSpace(value) != "" {
				next = value
				break
			}
		}
		if code == "" {
			for _, key := range []string{"code", "type"} {
				if value, ok := body[key].(string); ok && value != "" {
					code = value
					break
				}
			}
		}
		if next == "" {
			break
		}
		message = next
	}
	message = strings.TrimSpace(message)
	if message == strings.TrimSpace(text) {
		return text
	}
	if code != "" && !strings.Contains(message, code) {
		return code + ": " + message
	}
	return message
}

// errorReason shortens an error log to the sentence that names the failure,
// for grouping. The status prefix goes. The cut is at a sentence end, a period
// followed by a space or the end, or a newline, so a model name with dots
// (gpt-image-2.5) and a field path (messages.3.content) survive. Ids and
// numbers that vary per request are replaced by placeholders, so they do not
// make a reason of their own, and the text is capped at insightReasonRunes
// runes with an ellipsis.
func errorReason(content string) string {
	reason := strings.TrimSpace(content)
	if _, rest, ok := strings.Cut(reason, ", "); ok && strings.HasPrefix(reason, "status_code=") {
		reason = rest
	}
	reason = strings.TrimSpace(capReason(normalizeReason(cutSentence(unwrapJSONReason(strings.TrimSpace(reason))))))
	if reason == "" {
		return "unknown"
	}
	return reason
}

// cutSentence keeps the text up to its first sentence end.
func cutSentence(text string) string {
	for i := 0; i < len(text); i++ {
		switch {
		case text[i] == '\n' && i > 0:
			return text[:i]
		case text[i] == '.' && i > 0 && (i+1 == len(text) || text[i+1] == ' '):
			return text[:i]
		}
	}
	return text
}

// normalizeReason replaces the parts of a reason that vary per request.
func normalizeReason(reason string) string {
	reason = reasonIDPattern.ReplaceAllStringFunc(reason, func(id string) string {
		if strings.ContainsAny(id, "0123456789") {
			return "<id>"
		}
		return id
	})
	reason = reasonTimePattern.ReplaceAllString(reason, "<time>")
	reason = reasonAmountPattern.ReplaceAllString(reason, "${1}<n>")
	// Two passes, so that two numbers separated by one space both go.
	for range 2 {
		reason = reasonNumberPattern.ReplaceAllString(reason, "${1}<n>${2}")
	}
	reason = reasonDotIndexPattern.ReplaceAllString(reason, "${1}.<n>.")
	return reasonBracketIndexPattern.ReplaceAllString(reason, "[<n>]")
}

// capReason cuts a reason to insightReasonRunes runes, the last one an ellipsis.
func capReason(reason string) string {
	runes := []rune(reason)
	if len(runes) <= insightReasonRunes {
		return reason
	}
	return string(runes[:insightReasonRunes-1]) + "…"
}

// QualityModelFilter limits the headline figures and the daily series to the
// named models. The per-model table, the status codes, the failure reasons and
// the stream ends ignore it: the table is where the filter's options come
// from, and the other three are counted per hour, not per model.
// A nil or empty filter selects every model.
func QualityModelFilter(models []string) func(string) bool {
	if len(models) == 0 {
		return func(string) bool { return true }
	}
	return func(name string) bool { return slices.Contains(models, name) }
}

// filterVendor is the vendor every named model is sold under, or "" when
// the filter is empty or spans vendors.
func filterVendor(models []string) string {
	if len(models) == 0 {
		return ""
	}
	vendor := ModelVendor(models[0])
	for _, name := range models[1:] {
		if ModelVendor(name) != vendor {
			return ""
		}
	}
	return vendor
}

func GetQualityInsights(r InsightsRange, only []string) (*QualityInsights, error) {
	selected := QualityModelFilter(only)
	hours, stale, err := loadInsightHoursStale(r)
	if err != nil {
		return nil, err
	}
	result := &QualityInsights{StaleHours: stale}
	type modelBucket struct {
		quality       ModelQuality
		ttft, latency histogram
		cache, input  int64
	}
	models := make(map[string]*modelBucket)
	type dayBucket struct {
		day  CacheDay
		ttft histogram
	}
	days := make(map[int64]*dayBucket)
	for _, day := range r.days() {
		days[day] = &dayBucket{day: CacheDay{Day: day}, ttft: histogram{}}
	}
	dailyTTFT := make(map[string]map[int64]histogram)
	hourlyTTFT := make(map[string]map[int64]histogram)
	dailyTrend := make(map[string]map[int64]*VendorTrendPoint)
	hourlyTrend := make(map[string]map[int64]*VendorTrendPoint)
	type hourBucket struct {
		hour       QualityHour
		ttft       histogram
		categories map[string]int64
		// unknown is set for an hour with failures stored before categories were kept.
		unknown bool
	}
	hourStarts := r.hourStarts()
	hourly := make(map[int64]*hourBucket, len(hourStarts))
	for _, start := range hourStarts {
		hourly[start] = &hourBucket{hour: QualityHour{Hour: start}, ttft: histogram{}}
	}
	vendor := filterVendor(only)
	refusals := &QualityRefusals{}
	noChannelBy, noChannelUsers := map[string]int64{}, map[string]int64{}
	streamEnds := make(map[string]int64)
	statusCodes := make(map[string]int64)
	reasons := make(map[string]int64)
	categories := make(map[string]int64)
	allTTFT := histogram{}
	failures := make(map[string]*vendorFailureBucket)
	var cacheRead, inputTotal, attempts, attemptErrors, reasonsOther, failedTries int64
	for _, hour := range hours {
		result.Truncated = result.Truncated || hour.summary.Truncated
		attempts += hour.summary.Attempts
		attemptErrors += hour.summary.AttemptErrors
		mergeCounts(streamEnds, hour.summary.StreamEnds)
		mergeCounts(statusCodes, hour.summary.StatusCodes)
		mergeCounts(reasons, hour.summary.ErrorReasons)
		reasonsOther += hour.summary.ErrorReasonsOther
		for name, staff := range hour.summary.StaffModels {
			if selected(name) {
				result.StaffRequests += staff.Requests
				result.StaffErrors += staff.Errors
			}
		}
		for name, found := range hour.summary.VendorFailures {
			bucket := failures[name]
			if bucket == nil {
				bucket = &vendorFailureBucket{reasons: make(map[string]int64), statuses: make(map[string]int64)}
				failures[name] = bucket
			}
			bucket.tries += found.Tries
			mergeCounts(bucket.reasons, found.Reasons)
			bucket.reasonsOther += found.ReasonsOther
			mergeCounts(bucket.statuses, found.StatusCodes)
			bucket.statusOther += found.StatusOther
			failedTries += found.Tries
		}
		refusals.NoChannel += hour.summary.Categories[ErrorNoChannel]
		mergeCounts(noChannelBy, hour.summary.NoChannel)
		mergeCounts(noChannelUsers, hour.summary.NoChannelUsers)
		refusals.NoChannelSplit += hour.summary.NoChannelOther
		for _, count := range hour.summary.NoChannel {
			refusals.NoChannelSplit += count
		}
		// An hour without customers' requests holds no vendor split and no
		// categories either.
		hourCategories := hour.summary.Categories
		if vendor != "" && hour.summary.Vendors != nil {
			hourCategories = vendorSummary(hour.summary, vendor).Categories
		}
		mergeCounts(categories, hourCategories)
		day := days[r.DayStart(hour.start)]
		slot := hourly[hour.start]
		if slot != nil {
			slot.categories = hourCategories
			slot.unknown = hour.uncategorised && hour.summary.Errors > 0
		}
		for name, model := range hour.models {
			row := model.row
			bucket := models[name]
			if bucket == nil {
				bucket = &modelBucket{quality: ModelQuality{Model: name, Vendor: ModelVendor(name)}, ttft: histogram{}, latency: histogram{}}
				models[name] = bucket
			}
			bucket.quality.Requests += row.Requests
			bucket.quality.Errors += row.Errors
			bucket.ttft.merge(model.ttft)
			bucket.latency.merge(model.latency)
			input := row.Uncached + row.CacheRead + row.CacheWrite
			bucket.cache += row.CacheRead
			bucket.input += input
			if !selected(name) {
				continue
			}
			result.Requests += row.Requests
			result.Errors += row.Errors
			allTTFT.merge(model.ttft)
			cacheRead += row.CacheRead
			inputTotal += input
			if day != nil {
				day.day.Requests += row.Requests
				day.day.ErrorCount += row.Errors
				day.day.Read += row.CacheRead
				day.day.Write += row.CacheWrite
				day.day.Uncached += row.Uncached
				day.ttft.merge(model.ttft)
				mergeTTFT(dailyTTFT, ModelVendor(name), day.day.Day, model.ttft)
				addVendorTrend(dailyTrend, ModelVendor(name), day.day.Day, row.Requests, row.Errors)
			}
			if slot != nil {
				slot.hour.Requests += row.Requests
				slot.hour.Errors += row.Errors
				slot.ttft.merge(model.ttft)
				mergeTTFT(hourlyTTFT, ModelVendor(name), slot.hour.Hour, model.ttft)
				addVendorTrend(hourlyTrend, ModelVendor(name), slot.hour.Hour, row.Requests, row.Errors)
			}
		}
	}
	for _, start := range hourStarts {
		slot := hourly[start]
		slot.hour.ServiceRequests, slot.hour.ServiceErrors = serviceFailureCounts(slot.unknown, slot.hour.Requests, slot.hour.Errors, slot.categories)
		slot.hour.ErrorRate = ratio(float64(slot.hour.Errors), float64(slot.hour.Requests))
		slot.hour.TTFTP50, slot.hour.TTFTP95 = slot.ttft.percentile(0.5), slot.ttft.percentile(0.95)
		result.Hourly = append(result.Hourly, slot.hour)
	}
	result.ErrorCategories = sortedCounts(categories)
	result.TTFTVendors = ttftSeriesOf(dailyTTFT, hourlyTTFT)
	result.VendorTrends = vendorTrendsOf(dailyTrend, hourlyTrend)
	result.TTFTP50, result.TTFTP95 = allTTFT.percentile(0.5), allTTFT.percentile(0.95)
	type vendorBucket struct {
		quality VendorQuality
		ttft    histogram
	}
	vendors := make(map[string]*vendorBucket)
	everything := vendorBucket{ttft: histogram{}}
	result.ErrorRate = ratio(float64(result.Errors), float64(result.Requests))
	result.CacheShare = ratio(float64(cacheRead), float64(inputTotal))
	for _, bucket := range models {
		quality := bucket.quality
		quality.ErrorRate = ratio(float64(quality.Errors), float64(quality.Requests))
		quality.TTFTP50, quality.TTFTP95 = bucket.ttft.percentile(0.5), bucket.ttft.percentile(0.95)
		quality.LatencyP50, quality.LatencyP95 = bucket.latency.percentile(0.5), bucket.latency.percentile(0.95)
		quality.CacheShare = ratio(float64(bucket.cache), float64(bucket.input))
		result.Models = append(result.Models, quality)
		vendor := vendors[quality.Vendor]
		if vendor == nil {
			vendor = &vendorBucket{quality: VendorQuality{Vendor: quality.Vendor}, ttft: histogram{}}
			vendors[quality.Vendor] = vendor
		}
		vendor.quality.Models = append(vendor.quality.Models, quality.Model)
		vendor.quality.Requests += quality.Requests
		vendor.quality.Errors += quality.Errors
		vendor.quality.CacheRead += bucket.cache
		vendor.quality.CacheInput += bucket.input
		vendor.ttft.merge(bucket.ttft)
		everything.quality.Requests += quality.Requests
		everything.quality.Errors += quality.Errors
		everything.quality.CacheRead += bucket.cache
		everything.quality.CacheInput += bucket.input
		everything.ttft.merge(bucket.ttft)
	}
	result.AllModels = everything.quality
	result.AllModels.ErrorRate = ratio(float64(result.AllModels.Errors), float64(result.AllModels.Requests))
	result.AllModels.TTFTP50, result.AllModels.TTFTP95 = everything.ttft.percentile(0.5), everything.ttft.percentile(0.95)
	result.AllModels.CacheShare = ratio(float64(result.AllModels.CacheRead), float64(result.AllModels.CacheInput))
	result.Vendors = []VendorQuality{}
	for _, bucket := range vendors {
		vendor := bucket.quality
		slices.Sort(vendor.Models)
		vendor.ErrorRate = ratio(float64(vendor.Errors), float64(vendor.Requests))
		vendor.TTFTP50, vendor.TTFTP95 = bucket.ttft.percentile(0.5), bucket.ttft.percentile(0.95)
		vendor.CacheShare = ratio(float64(vendor.CacheRead), float64(vendor.CacheInput))
		result.Vendors = append(result.Vendors, vendor)
	}
	slices.SortFunc(result.Vendors, func(a, b VendorQuality) int {
		return cmp.Or(cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.Vendor, b.Vendor))
	})
	slices.SortFunc(result.Models, func(a, b ModelQuality) int {
		return cmp.Or(cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.Model, b.Model))
	})
	for _, bucket := range days {
		bucket.day.TTFTP50 = bucket.ttft.percentile(0.5)
		bucket.day.ReadShare = ratio(float64(bucket.day.Read), float64(bucket.day.Read+bucket.day.Write+bucket.day.Uncached))
		bucket.day.ErrorRate = ratio(float64(bucket.day.ErrorCount), float64(bucket.day.Requests))
		result.Daily = append(result.Daily, bucket.day)
	}
	slices.SortFunc(result.Daily, func(a, b CacheDay) int { return cmp.Compare(a.Day, b.Day) })
	result.StreamEnds = sortedCounts(streamEnds)
	if stale == 0 {
		result.Attempts, result.AttemptErrors = &attempts, &attemptErrors
		result.FailedTries = &failedTries
		result.VendorFailures = vendorFailureBreakdowns(failures)
	}
	result.StatusCodes = sortedCounts(statusCodes)
	result.ErrorReasons = sortedCounts(reasons)
	if len(result.ErrorReasons) > 15 {
		for _, rest := range result.ErrorReasons[15:] {
			reasonsOther += rest.Count
		}
		result.ErrorReasons = result.ErrorReasons[:15]
	}
	result.ErrorReasonsOther = reasonsOther
	if refusals.RiskGateStages, refusals.RiskGate, err = readRiskGateBlocks(r); err != nil {
		return nil, err
	}
	if refusals.NoChannelBy, refusals.NoChannelUsers, err = noChannelSplit(noChannelBy, noChannelUsers); err != nil {
		return nil, err
	}
	result.Refusals = refusals
	if result.Tasks, err = GetTaskOutcomes(r); err != nil {
		return nil, err
	}
	if result.RetiredModels, err = retiredModels(result.Models); err != nil {
		return nil, err
	}
	return result, nil
}

// mergeTTFT adds a model's first-response histogram to the vendor's histogram
// at start. An empty histogram adds no point.
func mergeTTFT(byVendor map[string]map[int64]histogram, vendor string, start int64, ttft histogram) {
	if len(ttft) == 0 {
		return
	}
	if byVendor[vendor] == nil {
		byVendor[vendor] = make(map[int64]histogram)
	}
	if byVendor[vendor][start] == nil {
		byVendor[vendor][start] = histogram{}
	}
	byVendor[vendor][start].merge(ttft)
}

// addVendorTrend adds a model's requests and failures to the vendor's count at
// start. A model with no request adds no point.
func addVendorTrend(byVendor map[string]map[int64]*VendorTrendPoint, vendor string, start, requests, errors int64) {
	if requests == 0 && errors == 0 {
		return
	}
	if byVendor[vendor] == nil {
		byVendor[vendor] = make(map[int64]*VendorTrendPoint)
	}
	point := byVendor[vendor][start]
	if point == nil {
		point = &VendorTrendPoint{Start: start}
		byVendor[vendor][start] = point
	}
	point.Requests += requests
	point.Errors += errors
}

// vendorTrendsOf lists each vendor that had a request in the range, by name,
// with its daily and hourly points in start order.
func vendorTrendsOf(daily, hourly map[string]map[int64]*VendorTrendPoint) []VendorTrend {
	names := make([]string, 0, len(daily))
	for name := range daily {
		names = append(names, name)
	}
	slices.Sort(names)
	pointsOf := func(byStart map[int64]*VendorTrendPoint) []VendorTrendPoint {
		var points []VendorTrendPoint
		for _, point := range byStart {
			points = append(points, *point)
		}
		slices.SortFunc(points, func(a, b VendorTrendPoint) int { return cmp.Compare(a.Start, b.Start) })
		return points
	}
	trends := make([]VendorTrend, 0, len(names))
	for _, name := range names {
		trends = append(trends, VendorTrend{Vendor: name, Daily: pointsOf(daily[name]), Hourly: pointsOf(hourly[name])})
	}
	return trends
}

// ttftSeriesOf lists each vendor that streamed a request in the range, by
// name, with its daily and hourly points.
func ttftSeriesOf(daily, hourly map[string]map[int64]histogram) []TTFTSeries {
	names := make([]string, 0, len(daily))
	for name := range daily {
		names = append(names, name)
	}
	slices.Sort(names)
	series := make([]TTFTSeries, 0, len(names))
	for _, name := range names {
		series = append(series, TTFTSeries{Vendor: name, Daily: ttftPoints(daily[name]), Hourly: ttftPoints(hourly[name])})
	}
	return series
}

// ttftPoints lists the points that hold a streamed request, in start order.
func ttftPoints(byStart map[int64]histogram) []TTFTPoint {
	starts := make([]int64, 0, len(byStart))
	for start := range byStart {
		starts = append(starts, start)
	}
	slices.Sort(starts)
	var points []TTFTPoint
	for _, start := range starts {
		ttft := byStart[start]
		if n := ttft.count(); n > 0 {
			points = append(points, TTFTPoint{Start: start, Requests: n, TTFTP50: ttft.percentile(0.5), TTFTP95: ttft.percentile(0.95)})
		}
	}
	return points
}

// retiredModels names, sorted, the listed models that no enabled ability
// serves now.
func retiredModels(models []ModelQuality) ([]string, error) {
	retired := []string{}
	if len(models) == 0 {
		return retired, nil
	}
	var served []string
	if err := DB.Model(&Ability{}).Where("enabled = ?", true).Distinct("model").Pluck("model", &served).Error; err != nil {
		return nil, err
	}
	for _, row := range models {
		if !slices.Contains(served, row.Model) {
			retired = append(retired, row.Model)
		}
	}
	slices.Sort(retired)
	return retired, nil
}

// qualityVendorTopN is how many reasons and status codes the quality view
// names for each vendor; the rest are counted apart.
const qualityVendorTopN = 10

// vendorFailureBucket is one vendor's failed tries merged across the hours.
type vendorFailureBucket struct {
	tries        int64
	reasons      map[string]int64
	reasonsOther int64
	statuses     map[string]int64
	statusOther  int64
}

// vendorFailureBreakdowns lists each vendor's failed tries, the most failing
// vendor first. Entries past the top qualityVendorTopN join the Other counts.
func vendorFailureBreakdowns(buckets map[string]*vendorFailureBucket) []VendorFailureBreakdown {
	list := make([]VendorFailureBreakdown, 0, len(buckets))
	for name, bucket := range buckets {
		reasons, reasonsRest := trimTop(bucket.reasons, qualityVendorTopN)
		statuses, statusesRest := trimTop(bucket.statuses, qualityVendorTopN)
		list = append(list, VendorFailureBreakdown{
			Vendor:           name,
			FailedTries:      bucket.tries,
			Reasons:          sortedCounts(reasons),
			OtherReasons:     bucket.reasonsOther + reasonsRest,
			StatusCodes:      sortedCounts(statuses),
			OtherStatusCodes: bucket.statusOther + statusesRest,
		})
	}
	slices.SortFunc(list, func(a, b VendorFailureBreakdown) int {
		return cmp.Or(cmp.Compare(b.FailedTries, a.FailedTries), cmp.Compare(a.Vendor, b.Vendor))
	})
	return list
}

func statusCodeName(code int) string {
	if code == 0 {
		return "unknown"
	}
	return strconv.Itoa(code)
}
