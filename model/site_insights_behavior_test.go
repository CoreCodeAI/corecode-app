package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const behaviorDay0 = int64(1759190400) // 2025-09-30 00:00 UTC

// behaviorRows is n requests of one model and band in the hour at start, all
// with the given output and latency.
func behaviorRows(start int64, name string, band int, n, output, latency int64) InsightBehaviorHour {
	return InsightBehaviorHour{
		HourStart: start, ModelName: name, Band: band, Requests: n, Input: n * 1000, CacheRead: n * 900,
		Output:  histogram{output: n}.encode(),
		Latency: histogram{latency: n}.encode(),
		TTFT:    histogram{}.encode(), Reasoning: histogram{}.encode(),
	}
}

func storeBehaviorDays(t *testing.T, rows []InsightBehaviorHour, from, to int64) {
	t.Helper()
	if len(rows) > 0 {
		require.NoError(t, DB.Create(&rows).Error)
	}
	var marks []InsightBehaviorHour
	for start := from; start < to; start += 3600 {
		marks = append(marks, InsightBehaviorHour{HourStart: start})
	}
	require.NoError(t, DB.Create(&marks).Error)
}

func TestBehaviorFlagsAChangeAgainstTheSevenDaysBefore(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			var rows []InsightBehaviorHour
			for day := range int64(8) {
				output := int64(400)
				if day == 7 {
					output = 120
				}
				rows = append(rows, behaviorRows(behaviorDay0+day*86400+3600, "gpt-6-sol", 2, 100, output, 20))
			}
			storeBehaviorDays(t, rows, behaviorDay0, behaviorDay0+8*86400)
			r := InsightsRange{Start: behaviorDay0 + 7*86400, End: behaviorDay0 + 8*86400}

			result, err := GetModelBehavior(r, nil)
			require.NoError(t, err)

			require.Len(t, result.Models, 1)
			day := result.Models[0].Daily[0]
			assert.EqualValues(t, 100, day.Requests)
			assert.EqualValues(t, 120, day.Output)
			assert.InDelta(t, 0.9, day.CacheShare, 1e-9)
			require.Len(t, day.Flags, 1, "output fell, latency did not move")
			assert.Equal(t, BehaviorFlag{Metric: BehaviorMetricOutput, Level: "red", Band: 2, Value: 120, Baseline: 400, Change: -0.7, Samples: 100}, day.Flags[0])
			require.Len(t, result.Alerts, 1)
			assert.Equal(t, "gpt-6-sol", result.Alerts[0].Model)
			assert.Zero(t, result.MissingHour)
		})
	}
}

func TestBehaviorKeepsPromptSizesApart(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	// Short prompts answer in 50 tokens and long ones in 1000. Today the mix
	// moves to long prompts, so the all-request median jumps, but each band
	// answers as before.
	var rows []InsightBehaviorHour
	for day := range int64(7) {
		hour := behaviorDay0 + day*86400 + 3600
		rows = append(rows, behaviorRows(hour, "gpt-6-sol", 1, 80, 50, 5), behaviorRows(hour, "gpt-6-sol", 4, 20, 1000, 60))
	}
	today := behaviorDay0 + 7*86400 + 3600
	rows = append(rows, behaviorRows(today, "gpt-6-sol", 1, 20, 50, 5), behaviorRows(today, "gpt-6-sol", 4, 80, 1000, 60))
	storeBehaviorDays(t, rows, behaviorDay0, behaviorDay0+8*86400)

	result, err := GetModelBehavior(InsightsRange{Start: behaviorDay0 + 7*86400, End: behaviorDay0 + 8*86400}, nil)
	require.NoError(t, err)

	day := result.Models[0].Daily[0]
	assert.EqualValues(t, 1000, day.Output, "the headline median follows the mix")
	assert.Empty(t, day.Flags, "each band is compared with its own earlier days")
	assert.Empty(t, result.Alerts)
}

func TestBehaviorJudgesNothingBelowFiftySamples(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	var rows []InsightBehaviorHour
	for day := range int64(7) {
		rows = append(rows, behaviorRows(behaviorDay0+day*86400+3600, "gpt-6-sol", 2, 100, 400, 20))
	}
	rows = append(rows, behaviorRows(behaviorDay0+7*86400+3600, "gpt-6-sol", 2, 49, 40, 20))
	storeBehaviorDays(t, rows, behaviorDay0, behaviorDay0+8*86400)

	result, err := GetModelBehavior(InsightsRange{Start: behaviorDay0 + 7*86400, End: behaviorDay0 + 8*86400}, []string{"gpt-6-sol"})
	require.NoError(t, err)

	assert.Empty(t, result.Models[0].Daily[0].Flags)
}

