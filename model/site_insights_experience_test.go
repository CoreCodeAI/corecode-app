package model

import (
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The experience view totals the money customers spent for nothing, from the
// logs a request leaves, and follows the reports they filed.
func TestExperienceInsightsCountWastedMoneyAndFollowReports(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			require.NoError(t, DB.AutoMigrate(&Feedback{}))
			t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Feedback{})) })
			dollar := int(common.QuotaPerUnit)
			const end = int64(1759190400) + 40*86400
			r := InsightsRange{Start: end - 20*86400, End: end}
			at := func(daysBack int, extraSeconds int64) int64 { return end - int64(daysBack)*86400 - extraSeconds }

			user := func(name string) *User { return registerAffiliateTestUser(t, name, "") }
			alice, bob, carol, dave := user("alice"), user("bob"), user("carol"), user("dave")
			ops := user("ops")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops.Id).Update("role", common.RoleAdminUser).Error)

			consume := func(u *User, token int, when int64, quota int, other string) Log {
				return Log{UserId: u.Id, Username: u.Username, TokenId: token, CreatedAt: when, Type: LogTypeConsume,
					ModelName: "claude-fable-5-1", Quota: quota, RequestId: fmt.Sprintf("req-%d-%d", u.Id, when), Other: other}
			}
			// One-hour writes of a million tokens at model ratio 2.5, group ratio 1, a
			// five-minute price of 1.25 and a one-hour price of 2: 0.75 × 2.5 × 1e6 quota.
			write := `{"cache_creation_tokens_1h":1000000,"cache_creation_ratio":1.25,"cache_creation_ratio_1h":2,"model_ratio":2.5,"group_ratio":1}`
			premiumUSD := float64(1_875_000) / float64(dollar)
			// A read of a million tokens under the one-hour default, ten minutes after
			// the key's last request: a five-minute entry would have been written again
			// at 1.25 instead of read at 0.1, (1.25 - 0.1) × 2.5 × 1e6 quota.
			read := `{"cache_tokens":1000000,"cache_ratio":0.1,"cache_creation_ratio":1.25,"model_ratio":2.5,"group_ratio":1,"admin_info":{"default_cache_ttl":"1h"}}`
			savedUSD := float64(2_875_000) / float64(dollar)
			// A tiered price at group ratio 2: a million one-hour tokens are past the
			// standard tier, where they cost 1 against 0.625 per million at five minutes.
			expr := base64.StdEncoding.EncodeToString([]byte(`len <= 100000 ? tier("standard", p*0.1 + c*0.5 + cr*0.01 + cc*0.125 + cc1h*0.2) : tier("long_context", p*0.5 + c*2.5 + cr*0.05 + cc*0.625 + cc1h*1)`))
			tiered := `{"billing_mode":"tiered_expr","expr_b64":"` + expr + `","group_ratio":2,"model_ratio":0,"cache_creation_tokens":1000000,"cache_creation_tokens_1h":1000000}`
			tieredPremiumUSD := 0.375 * 2
			withOutput := func(row Log, tokens int) Log {
				row.CompletionTokens = tokens
				return row
			}
			logs := []Log{
				// The earliest log: the fill starts at the hour of the first log.
				consume(dave, 7, r.Start, dollar, `{}`),
				consume(alice, 1, at(2, 0), 8*dollar, `{"upstream_refusal":true,"upstream_refusal_category":"cyber"}`),
				consume(ops, 1, at(2, 5), 50*dollar, `{"upstream_refusal":true}`),
				withOutput(consume(bob, 2, at(1, 0), 3*dollar, `{"stream_status":{"end_reason":"timeout"}}`), 50),
				consume(bob, 2, at(1, 100), 5*dollar, `{"stream_status":{"end_reason":"done"}}`),
				// The customer hung up: recorded as client_gone now, and as the read
				// the hang-up failed before the relay told the two apart.
				consume(bob, 2, at(1, 200), 5*dollar, `{"stream_status":{"end_reason":"client_gone","end_error":"context canceled"}}`),
				withOutput(consume(carol, 3, at(3, 100), dollar, `{"stream_status":{"end_reason":"scanner_error","end_error":"context canceled"}}`), 10),
				consume(carol, 3, at(3, 200), 3*dollar, `{"stream_status":{"end_reason":"scanner_error","end_error":"read tcp 10.0.0.1:1->10.0.0.2:443: read: connection reset by peer"}}`),
				consume(carol, 3, at(3, 0), 2*dollar, `{"admin_info":{"limited_plan_ip_gate":"wallet"}}`),
				// A refused request that also wrote a one-hour cache costs once, as a refusal.
				consume(alice, 1, at(2, 1), 4*dollar, `{"upstream_refusal":true,"upstream_refusal_category":"cyber","cache_creation_tokens_1h":1000000,"cache_creation_ratio":1.25,"cache_creation_ratio_1h":2,"model_ratio":2.5,"group_ratio":1}`),
				// Cache writes: alice's is never followed by a request of her key, bob's is.
				// The cache pass reads only the last day.
				consume(alice, 9, at(0, 20*3600), 6*dollar, write),
				consume(bob, 8, at(0, 10*3600), 6*dollar, write),
				consume(bob, 8, at(0, 10*3600-600), dollar, read),
				consume(dave, 5, at(0, 15*3600), dollar, tiered),
				consume(dave, 5, at(0, 15*3600-100), dollar, `{}`),
				// Too late to judge, and one with no ratios to price it.
				consume(alice, 9, 0+end-1800, 6*dollar, write),
				consume(carol, 4, at(0, 12*3600), 6*dollar, `{"cache_creation_tokens_1h":1000}`),
				{UserId: bob.Id, Username: bob.Username, CreatedAt: at(1, 3000), Type: LogTypeRefund, ModelName: "sora", Quota: 4 * dollar, Other: `{"is_task":true,"task_id":"t1","reason":"failed"}`},
				{UserId: bob.Id, Username: bob.Username, CreatedAt: at(1, 3100), Type: LogTypeRefund, ModelName: "sora", Quota: dollar, Other: `{"is_task":true,"task_id":"t2","pre_consumed_quota":900}`},
			}
			require.NoError(t, DB.Create(&logs).Error)

			feedbackAt := func(u *User, category string, when int64, repliedAfter int64, status string, reward int) Feedback {
				row := Feedback{UserId: u.Id, Category: category, Title: "title", Status: status, RewardQuota: reward, CreatedTime: when}
				if repliedAfter > 0 {
					row.RepliedTime = when + repliedAfter
				}
				return row
			}
			require.NoError(t, DB.Create(&[]Feedback{
				feedbackAt(bob, FeedbackCategoryBug, at(12, 0), 3600, FeedbackStatusResolved, dollar),
				feedbackAt(bob, FeedbackCategoryBilling, at(11, 0), 7200, FeedbackStatusProcessing, 0),
				feedbackAt(carol, FeedbackCategoryBilling, at(10, 0), 0, FeedbackStatusPending, 0),
				feedbackAt(dave, FeedbackCategorySuggestion, at(0, 36000), 0, FeedbackStatusPending, 0),
				feedbackAt(ops, FeedbackCategoryOther, at(5, 0), 0, FeedbackStatusPending, 0),
				// Closed before replied_time was recorded: it reads 0 there but waits for nothing.
				feedbackAt(carol, FeedbackCategoryBug, r.Start-86400, 0, FeedbackStatusResolved, 0),
			}).Error)

			hour := func(u *User, when int64, quota int) QuotaData {
				return QuotaData{UserID: u.Id, Username: u.Username, ModelName: "claude-fable-5-1", CreatedAt: insightHourKey(when), Count: 2, Quota: quota * dollar, TokenUsed: 10}
			}
			require.NoError(t, DB.Create(&[]QuotaData{
				hour(alice, at(4, 0), 10), hour(alice, at(5, 0), 1),
				hour(bob, at(15, 0), 7), hour(bob, at(8, 0), 3), hour(bob, at(1, 0), 2),
				hour(carol, at(14, 0), 6), hour(ops, at(2, 0), 100),
			}).Error)

			// Read as of the range's end: the last two hours are not final and are
			// worked out from the logs, the rest is stored by the fill.
			_, err := fillInsightExperience(end, 1<<30)
			require.NoError(t, err)
			insights, err := experienceInsightsAt(r, end)
			require.NoError(t, err)
			waste := insights.Waste

			assert.Equal(t, "day", insights.SeriesUnit)
			assert.Equal(t, r.Start, waste.LogStart)
			assert.Equal(t, r.Start, waste.CacheStart, "stored hours reach as far back as the logs do")
			assert.Equal(t, end-3600, waste.CacheJudgedUntil)
			assert.Equal(t, 29.0, waste.ConsumedUSD, "customers' consumption in the window, staff left out")
			assert.False(t, waste.Truncated)
			assert.Zero(t, waste.StaleHours)

			byKind := map[string]ExperienceKind{}
			for _, kind := range waste.Kinds {
				byKind[kind.Kind] = kind
			}
			assert.Equal(t, ExperienceKind{Kind: WasteRefusal, Requests: 2, Users: 1, USD: 12}, byKind[WasteRefusal], "a staff refusal is not counted, a refusal with a cache write counts once")
			assert.Equal(t, ExperienceKind{Kind: WasteFailedBilled, Requests: 2, Users: 2, USD: 6}, byKind[WasteFailedBilled], "done and a hang-up are not failures")
			assert.Equal(t, ExperienceKind{Kind: WasteGateWallet, Requests: 1, Users: 1, USD: 2}, byKind[WasteGateWallet])
			assert.Len(t, waste.Kinds, 3, "the one-hour cache is a trade, not a waste")
			assert.Equal(t, 20.0, waste.TotalUSD)
			assert.Equal(t, []ExperienceGroup{{Name: "reset", Requests: 1, Users: 1, USD: 3}, {Name: "timeout", Requests: 1, Users: 1, USD: 3}}, waste.FailedCauses)
			assert.EqualValues(t, 1, waste.FailedNoOutput, "the reset returned nothing, the timeout some output")
			assert.Equal(t, 3.0, waste.FailedNoOutputUSD)
			assert.Equal(t, ExperienceKind{Kind: ExperienceClientCancel, Requests: 2, Users: 2, USD: 6}, waste.Cancelled)
			assert.EqualValues(t, 1, waste.CancelledNoOutput)

			cache := waste.Cache
			assert.EqualValues(t, 4, cache.Writes, "every priced one-hour write, the one too late to judge too")
			assert.InDelta(t, 3*premiumUSD+tieredPremiumUSD, cache.PaidUSD, 1e-4, "a tiered write is priced by its expression")
			assert.EqualValues(t, 1, cache.UnreadWrites, "only the write nothing followed, inside the judged span")
			assert.InDelta(t, premiumUSD, cache.UnreadUSD, 1e-4)
			assert.EqualValues(t, 1, cache.Reads)
			assert.InDelta(t, savedUSD, cache.SavedUSD, 1e-4)
			assert.InDelta(t, savedUSD-3*premiumUSD-tieredPremiumUSD, cache.NetUSD, 1e-4)
			assert.EqualValues(t, 3, cache.Users)
			assert.EqualValues(t, 1, cache.Unpriced)
			assert.Equal(t, ExperienceKind{Kind: "refund", Requests: 1, Users: 1, USD: 4}, waste.Refunds, "a settlement delta is not a failed task")

			require.Len(t, waste.Refusals, 2)
			assert.Equal(t, "alice", waste.Refusals[0].Username)
			assert.Equal(t, 8.0, waste.Refusals[0].USD)
			assert.Equal(t, "cyber", waste.Refusals[0].Category)
			require.Len(t, waste.RefusalModels, 1)
			assert.EqualValues(t, 2, waste.RefusalModels[0].Requests)

			var refusalUSD, paidUSD, savedSeriesUSD, cancelUSD float64
			var refusals int64
			for _, point := range insights.Series {
				refusalUSD += point.RefusalUSD
				paidUSD += point.CachePaidUSD
				savedSeriesUSD += point.CacheSavedUSD
				cancelUSD += point.CancelUSD
				refusals += point.Refusals
			}
			assert.Equal(t, 12.0, refusalUSD, "the daily series adds up to the totals")
			assert.EqualValues(t, 2, refusals)
			assert.InDelta(t, cache.PaidUSD, paidUSD, 1e-4)
			assert.InDelta(t, savedUSD, savedSeriesUSD, 1e-4)
			assert.Equal(t, 6.0, cancelUSD)

			require.Len(t, waste.Top, 3)
			assert.Equal(t, []string{"alice", "carol", "bob"}, []string{waste.Top[0].Username, waste.Top[1].Username, waste.Top[2].Username})
			assert.Equal(t, 5.0, waste.Top[1].TotalUSD, "carol's reset and gate charge; her cancel is not waste")
			assert.True(t, waste.Top[2].FiledFeedback)
			assert.False(t, waste.Top[0].FiledFeedback)
			assert.True(t, waste.Top[0].Silent, "alice's last request was four days ago")
			assert.False(t, waste.Top[2].Silent)
			require.Len(t, waste.Silent, 1, "silent and never wrote: carol wrote, bob is active")
			assert.Equal(t, "alice", waste.Silent[0].Username)
			assert.EqualValues(t, 3, waste.CheckedTop)
			assert.EqualValues(t, 2, waste.ReportedTop)

			feedback := insights.Feedback
			assert.EqualValues(t, 4, feedback.Total, "staff reports are left out")
			assert.EqualValues(t, 2, feedback.Replied)
			assert.EqualValues(t, 3600, feedback.FirstReplyP50)
			assert.EqualValues(t, 7200, feedback.FirstReplyP90)
			assert.EqualValues(t, 3, feedback.Open, "pending and processing, staff left out")
			assert.EqualValues(t, 1, feedback.Unanswered24h, "dave's report is ten hours old, carol's old one is closed")
			require.Len(t, feedback.Waiting, 1)
			assert.Equal(t, "carol", feedback.Waiting[0].Username)
			assert.EqualValues(t, 1, feedback.Rewarded)
			assert.Equal(t, 1.0, feedback.RewardUSD)
			assert.EqualValues(t, 3, feedback.Senders)
			assert.EqualValues(t, 2, feedback.Judged, "dave's week is not over")
			assert.EqualValues(t, 1, feedback.Pending)
			assert.EqualValues(t, 1, feedback.Active, "bob spent in the week after his first report")
			assert.Equal(t, 13.0, feedback.BeforeUSD, "bob spent 7 and carol 6 in the week before")
			assert.Equal(t, 3.0, feedback.AfterUSD)
			require.Len(t, feedback.Lapsed, 1)
			assert.Equal(t, "carol", feedback.Lapsed[0].Username)
			assert.Equal(t, 6.0, feedback.Lapsed[0].BeforeUSD)
			assert.Equal(t, []NamedCount{{Name: FeedbackCategoryBilling, Count: 2}, {Name: FeedbackCategoryBug, Count: 1}, {Name: FeedbackCategorySuggestion, Count: 1}}, feedback.Categories)
		})
	}
}

