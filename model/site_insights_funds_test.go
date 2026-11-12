package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// quotaAdjustmentLog is a manual quota change of delta dollars for target,
// logged at at, which succeeded or not.
func quotaAdjustmentLog(id string, target UserRef, at int64, success bool, delta int64) AuditLog {
	return AuditLog{
		EventId: id, UserId: target.UserID, Username: "root", CreatedAt: at, Action: "user.quota_add", Success: success,
		Category: AuditCategoryOperation,
		Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{
			"target_user_id": target.UserID, "target_username": target.Username, "mode": "add",
			"requested_quota": delta, "from": int64(0), "to": delta,
		}}},
	}
}

// The funds view sums the adjustment net and counts the adjustments over the
// whole range; the list shows only the newest 500 of them.
func TestAdjustmentNetCoversTheWholeRange(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: 8 * 3600}
	alice := registerAffiliateTestUser(t, "alice", "")
	target := UserRef{UserID: alice.Id, Username: "alice"}

	// The oldest adjustment in the range failed: it is counted, not netted.
	// One before the range is in neither figure.
	logs := []AuditLog{quotaAdjustmentLog("adjust-before", target, day1-60, true, 100*dollar)}
	logs = append(logs, quotaAdjustmentLog("adjust-failed", target, day1+30, false, dollar))
	for i := range 510 {
		logs = append(logs, quotaAdjustmentLog(fmt.Sprintf("adjust-%d", i), target, day1+int64(i+1)*60, true, dollar))
	}
	require.NoError(t, LOG_DB.CreateInBatches(&logs, 100).Error)

	finance, err := GetFinanceInsights(r)
	require.NoError(t, err)
	assert.Equal(t, 510.0, finance.AdjustmentNetUSD, "every successful adjustment in the range, listed or not")
	assert.EqualValues(t, 511, finance.AdjustmentsTotal)
	assert.True(t, finance.AdjustmentsTruncated)
	require.Len(t, finance.Adjustments, 500)
	assert.Equal(t, day1+510*60, finance.Adjustments[0].CreatedAt, "the list keeps the newest")
}

// A range that fits the list is not cut, and the net is the same as the
// list's sum.
func TestAdjustmentListIsNotCutWhenItFits(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: 8 * 3600}
	alice := registerAffiliateTestUser(t, "alice", "")
	target := UserRef{UserID: alice.Id, Username: "alice"}
	logs := []AuditLog{
		quotaAdjustmentLog("small-1", target, day1+60, true, 3*dollar),
		quotaAdjustmentLog("small-2", target, day1+120, true, -dollar),
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	finance, err := GetFinanceInsights(r)
	require.NoError(t, err)
	assert.Equal(t, 2.0, finance.AdjustmentNetUSD)
	assert.EqualValues(t, 2, finance.AdjustmentsTotal)
	assert.False(t, finance.AdjustmentsTruncated)
	assert.Len(t, finance.Adjustments, 2)
}

// The wallet price reads the same adjustments as the net: a failed credit
// and one after the price's day do not count toward what the wallet was
// credited.
func TestWalletPriceCountsSuccessfulCreditsOnly(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, DB.Create(&TopUp{UserId: alice.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "P1", CreateTime: day1 - 3600}).Error)
	target := UserRef{UserID: alice.Id, Username: "alice"}
	logs := []AuditLog{
		quotaAdjustmentLog("given", target, day1+60, true, 5*dollar),
		quotaAdjustmentLog("failed", target, day1+120, false, 50*dollar),
		quotaAdjustmentLog("later", target, day1+86400+60, true, 500*dollar),
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)

	prices, err := readWalletPrices(day1 + 86400)
	require.NoError(t, err)
	// Ten dollars paid for ten dollars bought and five given: the price per
	// dollar of quota is 10 over 15.
	assert.InDelta(t, 10.0/15.0, prices[alice.Id].perQuota*float64(common.QuotaPerUnit), 1e-9)
}

