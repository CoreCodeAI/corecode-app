package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGrowthTopupsSumPaidOrdersByDayWithoutStaff(t *testing.T) {
	const day1 = int64(1759190400)
	r := InsightsRange{Start: day1, End: day1 + 3*86400}
	orders := []paidOrder{
		{UserId: 1, Money: 10, CreateTime: day1 + 100},
		{UserId: 1, Money: 5.5, CreateTime: day1 + 200, Subscription: true},
		{UserId: 2, Money: 20, CreateTime: day1 + 300},
		{UserId: 3, Money: 99, CreateTime: day1 + 400},         // staff
		{UserId: 1, Money: 0, CreateTime: day1 + 500},          // a credit, not a payment
		{UserId: 2, Money: 7, CreateTime: day1 + 2*86400 + 10}, // the third day
		{UserId: 2, Money: 7, CreateTime: day1 - 10},           // before the range
		{UserId: 2, Money: 7, CreateTime: day1 + 3*86400},      // at the range's end
	}
	days := growthTopups(r, orders, []int{3})
	require.Len(t, days, 3, "every day of the range is listed, the quiet second day as zero")
	assert.Equal(t, GrowthTopupDay{Day: day1, Money: 35.5, PlanMoney: 5.5, Payers: 2}, days[0])
	assert.Equal(t, GrowthTopupDay{Day: day1 + 86400}, days[1])
	assert.Equal(t, GrowthTopupDay{Day: day1 + 2*86400, Money: 7, Payers: 1}, days[2])
}

func TestSilentPayersBucketByDaysSinceTheLastCharge(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const now = int64(1759190400) + 90*86400
			r := InsightsRange{Start: now - 7*86400, End: now}
			paid := now - 80*86400
			user := func(name string, requests int, accessed ...int64) int {
				u := registerAffiliateTestUser(t, name, "")
				require.NoError(t, DB.Model(&User{}).Where("id = ?", u.Id).Update("request_count", requests).Error)
				for i, at := range accessed {
					require.NoError(t, DB.Create(&Token{UserId: u.Id, Key: name + string(rune('a'+i)), Name: name, AccessedTime: at, Status: 1}).Error)
				}
				return u.Id
			}
			today := user("today", 5, now-3600)
			// The newest of the two keys decides.
			recent := user("recent", 5, now-40*86400, now-2*86400)
			week := user("week", 5, now-5*86400)
			month := user("month", 5, now-20*86400)
			old := user("old", 5, now-70*86400)
			// Requests, but every key deleted: silent for a long time.
			gone := user("gone", 5)
			never := user("never", 0, now-80*86400)
			late := user("late", 5, now-3600)
			ops := user("ops", 5, now-3600)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops).Update("role", common.RoleAdminUser).Error)

			silent, err := readSilentPayers(r, map[int]int64{
				today: paid, recent: paid, week: paid, month: paid, old: paid, gone: paid, never: paid, ops: paid,
				late: now + 1, // paid after the range's end: not a payer yet
			}, now)
			require.NoError(t, err)
			assert.EqualValues(t, 7, silent.Payers, "staff and a payer after the range's end are left out")
			counts := make(map[string]int64)
			for _, bucket := range silent.Buckets {
				counts[bucket.Name] = bucket.Count
			}
			assert.Equal(t, map[string]int64{
				SilentWithinDay: 1, SilentDays1To3: 1, SilentDays4To7: 1, SilentDays8To14: 0,
				SilentDays15To30: 1, SilentDays31To60: 0, SilentOver60: 2, SilentNever: 1,
			}, counts)
			names := make([]string, 0, len(silent.Buckets))
			for _, bucket := range silent.Buckets {
				names = append(names, bucket.Name)
			}
			assert.Equal(t, silentBuckets, names, "every bucket is listed in order, empty ones included")
		})
	}
}