// A range of up to three days reads by the hour, as the other views do.
func TestExperienceInsightsReadByTheHourOverADay(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	require.NoError(t, DB.AutoMigrate(&Feedback{}))
	t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Feedback{})) })
	const end = int64(1759190400) + 40*86400
	insights, err := GetExperienceInsights(InsightsRange{Start: end - 86400, End: end})
	require.NoError(t, err)
	assert.Equal(t, "hour", insights.SeriesUnit)
	assert.Len(t, insights.Series, 24)
	assert.Empty(t, insights.Waste.Top)
	assert.Empty(t, insights.Feedback.Waiting)
}

// Stored hours and the tail worked out live give the same answer, and an hour
// missing from the stored run moves the start of the figures forward.
func TestExperienceInsightsJoinStoredHoursAndTheLiveTail(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	require.NoError(t, DB.AutoMigrate(&Feedback{}))
	t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Feedback{})) })
	dollar := int(common.QuotaPerUnit)
	const end = int64(1759190400) + 40*86400
	r := InsightsRange{Start: end - 3*86400, End: end}
	alice := registerAffiliateTestUser(t, "alice", "")
	refusal := `{"upstream_refusal":true}`
	require.NoError(t, DB.Create(&[]Log{
		{UserId: alice.Id, Username: "alice", CreatedAt: r.Start, Type: LogTypeConsume, ModelName: "m", Quota: dollar, Other: `{}`},
		{UserId: alice.Id, Username: "alice", CreatedAt: end - 5000, Type: LogTypeConsume, ModelName: "m", Quota: 2 * dollar, Other: refusal},
		{UserId: alice.Id, Username: "alice", CreatedAt: end - 2*86400, Type: LogTypeConsume, ModelName: "m", Quota: 7 * dollar, Other: refusal},
	}).Error)

	// Nothing stored yet: only the tail is read, and the range starts there.
	insights, err := experienceInsightsAt(r, end)
	require.NoError(t, err)
	assert.Equal(t, end-7200, insights.Waste.LogStart)
	assert.Equal(t, 2.0, kindOf(insights.Waste, WasteRefusal).USD)

	stored, err := fillInsightExperience(end, 1<<30)
	require.NoError(t, err)
	assert.EqualValues(t, 3*24-2, stored, "three days of hours, less the two not final")
	insights, err = experienceInsightsAt(r, end)
	require.NoError(t, err)
	assert.Equal(t, r.Start, insights.Waste.LogStart)
	assert.Equal(t, 9.0, kindOf(insights.Waste, WasteRefusal).USD, "the stored day and the live tail add up")
	assert.EqualValues(t, 2, kindOf(insights.Waste, WasteRefusal).Requests)

	// Everything stored, read well after the end: the same figures.
	_, err = fillInsightExperience(end+3*3600, 1<<30)
	require.NoError(t, err)
	later, err := experienceInsightsAt(r, end+3*3600)
	require.NoError(t, err)
	assert.Equal(t, insights.Waste.Kinds, later.Waste.Kinds)
	assert.Equal(t, insights.Waste.Refusals, later.Waste.Refusals)

	// A stored hour that is missing stops the run: the figures begin after it.
	gap := end - 2*86400 + 3600
	require.NoError(t, DB.Where("hour_start = ?", gap).Delete(&InsightExperienceHour{}).Error)
	cut, err := experienceInsightsAt(r, end+3*3600)
	require.NoError(t, err)
	assert.Equal(t, gap+3600, cut.Waste.LogStart)
	assert.Equal(t, 2.0, kindOf(cut.Waste, WasteRefusal).USD, "the day before the gap is not read")
	assert.False(t, cut.Waste.Truncated)

	// A filled hour is not read again.
	again, err := fillInsightExperience(end+3*3600, 1<<30)
	require.NoError(t, err)
	assert.EqualValues(t, 1, again, "only the missing hour")
}