func TestBehaviorFlagsAnUpstreamErrorRiseOnly(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	var rows []InsightBehaviorHour
	for day := range int64(7) {
		hour := behaviorDay0 + day*86400 + 3600
		rows = append(rows, behaviorRows(hour, "gpt-6-sol", 2, 100, 400, 20), InsightBehaviorHour{HourStart: hour, ModelName: "gpt-6-sol", Tries: 2, Statuses: `{"502":2}`})
	}
	// 100 requests and 8 failed tries: 7.4 % against 2 % before.
	rows = append(rows, behaviorRows(behaviorDay0+7*86400+3600, "gpt-6-sol", 2, 100, 400, 20), InsightBehaviorHour{HourStart: behaviorDay0 + 7*86400 + 3600, ModelName: "gpt-6-sol", Tries: 8, Statuses: `{"502":5,"529":3}`})
	storeBehaviorDays(t, rows, behaviorDay0, behaviorDay0+8*86400)

	result, err := GetModelBehavior(InsightsRange{Start: behaviorDay0 + 7*86400, End: behaviorDay0 + 8*86400}, nil)
	require.NoError(t, err)

	day := result.Models[0].Daily[0]
	require.Len(t, day.Flags, 1)
	assert.Equal(t, BehaviorMetricErrors, day.Flags[0].Metric)
	assert.Equal(t, "red", day.Flags[0].Level)
	assert.Equal(t, []NamedCount{{"502", 5}, {"529", 3}}, day.Statuses)
}

func TestBehaviorFlagIgnoresAFallInErrorsAndSmallGaps(t *testing.T) {
	// 0.5 % to 0.8 % is +60 % but 0.3 points: nothing to act on.
	today := &behaviorDayBucket{requests: 992, tries: 8}
	baseline := &behaviorDayBucket{requests: 7000 - 35, tries: 35}
	assert.Empty(t, behaviorFlags(today, baseline))
	// A fall in errors is never a flag.
	assert.Empty(t, behaviorFlags(&behaviorDayBucket{requests: 1000}, &behaviorDayBucket{requests: 900, tries: 100}))
}

func TestBehaviorFlagLevels(t *testing.T) {
	cases := []struct {
		value, level string
		change       float64
	}{
		{"just under yellow", "", 0.39},
		{"yellow rise", "yellow", 0.45},
		{"yellow fall", "yellow", -0.5},
		{"red rise", "red", 0.65},
		{"red fall", "red", -0.7},
	}
	for _, c := range cases {
		t.Run(c.value, func(t *testing.T) {
			flag, ok := behaviorFlag(BehaviorMetricOutput, 1, 100*(1+c.change), 100, 60, false)
			assert.Equal(t, c.level != "", ok)
			assert.Equal(t, c.level, flag.Level)
		})
	}
}

