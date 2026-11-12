package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFirstPaidTimesCountsMoneyOnly(t *testing.T) {
	first := firstPaidTimes([]paidOrder{
		{UserId: 1, Money: 0, CreateTime: 5},
		{UserId: 1, Money: 10, CreateTime: 50},
		{UserId: 1, Money: 10, CreateTime: 20},
		{UserId: 2, Money: 5, CreateTime: 30},
		{UserId: 3, Money: 0, CreateTime: 40},
	})
	assert.Equal(t, map[int]int64{1: 20, 2: 30}, first, "a zero-money order is no payment; the earliest paid order is kept")
}

func TestFirstPaymentTimingBins(t *testing.T) {
	assert.Equal(t, PaymentTiming{}, firstPaymentTiming(nil))

	// Seven payers: whole days since sign-up are 0, 0, 1, 3, 4, 7 and 8.
	timing := firstPaymentTiming([]int64{604805, 0, 86400, 4 * 86400, 3*86400 + 1, 86399, 8 * 86400})
	assert.Equal(t, PaymentTiming{
		Payers: 7, MedianHours: 72, WithinDay: 0.2857, WithinWeek: 0.8571,
		SameDay: 2, Days1To3: 2, Days4To7: 2, Later: 1,
	}, timing)

	// An even count takes the mean of the two middle delays.
	even := firstPaymentTiming([]int64{86400, 3 * 86400})
	assert.Equal(t, 48.0, even.MedianHours)
}

func TestGrowthFirstPaymentAndStaff(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			// The range ends after the last payment, so every payer is in it.
			r := InsightsRange{Start: day1, End: day1 + 10*86400}
			plan := SubscriptionPlan{Title: "trial", PriceAmount: 9.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&plan).Error)
			signup := func(name string, createdAt int64) *User {
				user := registerAffiliateTestUser(t, name, "")
				require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("created_at", createdAt).Error)
				return user
			}
			pay := func(userID int, money float64, at int64, tradeNo string) {
				require.NoError(t, DB.Create(&TopUp{UserId: userID, Amount: int64(money), Money: money, PaymentMethod: "alipay",
					Status: common.TopUpStatusSuccess, TradeNo: tradeNo, CreateTime: at}).Error)
			}

			quick := signup("quick", day1+100)
			pay(quick.Id, 10, day1+100+3600, "T-quick")
			twoDays := signup("two-days", day1+200)
			pay(twoDays.Id, 10, day1+200+2*86400+3600, "T-two")
			fiveDays := signup("five-days", day1+300)
			pay(fiveDays.Id, 10, day1+300+5*86400, "T-five")
			// A plan bought with money counts as a payment.
			nineDays := signup("nine-days", day1+400)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: nineDays.Id, PlanId: plan.Id, Money: 9.9, TradeNo: "SUB-nine",
				Status: common.TopUpStatusSuccess, CreateTime: day1 + 400 + 9*86400}).Error)
			pay(nineDays.Id, 9.9, day1+400+9*86400, "SUB-nine")
			signup("unpaid", day1+500)
			// A top-up for no money is a credit, not a payment.
			zero := signup("zero-money", day1+600)
			pay(zero.Id, 0, day1+600+3600, "T-zero")
			// An administrator pays in the range: not a customer, so not a sign-up.
			ops := &User{Username: "ops", DisplayName: "ops", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, ops.Insert(0))
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops.Id).Update("created_at", day1+700).Error)
			pay(ops.Id, 10, day1+700+3600, "T-ops")

			growth, err := GetGrowthInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 6, growth.Funnel.Registered, "the administrator is not a sign-up")
			assert.Equal(t, PaymentTiming{
				Payers: 4, MedianHours: 84.5, WithinDay: 0.25, WithinWeek: 0.75,
				SameDay: 1, Days1To3: 1, Days4To7: 1, Later: 1,
			}, growth.FirstPayment)
		})
	}
}