// Sign-ups are followed week by week from Monday. alice signed up in a week the
// range began inside; bob in the next, whole week; both weeks and the current
// one are counted for each, once per user however many days they were active.
func TestRetentionWeeksFollowSignupWeeks(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			// A Tuesday midnight UTC; its Monday is the day before.
			const day1 = int64(1759190400)
			const monday = day1 - 86400
			dollar := int(common.QuotaPerUnit)
			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", alice.Id).Updates(map[string]any{"created_at": day1 + 100, "request_count": 4}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", bob.Id).Updates(map[string]any{"created_at": day1 + 7*86400 + 100, "request_count": 1}).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: bob.Id, Money: 10, Amount: 10, TradeNo: "T-bob", PaymentMethod: "stripe",
				Status: common.TopUpStatusSuccess, CreateTime: day1 + 7*86400 + 200}).Error)
			row := func(id int, name string, at int64) QuotaData {
				return QuotaData{UserID: id, Username: name, ModelName: "gpt-6", CreatedAt: at, Count: 1, Quota: dollar, TokenUsed: 10}
			}
			require.NoError(t, DB.Create(&[]QuotaData{
				// alice: two days in her sign-up week, none in the next, one in the current week.
				row(alice.Id, "alice", day1+200), row(alice.Id, "alice", day1+86400+200),
				row(alice.Id, "alice", day1+14*86400+10),
				// bob: his sign-up week only.
				row(bob.Id, "bob", day1+7*86400+300),
			}).Error)

			r := InsightsRange{Start: day1, End: day1 + 16*86400}
			activity, err := GetActivityInsights(r)
			require.NoError(t, err)
			require.Len(t, activity.RetentionWeeks, 2, "the weeks with sign-ups, newest first")
			bobWeek, aliceWeek := activity.RetentionWeeks[0], activity.RetentionWeeks[1]

			assert.Equal(t, monday+7*86400, bobWeek.Week)
			assert.False(t, bobWeek.Partial, "a whole week inside the range")
			assert.EqualValues(t, 1, bobWeek.Size)
			assert.Equal(t, []int64{1, 0}, bobWeek.Active, "bob is active in his own week, not in the current one")
			assert.EqualValues(t, 1, bobWeek.Paid.Size)
			assert.Equal(t, []int64{1, 0}, bobWeek.Paid.Active)

			assert.Equal(t, monday, aliceWeek.Week, "weeks start on Monday")
			assert.True(t, aliceWeek.Partial, "the range began on Tuesday, inside her week")
			assert.EqualValues(t, 1, aliceWeek.Size)
			assert.Equal(t, []int64{1, 0, 1}, aliceWeek.Active, "two active days in week 0 count once")
			assert.EqualValues(t, 0, aliceWeek.Paid.Size)

			// bob is the one payer; he has requests but no key left to date them.
			assert.EqualValues(t, 1, activity.SilentPayers.Payers)
			require.Len(t, activity.SilentPayers.Buckets, len(silentBuckets))
			for _, bucket := range activity.SilentPayers.Buckets {
				if bucket.Name == SilentOver60 {
					assert.EqualValues(t, 1, bucket.Count)
				}
			}
		})
	}
}

func TestSpendTiersBandCustomersByVendorSpend(t *testing.T) {
	dollar := int64(common.QuotaPerUnit)
	spend := newVendorSpend()
	// whale: $600 on Claude and $50 on GPT; large: $150 on GPT; mid: $20 on a
	// model of no named vendor; tail: $1 on Claude; and a user with nothing.
	spend.add(1, "claude-opus-4", 600*dollar)
	spend.add(1, "gpt-6", 50*dollar)
	spend.add(2, "gpt-6", 150*dollar)
	spend.add(3, "deepseek-v3", 20*dollar)
	spend.add(4, "claude-opus-4", dollar)
	spend.add(5, "claude-opus-4", 0)

	groups := spend.tiers()
	require.Len(t, groups, 4)
	read := func(vendor string) map[string]SpendTier {
		for _, group := range groups {
			if group.Vendor == vendor {
				bands := make(map[string]SpendTier)
				for _, band := range group.Tiers {
					bands[band.Tier] = band
				}
				return bands
			}
		}
		t.Fatalf("no group %s", vendor)
		return nil
	}
	all := read("all")
	assert.EqualValues(t, 1, all["whale"].Users, "$650 in all")
	assert.Equal(t, 650.0, all["whale"].QuotaUSD)
	assert.EqualValues(t, 1, all["large"].Users)
	assert.EqualValues(t, 1, all["mid"].Users)
	assert.EqualValues(t, 1, all["tail"].Users, "a user who spent nothing is in no band")
	assert.Equal(t, 500.0, all["whale"].FloorUSD)

	claude := read("claude")
	assert.EqualValues(t, 1, claude["whale"].Users, "$600 on Claude alone")
	assert.EqualValues(t, 1, claude["tail"].Users)
	gpt := read("gpt")
	assert.EqualValues(t, 0, gpt["whale"].Users, "the whale's GPT spend of $50 is a mid-band spend")
	assert.EqualValues(t, 1, gpt["large"].Users)
	assert.EqualValues(t, 1, gpt["mid"].Users)
	other := read("other")
	assert.EqualValues(t, 1, other["mid"].Users)
}