func TestBehaviorHourReadsRequestsFailuresAndReasoning(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	alice := registerAffiliateTestUser(t, "alice", "")
	logs := []Log{
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 100, UseTime: 4, ModelName: "gpt-6-sol", PromptTokens: 5000, CompletionTokens: 300, IsStream: true, Other: `{"frt":900,"cache_tokens":4000,"reasoning_tokens":200}`},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 200, UseTime: 6, ModelName: "gpt-6-sol", PromptTokens: 100, CompletionTokens: 50, Other: `{}`},
		{UserId: alice.Id, Type: LogTypeError, CreatedAt: behaviorDay0 + 300, ModelName: "gpt-6-sol", Content: "status_code=502, upstream failed", Other: `{}`},
		{UserId: alice.Id, Type: LogTypeError, CreatedAt: behaviorDay0 + 310, ModelName: "gpt-6-sol", Content: "status_code=400, invalid request", Other: `{}`},
		{UserId: alice.Id, Type: LogTypeError, CreatedAt: behaviorDay0 + 320, ModelName: "gpt-6-sol", Content: NoChannelErrorContent(503, "default"), Other: `{}`},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 330, UseTime: 3, ModelName: "gpt-image-2", PromptTokens: 10, CompletionTokens: 1, Other: `{}`},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 3600 + 5, UseTime: 3, ModelName: "gpt-6-sol", PromptTokens: 10, CompletionTokens: 1, Other: `{}`},
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	rows, err := computeBehaviorHour(behaviorDay0, map[int]bool{})
	require.NoError(t, err)

	byBand := map[int]InsightBehaviorHour{}
	for _, row := range rows {
		if row.ModelName == "gpt-6-sol" {
			byBand[row.Band] = row
		}
	}
	require.Len(t, rows, 4, "two bands, the failed tries of one model, and the hour's mark; the image model and the next hour are left out")
	assert.EqualValues(t, 1, byBand[behaviorBand(5000)].Requests)
	assert.EqualValues(t, 4000, byBand[behaviorBand(5000)].CacheRead)
	assert.Equal(t, histogram{200: 1}, decodeHistogram(byBand[behaviorBand(5000)].Reasoning))
	assert.Equal(t, histogram{900: 1}, decodeHistogram(byBand[behaviorBand(5000)].TTFT))
	assert.Empty(t, decodeHistogram(byBand[behaviorBand(100)].Reasoning), "a request with no reasoning tokens recorded is not a zero")
	assert.EqualValues(t, 1, byBand[0].Tries, "the 502 counts; the customer's 400 and the no-channel refusal do not")
	assert.JSONEq(t, `{"502":1}`, byBand[0].Statuses)
	assert.Contains(t, rows, InsightBehaviorHour{HourStart: behaviorDay0})
}

func TestBehaviorLeavesStaffOut(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 100, ModelName: "gpt-6-sol", PromptTokens: 10, CompletionTokens: 1, Other: `{}`}).Error)

	rows, err := computeBehaviorHour(behaviorDay0, map[int]bool{alice.Id: true})
	require.NoError(t, err)

	assert.Equal(t, []InsightBehaviorHour{{HourStart: behaviorDay0}}, rows)
}

func TestBehaviorCountsAFinalHourWithNoMarkAsMissing(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	storeBehaviorDays(t, nil, behaviorDay0, behaviorDay0+12*3600)

	result, err := GetModelBehavior(InsightsRange{Start: behaviorDay0 + 7*86400, End: behaviorDay0 + 7*86400 + 86400}, nil)
	require.NoError(t, err)

	assert.Equal(t, 24, result.MissingHour, "no hour of the range is stored")
	assert.Empty(t, result.Models)
}

func TestQualityVendorsReportTheirOwnCacheHitRate(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	r := InsightsRange{Start: behaviorDay0, End: behaviorDay0 + 86400}
	alice := registerAffiliateTestUser(t, "alice", "")
	logs := []Log{
		// OpenAI usage counts the cached 600 inside the prompt of 1000.
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 100, UseTime: 2, ModelName: "gpt-6-sol", PromptTokens: 1000, CompletionTokens: 10, Other: `{"cache_tokens":600}`},
		// Anthropic usage adds its cache to the prompt: 100 new, 700 read, 200 written.
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: behaviorDay0 + 200, UseTime: 2, ModelName: "claude-opus-5-5", PromptTokens: 100, CompletionTokens: 10, Other: `{"claude":true,"cache_tokens":700,"cache_creation_tokens":200}`},
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	quality, err := GetQualityInsights(r, []string{"claude-opus-5-5"})
	require.NoError(t, err)

	byVendor := map[string]VendorQuality{}
	for _, vendor := range quality.Vendors {
		byVendor[vendor.Vendor] = vendor
	}
	assert.Equal(t, VendorQuality{CacheRead: 600, CacheInput: 1000, CacheShare: 0.6}, cacheOnly(byVendor[ModelVendor("gpt-6-sol")]), "the GPT row has its own hit rate")
	assert.Equal(t, VendorQuality{CacheRead: 700, CacheInput: 1000, CacheShare: 0.7}, cacheOnly(byVendor[ModelVendor("claude-opus-5-5")]))
	assert.InDelta(t, 0.65, quality.AllModels.CacheShare, 1e-9, "the all-models figure still pools both")
}

func cacheOnly(v VendorQuality) VendorQuality {
	return VendorQuality{CacheRead: v.CacheRead, CacheInput: v.CacheInput, CacheShare: v.CacheShare}
}
