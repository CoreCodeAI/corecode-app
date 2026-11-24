package model

import (
	"fmt"
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
			logs := []Log{
				consume(alice, 1, at(2, 0), 8*dollar, `{"upstream_refusal":true,"upstream_refusal_category":"cyber"}`),
				consume(ops, 1, at(2, 5), 50*dollar, `{"upstream_refusal":true}`),
				consume(bob, 2, at(1, 0), 3*dollar, `{"stream_status":{"end_reason":"timeout"}}`),
				consume(bob, 2, at(1, 100), 5*dollar, `{"stream_status":{"end_reason":"done"}}`),
				consume(bob, 2, at(1, 200), 5*dollar, `{"stream_status":{"end_reason":"client_gone"}}`),
				consume(carol, 3, at(3, 0), 2*dollar, `{"admin_info":{"limited_plan_ip_gate":"wallet"}}`),
				// A refused request that also wrote a one-hour cache costs once, as a refusal.
				consume(alice, 1, at(2, 1), 4*dollar, `{"upstream_refusal":true,"upstream_refusal_category":"cyber","cache_creation_tokens_1h":1000000,"cache_creation_ratio":1.25,"cache_creation_ratio_1h":2,"model_ratio":2.5,"group_ratio":1}`),
				// Cache writes: alice's is never followed by a request of her key, bob's is.
				// The cache pass reads only the last day.
				consume(alice, 9, at(0, 20*3600), 6*dollar, write),
				consume(bob, 8, at(0, 10*3600), 6*dollar, write),
				consume(bob, 8, at(0, 10*3600-600), dollar, `{}`),
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
			}).Error)

			hour := func(u *User, when int64, quota int) QuotaData {
				return QuotaData{UserID: u.Id, Username: u.Username, ModelName: "claude-fable-5-1", CreatedAt: insightHourKey(when), Count: 2, Quota: quota * dollar, TokenUsed: 10}
			}
			require.NoError(t, DB.Create(&[]QuotaData{
				hour(alice, at(4, 0), 10), hour(alice, at(5, 0), 1),
				hour(bob, at(15, 0), 7), hour(bob, at(8, 0), 3), hour(bob, at(1, 0), 2),
				hour(carol, at(14, 0), 6), hour(ops, at(2, 0), 100),
			}).Error)

			insights, err := GetExperienceInsights(r)
			require.NoError(t, err)
			waste := insights.Waste

			assert.Equal(t, "day", insights.SeriesUnit)
			assert.Equal(t, r.Start, waste.LogStart)
			assert.Equal(t, end-86400, waste.CacheStart)
			assert.Equal(t, end-3600, waste.CacheJudgedUntil)
			assert.Equal(t, 29.0, waste.ConsumedUSD, "customers' consumption in the window, staff left out")
			assert.False(t, waste.Truncated)

			byKind := map[string]ExperienceKind{}
			for _, kind := range waste.Kinds {
				byKind[kind.Kind] = kind
			}
			assert.Equal(t, ExperienceKind{Kind: WasteRefusal, Requests: 2, Users: 1, USD: 12}, byKind[WasteRefusal], "a staff refusal is not counted, a refusal with a cache write counts once")
			assert.Equal(t, ExperienceKind{Kind: WasteFailedBilled, Requests: 1, Users: 1, USD: 3}, byKind[WasteFailedBilled], "done and client_gone are not failures")
			assert.Equal(t, ExperienceKind{Kind: WasteGateWallet, Requests: 1, Users: 1, USD: 2}, byKind[WasteGateWallet])
			assert.EqualValues(t, 1, byKind[WasteCache1h].Requests, "only the write nothing followed, inside the judged span")
			assert.InDelta(t, premiumUSD, byKind[WasteCache1h].USD, 1e-4)
			assert.EqualValues(t, 1, waste.Unpriced)
			assert.InDelta(t, 12+3+2+premiumUSD, waste.TotalUSD, 1e-3)
			assert.Equal(t, ExperienceKind{Kind: "refund", Requests: 1, Users: 1, USD: 4}, waste.Refunds, "a settlement delta is not a failed task")

			require.Len(t, waste.Refusals, 2)
			assert.Equal(t, "alice", waste.Refusals[0].Username)
			assert.Equal(t, 8.0, waste.Refusals[0].USD)
			assert.Equal(t, "cyber", waste.Refusals[0].Category)
			require.Len(t, waste.RefusalModels, 1)
			assert.EqualValues(t, 2, waste.RefusalModels[0].Requests)

			var refusalUSD, cacheUSD float64
			var refusals int64
			for _, point := range insights.Series {
				refusalUSD += point.RefusalUSD
				cacheUSD += point.CacheUSD
				refusals += point.Refusals
			}
			assert.Equal(t, 12.0, refusalUSD, "the daily series adds up to the totals")
			assert.EqualValues(t, 2, refusals)
			assert.InDelta(t, premiumUSD, cacheUSD, 1e-4)
			var cacheDay *ExperiencePoint
			for i := range insights.Series {
				if insights.Series[i].At == r.DayStart(at(0, 20*3600)) {
					cacheDay = &insights.Series[i]
				}
			}
			require.NotNil(t, cacheDay)
			assert.InDelta(t, premiumUSD, cacheDay.CacheUSD, 1e-4, "a write lands on the day it was made")

			require.Len(t, waste.Top, 3)
			assert.Equal(t, []string{"alice", "bob", "carol"}, []string{waste.Top[0].Username, waste.Top[1].Username, waste.Top[2].Username})
			assert.True(t, waste.Top[1].FiledFeedback)
			assert.False(t, waste.Top[0].FiledFeedback)
			assert.True(t, waste.Top[0].Silent, "alice's last request was four days ago")
			assert.False(t, waste.Top[1].Silent)
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
			assert.EqualValues(t, 1, feedback.Unanswered24h, "dave's report is ten hours old")
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

