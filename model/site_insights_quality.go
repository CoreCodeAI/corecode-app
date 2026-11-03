package model

import (
	"cmp"
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

// QualityInsights reads latency, cache use and failures from the request
// logs. Unlike the performance panel it counts every logged failure,
// including requests the pool turned away.
type QualityInsights struct {
	Requests     int64          `json:"requests"`
	Errors       int64          `json:"errors"`
	ErrorRate    float64        `json:"error_rate"`
	TTFTP50      int64          `json:"ttft_p50_ms"`
	TTFTP95      int64          `json:"ttft_p95_ms"`
	CacheShare   float64        `json:"cache_share"`
	Models       []ModelQuality `json:"models"`
	Daily        []CacheDay     `json:"daily"`
	StreamEnds   []NamedCount   `json:"stream_ends"`
	StatusCodes  []NamedCount   `json:"status_codes"`
	ErrorReasons []NamedCount   `json:"error_reasons"`
	Truncated    bool           `json:"truncated"`
}

// logOtherFields is the part of a log's other column the quality, business
// and finance views read.
type logOtherFields struct {
	Frt                   float64 `json:"frt"`
	BillingSource         string  `json:"billing_source"`
	BillingOverflowSource string  `json:"billing_overflow_source"`
	BillingOverflowQuota  int64   `json:"billing_overflow_quota"`
	SubscriptionId        int     `json:"subscription_id"`
	CacheTokens           int64   `json:"cache_tokens"`
	CacheCreationTokens   int64   `json:"cache_creation_tokens"`
	StreamStatus          struct {
		EndReason string `json:"end_reason"`
	} `json:"stream_status"`
	AdminInfo struct {
		Client string `json:"client"`
	} `json:"admin_info"`
}

func parseLogOther(other string) logOtherFields {
	var fields logOtherFields
	if other != "" {
		_ = common.UnmarshalJsonStr(other, &fields)
	}
	return fields
}

// errorReason shortens an error log to its first clause, for grouping.
func errorReason(content string) string {
	reason := content
	if _, rest, ok := strings.Cut(content, ", "); ok && strings.HasPrefix(content, "status_code=") {
		reason = rest
	}
	if cut := strings.IndexAny(reason, ".\n"); cut > 0 {
		reason = reason[:cut]
	}
	if len(reason) > 80 {
		reason = reason[:80]
	}
	return reason
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

func GetQualityInsights(r InsightsRange, only []string) (*QualityInsights, error) {
	selected := QualityModelFilter(only)
	hours, err := loadInsightHours(r)
	if err != nil {
		return nil, err
	}
	result := &QualityInsights{}
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
	streamEnds := make(map[string]int64)
	statusCodes := make(map[string]int64)
	reasons := make(map[string]int64)
	allTTFT := histogram{}
	var cacheRead, inputTotal int64
	for _, hour := range hours {
		result.Truncated = result.Truncated || hour.summary.Truncated
		mergeCounts(streamEnds, hour.summary.StreamEnds)
		mergeCounts(statusCodes, hour.summary.StatusCodes)
		mergeCounts(reasons, hour.summary.ErrorReasons)
		day := days[r.DayStart(hour.start)]
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
			}
		}
	}
	result.TTFTP50, result.TTFTP95 = allTTFT.percentile(0.5), allTTFT.percentile(0.95)
	result.ErrorRate = ratio(float64(result.Errors), float64(result.Requests))
	result.CacheShare = ratio(float64(cacheRead), float64(inputTotal))
	for _, bucket := range models {
		quality := bucket.quality
		quality.ErrorRate = ratio(float64(quality.Errors), float64(quality.Requests))
		quality.TTFTP50, quality.TTFTP95 = bucket.ttft.percentile(0.5), bucket.ttft.percentile(0.95)
		quality.LatencyP50, quality.LatencyP95 = bucket.latency.percentile(0.5), bucket.latency.percentile(0.95)
		quality.CacheShare = ratio(float64(bucket.cache), float64(bucket.input))
		result.Models = append(result.Models, quality)
	}
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
	result.StatusCodes = sortedCounts(statusCodes)
	result.ErrorReasons = sortedCounts(reasons)
	if len(result.ErrorReasons) > 15 {
		result.ErrorReasons = result.ErrorReasons[:15]
	}
	return result, nil
}

func statusCodeName(code int) string {
	if code == 0 {
		return "unknown"
	}
	return strconv.Itoa(code)
}
