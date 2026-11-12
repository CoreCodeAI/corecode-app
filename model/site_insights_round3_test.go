package model

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// Staff (administrators and root) are left out of every customer figure of
// the quality view, which counts them apart, and the quality and capacity
// views agree on the customers' requests and failures.
func TestQualityCountsCustomersAndStaffApart(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour = int64(1759248000)
			alice := registerAffiliateTestUser(t, "alice", "")
			ops := &User{Username: "ops", DisplayName: "ops", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, ops.Insert(0))
			upstream := `{"error_type":"openai_error"}`
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 10, UseTime: 5, ChannelId: 7, ModelName: "gpt-6", Other: `{}`},
				{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 20, UseTime: 1, ChannelId: 7, ModelName: "gpt-6",
					Content: "status_code=502, bad gateway", Other: upstream},
				{UserId: ops.Id, Type: LogTypeConsume, CreatedAt: hour + 30, UseTime: 5, ChannelId: 7, ModelName: "gpt-6", Other: `{}`},
				{UserId: ops.Id, Type: LogTypeError, CreatedAt: hour + 40, UseTime: 1, ChannelId: 7, ModelName: "claude-opus-5",
					Content: "status_code=429, Upstream rate limit exceeded.", Other: upstream},
			}).Error)

			r := InsightsRange{Start: hour, End: hour + 3600}
			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			assert.Equal(t, [4]int64{2, 1, 2, 1}, [4]int64{quality.Requests, quality.Errors, quality.StaffRequests, quality.StaffErrors},
				"the customer headline, and staff apart")
			assert.InDelta(t, float64(quality.Errors), sumOf(quality.ErrorCategories, func(c NamedCount) float64 { return float64(c.Count) }), 0,
				"the error categories add up to the customers' failures")
			assert.Equal(t, []NamedCount{{"upstream_error", 1}}, quality.ErrorCategories)
			assert.EqualValues(t, 1, quality.FailedTries)
			assert.Equal(t, []NamedCount{{"502", 1}}, quality.StatusCodes)
			assert.Equal(t, []NamedCount{{"bad gateway", 1}}, quality.ErrorReasons)
			require.Len(t, quality.Hourly, 1)
			assert.Equal(t, QualityHour{Hour: hour, Requests: 2, Errors: 1, ErrorRate: 0.5, TTFTP50: 0, TTFTP95: 0}, quality.Hourly[0])

			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.Equal(t, [2]int64{quality.Requests, quality.Errors}, [2]int64{capacity.Requests, capacity.Errors},
				"the capacity view agrees with the quality headline")

			claudeOnly, err := GetQualityInsights(r, []string{"claude-opus-5"})
			require.NoError(t, err)
			assert.Equal(t, [4]int64{0, 0, 1, 1}, [4]int64{claudeOnly.Requests, claudeOnly.Errors, claudeOnly.StaffRequests, claudeOnly.StaffErrors},
				"the staff figures follow the model filter")
		})
	}
}

// The failure reasons keep the subject of a failure: a model name with dots
// and a field path survive, the sentence is cut at its end, and the text is
// capped with an ellipsis.
func TestErrorReasonKeepsTheSubject(t *testing.T) {
	long := strings.Repeat("word ", 40)
	cjk := strings.Repeat("渠道", 100)
	for content, want := range map[string]string{
		`status_code=400, Model "gpt-image-2.5" is not supported. Try again.`:                                           `Model "gpt-image-2.5" is not supported`,
		"status_code=400, Unsupported value: 'none' is not supported with the 'gpt-6.1-sol' model":                      "Unsupported value: 'none' is not supported with the 'gpt-6.1-sol' model",
		"status_code=400, Claude upstream request failed with status 400: messages.3.content.parts[0] is invalid\nmore": "Claude upstream request failed with status 400: messages.<n>.content.parts[<n>] is invalid",
		"status_code=502, upstream req_3f9a8b7c6d5e4f3a2b1c failed. Retry.":                                             "upstream <id> failed",
		"status_code=400, prompt is 201234 tokens, limit 200000":                                                        "prompt is <n> tokens, limit <n>",
		"status_code=503, upstream claude-sonnet-4-5-20250929 unavailable":                                              "upstream claude-sonnet-4-5-20250929 unavailable",
		"no_channel: no available channel in group vip":                                                                 "no_channel: no available channel in group vip",
		"status_code=500, the last clause ends the text.":                                                               "the last clause ends the text",
		"status_code=400, " + cjk: strings.Repeat("渠道", 59) + "渠…",
	} {
		assert.Equal(t, want, errorReason(content), content)
	}
	assert.Equal(t, strings.Repeat("word ", 23)+"word…", errorReason("status_code=400, "+long))
	assert.Equal(t, 120, len([]rune(errorReason("status_code=400, "+long))))
	assert.Equal(t, 120, len([]rune(errorReason("status_code=400, "+cjk))))
}