// An hour stored under an older version is served and counted stale until
// the fill stores it again.
func TestExperienceHoursStoredUnderAnOlderVersionAreRebuilt(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	require.NoError(t, DB.AutoMigrate(&Feedback{}))
	t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Feedback{})) })
	dollar := int(common.QuotaPerUnit)
	const end = int64(1759190400) + 40*86400
	r := InsightsRange{Start: end - 86400, End: end}
	alice := registerAffiliateTestUser(t, "alice", "")
	reset := `{"stream_status":{"end_reason":"scanner_error","end_error":"read: connection reset by peer"}}`
	require.NoError(t, DB.Create(&[]Log{
		{UserId: alice.Id, Username: "alice", CreatedAt: r.Start, Type: LogTypeConsume, ModelName: "m", Quota: dollar, Other: `{}`},
		{UserId: alice.Id, Username: "alice", CreatedAt: r.Start + 7200, Type: LogTypeConsume, ModelName: "m", Quota: 2 * dollar, Other: reset},
	}).Error)
	_, err := fillInsightExperience(end, 1<<30)
	require.NoError(t, err)
	// The hour as the first version stored it: a marker with no version and an
	// event with no cause.
	old := insightHourKey(r.Start + 7200)
	require.NoError(t, DB.Where("hour_start = ?", old).Delete(&InsightExperienceHour{}).Error)
	require.NoError(t, DB.Create(&[]InsightExperienceHour{
		{HourStart: old},
		{HourStart: old, LogId: 99, UserId: alice.Id, EventAt: r.Start + 7200, Kind: WasteFailedBilled, Usd: 2},
	}).Error)

	insights, err := experienceInsightsAt(r, end)
	require.NoError(t, err)
	assert.Equal(t, 1, insights.Waste.StaleHours)
	assert.Equal(t, []ExperienceGroup{{Name: "unknown", Requests: 1, Users: 1, USD: 2}}, insights.Waste.FailedCauses)

	again, err := fillInsightExperience(end, 1<<30)
	require.NoError(t, err)
	assert.EqualValues(t, 1, again, "only the stale hour")
	insights, err = experienceInsightsAt(r, end)
	require.NoError(t, err)
	assert.Zero(t, insights.Waste.StaleHours)
	assert.Equal(t, []ExperienceGroup{{Name: "reset", Requests: 1, Users: 1, USD: 2}}, insights.Waste.FailedCauses)
}

// A text longer than its column is cut, so one odd refusal category cannot
// keep an hour from being stored.
func TestExperienceClipCutsToTheColumn(t *testing.T) {
	long := strings.Repeat("é", 100)
	assert.Equal(t, strings.Repeat("é", 64), experienceClip(long, 64))
	assert.Equal(t, "cyber", experienceClip("cyber", 64))
}

func kindOf(waste ExperienceWaste, kind string) ExperienceKind {
	for _, item := range waste.Kinds {
		if item.Kind == kind {
			return item
		}
	}
	return ExperienceKind{Kind: kind}
}