func TestPayerActivityWindows(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const end = int64(1759248000) + 60*86400
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: end - 2*86400, End: end}
			earlierHour := insightHourKey(end - 20*86400)
			lastHour := insightHourKey(end - 86400)
			require.NoError(t, DB.Create(&[]InsightHour{
				{HourStart: earlierHour, Version: insightHourVersion, Data: `{}`},
				{HourStart: lastHour, Version: insightHourVersion, Data: `{}`},
			}).Error)

			big := registerAffiliateTestUser(t, "big", "")
			small := registerAffiliateTestUser(t, "small", "")
			active := registerAffiliateTestUser(t, "active", "")
			idle := registerAffiliateTestUser(t, "idle", "")
			ops := registerAffiliateTestUser(t, "ops", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops.Id).Update("role", common.RoleAdminUser).Error)
			// Never a payer: its earlier spend is not counted.
			spender := registerAffiliateTestUser(t, "spender", "")
			require.NoError(t, DB.Create(&[]InsightUserHour{
				{HourStart: earlierHour, UserId: big.Id, Requests: 3, Quota: 3 * dollar},
				{HourStart: earlierHour, UserId: small.Id, Requests: 2, Quota: 2 * dollar},
				{HourStart: earlierHour, UserId: active.Id, Requests: 1, Quota: dollar},
				{HourStart: lastHour, UserId: active.Id, Requests: 1, Quota: dollar},
				{HourStart: earlierHour, UserId: ops.Id, Requests: 5, Quota: 5 * dollar},
				{HourStart: earlierHour, UserId: spender.Id, Requests: 4, Quota: 4 * dollar},
				{HourStart: lastHour, UserId: idle.Id, Requests: 1, Quota: 0},
			}).Error)

			// Each payer paid forty days before the range's end. spender's first
			// payment is after the range's end, so spender is not a payer yet.
			paid := end - 40*86400
			activity, err := readPayerActivity(r, map[int]int64{big.Id: paid, small.Id: paid, active.Id: paid,
				idle.Id: paid, ops.Id: paid, spender.Id: end + 1})
			require.NoError(t, err)
			assert.Equal(t, PayerActivity{
				Payers: 4, Active: 1, Lapsed: 2,
				Top: []LapsedPayer{
					{UserRef: UserRef{UserID: big.Id, Username: "big"}, QuotaUSD: 3},
					{UserRef: UserRef{UserID: small.Id, Username: "small"}, QuotaUSD: 2},
				},
			}, activity, "the administrator is not a payer; a payer who paid after the range's end is not counted")
		})
	}
}

func TestRetentionReachesThirtyDays(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			// A UTC midnight, so that the days the cohorts are keyed by are whole.
			const day1 = int64(1759190400)
			dollar := int(common.QuotaPerUnit)
			alice := registerAffiliateTestUser(t, "alice", "")
			// Alice signed up on the first day the 30-day range reads cohorts from,
			// and used quota twenty days later.
			signedUp := day1 + 86400 + 100
			require.NoError(t, DB.Model(&User{}).Where("id = ?", alice.Id).Update("created_at", signedUp).Error)
			require.NoError(t, DB.Create(&QuotaData{UserID: alice.Id, Username: "alice", ModelName: "gpt-6",
				CreatedAt: signedUp + 20*86400, Count: 1, Quota: dollar, TokenUsed: 10}).Error)

			activity, err := GetActivityInsights(InsightsRange{Start: day1, End: day1 + 30*86400})
			require.NoError(t, err)
			var cohort *RetentionCohort
			for i := range activity.Retention {
				if activity.Retention[i].Day == day1+86400 {
					cohort = &activity.Retention[i]
				}
			}
			require.NotNil(t, cohort)
			assert.EqualValues(t, 1, cohort.Size)
			require.Len(t, cohort.Days, 29, "day 0 through day 28, the last day that has ended")
			assert.Equal(t, 1.0, cohort.Days[20])
			assert.Equal(t, 0.0, cohort.Days[19])
		})
	}
}

// A sign-up's first payment after the range's end is not part of the range's
// payment timing, as the payer activity view leaves it out.
func TestFirstPaymentTimingStopsAtTheRangeEnd(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	r := InsightsRange{Start: day1, End: day1 + 30*86400}
	late := registerAffiliateTestUser(t, "late", "")
	require.NoError(t, DB.Model(&User{}).Where("id = ?", late.Id).Update("created_at", day1+100).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: late.Id, Money: 10, Amount: 10, TradeNo: "T-late", PaymentMethod: "stripe",
		Status: common.TopUpStatusSuccess, CreateTime: r.End + 3600}).Error)

	growth, err := GetGrowthInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 0, growth.FirstPayment.Payers, "a payment after the range's end is not counted")
	assert.Zero(t, growth.FirstPayment.MedianHours)
}