// Attempts whose reasons differ only in an id, a count or a per-request
// number are one reason, so an hour's reasons do not grow with its traffic.
func TestInsightHourReasonsStayBounded(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	var logs []Log
	for i := range 50 {
		logs = append(logs, Log{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + int64(i), ChannelId: 7, ModelName: "gpt-6",
			RequestId: fmt.Sprintf("r%d", i), Content: fmt.Sprintf("status_code=400, request req_%024d has %d tokens. Shorten it.", i, 100000+i), Other: `{"error_type":"openai_error"}`})
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.Equal(t, map[string]int64{"request <id> has <n> tokens": 50}, got.summary.ErrorReasons)
	require.Contains(t, got.summary.VendorFailures, VendorCodex)
	assert.EqualValues(t, 50, got.summary.VendorFailures[VendorCodex].Tries)
}

// The per-vendor reasons and status codes keep the top entries of an hour,
// and the rest is counted apart, so each vendor's entries and rest add up to
// its failed tries. Staff's failed tries are not in them.
func TestInsightHourVendorFailuresAddUp(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	ops := &User{Username: "ops", DisplayName: "ops", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
	require.NoError(t, ops.Insert(0))
	var logs []Log
	for i := range insightHourTopN + 5 {
		logs = append(logs, Log{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + int64(i), ChannelId: 7, ModelName: "claude-opus-5",
			Content: fmt.Sprintf("status_code=400, Claude upstream rejected field f%d", i), Other: `{"error_type":"openai_error"}`})
	}
	for i := range 3 {
		logs = append(logs, Log{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 500 + int64(i), ChannelId: 9, ModelName: "wan-3.0-480p",
			Content: fmt.Sprintf("status_code=500, video task %d failed", 1234567+i), Other: `{"error_type":"upstream_error"}`})
	}
	logs = append(logs, Log{UserId: ops.Id, Type: LogTypeError, CreatedAt: hour + 900, ChannelId: 9, ModelName: "wan-3.0-480p",
		Content: "status_code=500, video task 7 failed", Other: `{"error_type":"upstream_error"}`})
	require.NoError(t, LOG_DB.Create(&logs).Error)

	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)

	claude := got.summary.VendorFailures[VendorClaude]
	require.NotNil(t, claude)
	assert.EqualValues(t, insightHourTopN+5, claude.Tries)
	assert.Len(t, claude.Reasons, insightHourTopN)
	assert.EqualValues(t, 5, claude.ReasonsOther)
	assert.Equal(t, map[string]int64{"400": insightHourTopN + 5}, claude.StatusCodes)
	assert.EqualValues(t, 0, claude.StatusOther)

	media := got.summary.VendorFailures[VendorMedia]
	require.NotNil(t, media)
	assert.Equal(t, &vendorFailures{Tries: 3, Reasons: map[string]int64{"video task <n> failed": 3}, StatusCodes: map[string]int64{"500": 3}}, media,
		"the staff try is not counted, and the task numbers are one reason")

	r := InsightsRange{Start: hour, End: hour + 3600}
	quality, err := GetQualityInsights(r, nil)
	require.NoError(t, err)
	assert.EqualValues(t, insightHourTopN+8, quality.FailedTries)
	assert.InDelta(t, float64(quality.FailedTries), sumOf(quality.StatusCodes, func(c NamedCount) float64 { return float64(c.Count) }), 0)
	require.Len(t, quality.VendorFailures, 2)
	byVendor := map[string]VendorFailureBreakdown{}
	for _, breakdown := range quality.VendorFailures {
		byVendor[breakdown.Vendor] = breakdown
		var listed int64
		for _, reason := range breakdown.Reasons {
			listed += reason.Count
		}
		assert.Equal(t, breakdown.FailedTries, listed+breakdown.OtherReasons, breakdown.Vendor+": reasons add up to the tries")
	}
	assert.Equal(t, VendorFailureBreakdown{
		Vendor: VendorClaude, FailedTries: insightHourTopN + 5, Reasons: sortedCounts(claude.Reasons)[:qualityVendorTopN],
		OtherReasons: insightHourTopN + 5 - int64(qualityVendorTopN), StatusCodes: []NamedCount{{"400", insightHourTopN + 5}},
	}, byVendor[VendorClaude])
	assert.Equal(t, VendorFailureBreakdown{
		Vendor: VendorMedia, FailedTries: 3, Reasons: []NamedCount{{"video task <n> failed", 3}}, StatusCodes: []NamedCount{{"500", 3}},
	}, byVendor[VendorMedia])
	assert.Equal(t, VendorClaude, quality.VendorFailures[0].Vendor, "the most failing vendor first")
}

// An error log of a request no channel could take is no_channel whichever
// message the retry path or the distributor produced, in any locale.
func TestNoChannelMessagesClassifyAsNoChannel(t *testing.T) {
	for content, want := range map[string]string{
		"status_code=503, No available channel for model gpt-6-luna under group auto (retry)":                                                                                      ErrorNoChannel,
		"status_code=503, 分组 auto 下模型 gpt-6-luna 的可用渠道不存在（retry）":                                                                                                                  ErrorNoChannel,
		"status_code=503, 分組 auto 下模型 gpt-6-luna 的可用管道不存在（retry）":                                                                                                                  ErrorNoChannel,
		"status_code=503, No available channel for model gpt-6 under group vip (distributor)":                                                                                      ErrorNoChannel,
		"status_code=503, 分组 vip 下模型 gpt-6 无可用渠道（distributor）":                                                                                                                     ErrorNoChannel,
		"status_code=503, No available channel for model task-model under group vip: the model is claimed by a task plugin, which has no enabled channel serving it (distributor)": ErrorNoChannel,
		"status_code=503, Failed to get available channel for model gpt-6 under group auto (retry): boom":                                                                          ErrorUpstream,
		"status_code=503, No available channel for model gpt-6 under group auto":                                                                                                   ErrorUpstream,
	} {
		assert.Equal(t, want, classifyErrorLog(content), content)
	}
}

// The no-channel texts are the locale files' templates for the keys the
// retry path and the distributor produce.
func TestNoChannelTemplatesMatchTheLocales(t *testing.T) {
	keys := []string{"relay.retry_no_available_channel", "distributor.no_available_channel", "distributor.no_available_channel_task_plugin"}
	known := map[string]bool{}
	for _, parts := range noChannelTemplates {
		known[strings.Join(parts, "\x00")] = true
	}
	for _, file := range []string{"en.yaml", "zh-CN.yaml", "zh-TW.yaml"} {
		data, err := os.ReadFile(filepath.Join("..", "i18n", "locales", file))
		require.NoError(t, err)
		var messages map[string]string
		require.NoError(t, yaml.Unmarshal(data, &messages))
		for _, key := range keys {
			template := messages[key]
			require.NotEmpty(t, template, file+" "+key)
			text := strings.NewReplacer("{{.Group}}", "\x00", "{{.Model}}", "\x00").Replace(template)
			assert.True(t, known[text], file+" "+key+" is not in noChannelTemplates")
		}
	}
}

// A stored hour of an older version has no vendor failures or staff figures.
// A range mixing it with a current hour counts the current hour's vendor
// failures only, and still reads its site-wide reasons.
func TestQualityToleratesAnOlderRollupRow(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 3600 + 10, ChannelId: 7, ModelName: "claude-opus-5",
			Content: "status_code=429, Upstream rate limit exceeded.", Other: `{"error_type":"openai_error"}`},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 3600 + 20, UseTime: 3, ChannelId: 7, ModelName: "claude-opus-5", Other: `{}`},
	}).Error)
	// The older row: the figures it has, none of the newer summary fields.
	older := `{"requests":4,"errors":1,"attempts":5,"attempt_errors":1,"categories":{"upstream_error":1},"status_codes":{"500":1},"error_reasons":{"upstream failed":1}}`
	require.NoError(t, DB.Create(&InsightHour{HourStart: hour, Version: insightHourVersion - 1, Data: older, CreatedAt: 1}).Error)
	require.NoError(t, DB.Create(&InsightModelHour{HourStart: hour, ModelName: "claude-opus-5", Requests: 4, Errors: 1}).Error)

	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	current, err := computeInsightHour(hour+3600, scope)
	require.NoError(t, err)
	require.NoError(t, storeInsightHour(current))

	r := InsightsRange{Start: hour, End: hour + 2*3600}
	quality, err := GetQualityInsights(r, nil)
	require.NoError(t, err)
	assert.Equal(t, 1, quality.StaleHours)
	assert.EqualValues(t, 1, quality.FailedTries, "the current hour's try only")
	require.Len(t, quality.VendorFailures, 1)
	assert.Equal(t, VendorClaude, quality.VendorFailures[0].Vendor)
	assert.Equal(t, []NamedCount{{"429", 1}, {"500", 1}}, quality.StatusCodes, "site-wide counts read both hours")
	assert.EqualValues(t, 6, quality.Requests, "the older row's model figures and the current hour's")
	assert.EqualValues(t, 2, quality.Errors)
	assert.Nil(t, quality.Attempts, "absent while an hour is stale, as before")
	assert.EqualValues(t, 0, quality.StaffRequests)

	capacity, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.Equal(t, 1, capacity.StaleHours)
	assert.EqualValues(t, 2, capacity.Errors)
}