// The runway's three figures are the paid use over the range, the paid
// plan quota left now, and the days the range covers. Staff's use and plans
// are left out of them.
func TestFundsRunwayUsesPaidMoneyOnBothSides(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	const week = 7 * 86400
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: 8 * 3600}
	payer := registerAffiliateTestUser(t, "payer", "")
	guest := registerAffiliateTestUser(t, "guest", "")
	root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, root.Insert(0))
	require.NoError(t, DB.Create(&TopUp{UserId: payer.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "R1", CreateTime: day1 - 3600}).Error)

	// The payer's $6 is paid credit; the guest had no paid credit, so the $4
	// is gifted; root's $30 is staff's.
	logs := []Log{
		{UserId: payer.Id, Username: "payer", Type: LogTypeConsume, CreatedAt: day1 + 100, ModelName: "opus", Quota: int(6 * dollar), Other: `{"billing_source":"wallet"}`},
		{UserId: guest.Id, Username: "guest", Type: LogTypeConsume, CreatedAt: day1 + 200, ModelName: "opus", Quota: int(4 * dollar), Other: `{"billing_source":"wallet"}`},
		{UserId: root.Id, Username: "root", Type: LogTypeConsume, CreatedAt: day1 + 300, ModelName: "opus", Quota: int(30 * dollar), Other: `{"billing_source":"wallet"}`},
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)
	// The payer's $20 plan has $15 left; root's $100 plan is staff's.
	plans := []UserSubscription{
		{UserId: payer.Id, PlanId: 1, AmountTotal: 20 * dollar, AmountUsed: 5 * dollar, StartTime: day1 - 100, EndTime: day1 + week, Status: "active", Source: "order"},
		{UserId: root.Id, PlanId: 1, AmountTotal: 100 * dollar, StartTime: day1 - 100, EndTime: day1 + week, Status: "active", Source: "order"},
	}
	require.NoError(t, DB.Create(&plans).Error)

	finance, err := financeInsightsAt(r, day1+3600)
	require.NoError(t, err)
	assert.Equal(t, 10.0, finance.ConsumptionUSD, "customers only")
	assert.Equal(t, 30.0, finance.RootConsumptionUSD, "staff's use is reported apart")
	assert.Equal(t, 4.0, finance.GiftConsumptionUSD)
	assert.Equal(t, 6.0, finance.PaidUseUSD)
	assert.Equal(t, 2.0, finance.RangeDays)
	assert.Equal(t, 3.0, finance.PaidUsePerDayUSD)
	assert.Equal(t, 15.0, finance.PaidPlanQuotaLeftUSD, "root's plan is staff's")
}

// A range whose hour was cut by the row cap says so; the funds view reads
// the same hours as the other views.
func TestFinanceSaysWhenAnHourWasCut(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	maxRows := insightHourMaxLogRows
	insightHourMaxLogRows = 3
	t.Cleanup(func() { insightHourMaxLogRows = maxRows })
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	for _, at := range []int64{10, 70, 130, 1800, 3000} {
		require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + at, ModelName: "opus", Other: `{}`}).Error)
	}

	finance, err := GetFinanceInsights(InsightsRange{Start: hour, End: hour + 3600})
	require.NoError(t, err)
	assert.True(t, finance.Truncated)
}

// At the task cap the newest tasks are kept, the outcome says it was cut, and
// the upstream key in private data is read only by a view that names models.
func TestTaskCapKeepsTheNewestAndSkipsKeys(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	maxRows := insightTaskMaxRows
	insightTaskMaxRows = 2
	t.Cleanup(func() { insightTaskMaxRows = maxRows })
	r := InsightsRange{Start: 100, End: 1000}
	for i, at := range []int64{200, 300, 400} {
		require.NoError(t, DB.Create(&Task{
			TaskID: fmt.Sprintf("task-%d", i), ChannelId: 7, Status: TaskStatusSuccess,
			SubmitTime: at, FinishTime: at + 60,
			PrivateData: TaskPrivateData{Key: "test-upstream-key", BillingContext: &TaskBillingContext{OriginModelName: "gpt-image-2"}},
		}).Error)
	}

	tasks, truncated, err := readInsightTasks(r, false)
	require.NoError(t, err)
	assert.True(t, truncated)
	require.Len(t, tasks, 2)
	assert.Equal(t, []int64{300, 400}, []int64{tasks[0].SubmitTime, tasks[1].SubmitTime}, "the newest are kept, earliest first")
	assert.Empty(t, tasks[0].PrivateData, "the upstream key is not read for a view that names no models")

	withModel, _, err := readInsightTasks(r, true)
	require.NoError(t, err)
	assert.Equal(t, "gpt-image-2", withModel[0].modelName())

	outcomes, err := GetTaskOutcomes(r)
	require.NoError(t, err)
	assert.True(t, outcomes.Truncated)
	assert.EqualValues(t, 2, outcomes.Total.Submitted)

	upstream, err := GetUpstreamInsights(r)
	require.NoError(t, err)
	assert.True(t, upstream.Truncated, "the upstream view says its task read was cut")
}