// A scan that runs out of its time budget keeps what it read and says where
// the figures begin, so a slow read of a long range answers instead of hanging.
func TestExperienceInsightsStopAtTheScanBudget(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	require.NoError(t, DB.AutoMigrate(&Feedback{}))
	t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Feedback{})) })
	dollar := int(common.QuotaPerUnit)
	const end = int64(1759190400) + 40*86400
	alice := registerAffiliateTestUser(t, "alice", "")
	refusal := `{"upstream_refusal":true}`
	require.NoError(t, DB.Create(&[]Log{
		{UserId: alice.Id, Username: "alice", CreatedAt: end - 600, Type: LogTypeConsume, ModelName: "m", Quota: 2 * dollar, Other: refusal},
		{UserId: alice.Id, Username: "alice", CreatedAt: end - 5*86400, Type: LogTypeConsume, ModelName: "m", Quota: 7 * dollar, Other: refusal},
	}).Error)

	insights, err := GetExperienceInsights(InsightsRange{Start: end - 10*86400, End: end})
	require.NoError(t, err)
	assert.Equal(t, end-10*86400, insights.Waste.LogStart, "within the budget the whole range is read")
	assert.Equal(t, 9.0, kindOf(insights.Waste, WasteRefusal).USD)

	old := experienceScanBudget
	experienceScanBudget = 0
	t.Cleanup(func() { experienceScanBudget = old })
	insights, err = GetExperienceInsights(InsightsRange{Start: end - 10*86400, End: end})
	require.NoError(t, err)
	assert.Equal(t, end-3600, insights.Waste.LogStart, "only the newest hour was read")
	assert.Equal(t, 2.0, kindOf(insights.Waste, WasteRefusal).USD)
	assert.False(t, insights.Waste.Truncated, "a spent budget is not the row bound")
}

func kindOf(waste ExperienceWaste, kind string) ExperienceKind {
	for _, item := range waste.Kinds {
		if item.Kind == kind {
			return item
		}
	}
	return ExperienceKind{Kind: kind}
}