// An administrator is staff like root: the activity view counts them neither
// as active users nor among the top users, and their use is RootQuotaUSD.
func TestActivityLeavesAdministratorsOut(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int(common.QuotaPerUnit)
	alice := registerAffiliateTestUser(t, "alice", "")
	ops := &User{Username: "ops", DisplayName: "ops", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
	require.NoError(t, ops.Insert(0))
	require.NoError(t, DB.Create(&[]QuotaData{
		{UserID: alice.Id, Username: "alice", ModelName: "gpt-6", CreatedAt: day1, Count: 1, Quota: dollar, TokenUsed: 10},
		{UserID: ops.Id, Username: "ops", ModelName: "gpt-6", CreatedAt: day1, Count: 4, Quota: 3 * dollar, TokenUsed: 40},
	}).Error)

	activity, err := GetActivityInsights(InsightsRange{Start: day1, End: day1 + 86400, Offset: 8 * 3600})
	require.NoError(t, err)
	assert.EqualValues(t, 1, activity.ActiveUsers)
	assert.EqualValues(t, 1, activity.Requests)
	assert.Equal(t, 3.0, activity.RootQuotaUSD)
	require.Len(t, activity.TopUsers, 1)
	assert.Equal(t, alice.Id, activity.TopUsers[0].UserID)
}

// The failed tries of a range split into the reasons listed and the rest, so
// the reasons and their remainder add up to FailedTries, whatever the number
// of distinct reasons an hour and a range hold.
func TestErrorReasonsAddUpToFailedTries(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	var logs []Log
	for i := range insightHourTopN + 5 {
		logs = append(logs, Log{UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + int64(i), ChannelId: 7, ModelName: "gpt-6",
			Content: fmt.Sprintf("status_code=400, cause %s failed", strings.Repeat("x", i+1)), Other: `{"error_type":"openai_error"}`})
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.Len(t, got.summary.ErrorReasons, insightHourTopN)
	assert.EqualValues(t, 5, got.summary.ErrorReasonsOther)

	quality, err := GetQualityInsights(InsightsRange{Start: hour, End: hour + 3600}, nil)
	require.NoError(t, err)
	assert.Len(t, quality.ErrorReasons, 15)
	assert.EqualValues(t, insightHourTopN+5, quality.FailedTries)
	listed := sumOf(quality.ErrorReasons, func(c NamedCount) float64 { return float64(c.Count) })
	assert.InDelta(t, float64(quality.FailedTries), listed+float64(quality.ErrorReasonsOther), 0)
}