func TestChannelInsightsListSignupsByDayAndSource(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	previousMap := common.OptionMap
	common.OptionMap = map[string]string{}
	t.Cleanup(func() { common.OptionMap = previousMap })
	const day1 = int64(1759190400)
	r := InsightsRange{Start: day1, End: day1 + 3*86400}

	channel := registerAffiliateTestUser(t, "magpie", "")
	require.NoError(t, DB.Create(&Affiliate{UserId: channel.Id, Rate: 10, Channel: true, Tier: "retail"}).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", channel.Id).Update("created_at", day1-30*86400).Error)
	signup := func(name, code string, at int64) {
		u := registerAffiliateTestUser(t, name, code)
		require.NoError(t, DB.Model(&User{}).Where("id = ?", u.Id).Update("created_at", at).Error)
	}
	signup("a", channel.AffCode, day1+10)
	signup("b", channel.AffCode, day1+20)
	signup("c", "", day1+30)
	signup("d", channel.AffCode, day1+2*86400+10)

	insights, err := GetChannelInsights(r)
	require.NoError(t, err)
	require.Len(t, insights.SignupsByDay, 3, "every day of the range is listed")
	assert.Equal(t, []ChannelCount{
		{Segment: ChannelSegmentChannel, ChannelID: channel.Id, Registered: 2},
		{Segment: ChannelSegmentOrganic, Registered: 1},
	}, insights.SignupsByDay[0].Sources)
	assert.Empty(t, insights.SignupsByDay[1].Sources, "a day with no sign-up has no sources")
	assert.Equal(t, []ChannelCount{{Segment: ChannelSegmentChannel, ChannelID: channel.Id, Registered: 1}}, insights.SignupsByDay[2].Sources)

	var byRow int64
	for _, day := range insights.SignupsByDay {
		for _, source := range day.Sources {
			byRow += source.Registered
		}
	}
	var registered int64
	for _, row := range insights.Channels {
		registered += row.Registered
	}
	assert.Equal(t, registered, byRow, "the daily sign-ups add up to the rows' Registered")
}

// The customers view names the range's biggest customers with their history,
// how concentrated their spending is, and the month's biggest whose use fell.
func TestCustomerInsightsRankProfileAndWatchChurn(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const end = int64(1759190400) + 40*86400
			dollar := int(common.QuotaPerUnit)
			r := InsightsRange{Start: end - 14*86400, End: end}
			signedUp := end - 30*86400

			newUser := func(name string, requests int) *User {
				u := registerAffiliateTestUser(t, name, "")
				require.NoError(t, DB.Model(&User{}).Where("id = ?", u.Id).Updates(map[string]any{
					"created_at": signedUp, "request_count": requests, "remark": name + " remark", "used_quota": 900 * dollar, "quota": 12 * dollar,
				}).Error)
				return u
			}
			steady := newUser("steady", 10)
			fading := newUser("fading", 10)
			quiet := newUser("quiet", 10)
			small := newUser("small", 1)
			ops := newUser("ops", 1)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops.Id).Update("role", common.RoleAdminUser).Error)

			// A block is 24 hours counted back from the range's end; block 0 is the newest.
			at := func(block int) int64 { return end - int64(block)*86400 - 1800 }
			row := func(u *User, model string, block int, dollars int) QuotaData {
				return QuotaData{UserID: u.Id, Username: u.Username, ModelName: model, CreatedAt: insightHourKey(at(block)), Count: 2, Quota: dollars * dollar, TokenUsed: 10}
			}
			var rows []QuotaData
			for block := 0; block < 14; block++ {
				rows = append(rows, row(steady, "claude-opus-4", block, 10))
			}
			// fading spent $10 a day in the seven days before the last seven, and $1 in them.
			for block := 0; block < 14; block++ {
				dollars := 10
				if block < 7 {
					dollars = 1
				}
				rows = append(rows, row(fading, "gpt-6", block, dollars))
			}
			// quiet spent steadily until four days before the end, and nothing since.
			for block := 4; block < 14; block++ {
				rows = append(rows, row(quiet, "gpt-6", block, 8))
			}
			rows = append(rows, row(small, "gpt-6", 2, 1), row(ops, "gpt-6", 0, 500))
			require.NoError(t, DB.Create(&rows).Error)

			require.NoError(t, DB.Create(&TopUp{UserId: steady.Id, Money: 100, Amount: 100, TradeNo: "T1", PaymentMethod: "stripe",
				Status: common.TopUpStatusSuccess, CreateTime: signedUp + 10}).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: steady.Id, PlanId: 1, Money: 50, TradeNo: "S1",
				Status: common.TopUpStatusSuccess, CreateTime: signedUp + 20}).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: steady.Id, Money: 50, TradeNo: "S1", PaymentMethod: "stripe",
				Status: common.TopUpStatusSuccess, CreateTime: signedUp + 20}).Error)
			require.NoError(t, DB.Create(&[]Token{
				{UserId: steady.Id, Key: "k1", Name: "k1", Group: "claude", UsedQuota: 5, AccessedTime: end - 100, Status: 1},
				{UserId: steady.Id, Key: "k2", Name: "k2", Group: "gpt", UsedQuota: 90, AccessedTime: end - 5000, Status: 1},
			}).Error)

			insights, err := GetCustomerInsights(r)
			require.NoError(t, err)

			assert.EqualValues(t, 4, insights.CustomersSpending)
			assert.Equal(t, 298.0, insights.TotalUSD)
			require.Len(t, insights.Top, 4, "staff are left out")
			names := make([]string, 0, 4)
			for _, profile := range insights.Top {
				names = append(names, profile.Username)
			}
			assert.Equal(t, []string{"steady", "quiet", "fading", "small"}, names, "ranked by spend in the range")
			assert.InDelta(t, 1.0, insights.Top5Share, 1e-9, "four customers: the top 5 is everyone")
			assert.InDelta(t, 1.0, insights.Top10Share, 1e-9)
			assert.InDelta(t, 1.0, insights.Top20Share, 1e-9, "four customers: the top 20 is everyone")

			top := insights.Top[0]
			assert.Equal(t, "steady remark", top.Remark)
			assert.Equal(t, signedUp, top.RegisteredAt)
			assert.Equal(t, 100.0, top.TopupPaid, "the order that paid for a plan is not a top-up")
			assert.Equal(t, 50.0, top.SubscriptionPaid)
			assert.Equal(t, 140.0, top.QuotaUSD)
			assert.Equal(t, 900.0, top.LifetimeUSD)
			assert.Equal(t, 12.0, top.BalanceUSD)
			assert.Equal(t, "claude-opus-4", top.MainModel)
			assert.Equal(t, "gpt", top.MainGroup, "the key that spent the most decides")
			assert.Equal(t, end-100, top.LastUsedAt, "the newest of the keys' accessed times and the last request hour")
			assert.EqualValues(t, 14, top.ActiveDays)
			assert.Equal(t, []float64{10, 10, 10, 10, 10, 10, 10}, top.Trend)

			fadingProfile := insights.Top[2]
			assert.Equal(t, []float64{10, 10, 10, 10, 10, 10, 10}[:0], []float64{}, "placeholder to keep types")
			assert.Equal(t, []float64{1, 1, 1, 1, 1, 1, 1}, fadingProfile.Trend)

			quietProfile := insights.Top[1]
			assert.Equal(t, []float64{8, 8, 8, 0, 0, 0, 0}, quietProfile.Trend, "oldest first, the quiet last days are zero")

			assert.EqualValues(t, 4, insights.Watched)
			require.Len(t, insights.Churn, 2, "steady and small are not flagged")
			assert.Equal(t, "quiet", insights.Churn[0].Username)
			assert.Equal(t, []string{ChurnDropped, ChurnIdle}, insights.Churn[0].Reasons)
			assert.Equal(t, 80.0, insights.Churn[0].MonthUSD)
			assert.Equal(t, 24.0, insights.Churn[0].Last7USD)
			assert.Equal(t, 56.0, insights.Churn[0].Previous7USD)
			assert.Equal(t, end-4*86400-3600, insights.Churn[0].LastRequestAt)
			assert.Equal(t, "fading", insights.Churn[1].Username)
			assert.Equal(t, []string{ChurnDropped}, insights.Churn[1].Reasons)
			assert.Equal(t, 7.0, insights.Churn[1].Last7USD)
			assert.Equal(t, 70.0, insights.Churn[1].Previous7USD)
		})
	}
}

func TestCustomerInsightsEmptySite(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const end = int64(1759190400)
	insights, err := GetCustomerInsights(InsightsRange{Start: end - 7*86400, End: end})
	require.NoError(t, err)
	assert.NotNil(t, insights.Top)
	assert.NotNil(t, insights.Churn)
	assert.Empty(t, insights.Top)
	assert.EqualValues(t, 0, insights.CustomersSpending)
	assert.Zero(t, insights.Top5Share)
}
