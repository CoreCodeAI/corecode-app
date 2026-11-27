package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A 24-hour range is weighed against the average day of the seven before it,
// each customer is filed by why they moved, and the risers are listed largest
// first with who they are.
func TestUsageMoversWeighTheRangeAgainstTheUsualLevel(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const end = int64(1759190400) + 40*86400
			dollar := int(common.QuotaPerUnit)
			r := InsightsRange{Start: end - 86400, End: end}
			old := end - 60*86400

			newUser := func(name string, registered int64) *User {
				u := registerAffiliateTestUser(t, name, "")
				require.NoError(t, DB.Model(&User{}).Where("id = ?", u.Id).Updates(map[string]any{
					"created_at": registered, "remark": name + " remark",
				}).Error)
				return u
			}
			grower := newUser("grower", old)
			shrinker := newUser("shrinker", old)
			stopped := newUser("stopped", old)
			returning := newUser("returning", old)
			recent := newUser("recent", r.Start-3*86400)
			newbie := newUser("newbie", r.Start+600)
			ops := newUser("ops", old)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", ops.Id).Update("role", common.RoleAdminUser).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", newbie.Id).Update("inviter_id", grower.Id).Error)

			// Day 0 is the range; day d is the d-th 24 hours before it.
			row := func(u *User, model string, day int, dollars int) QuotaData {
				at := end - int64(day)*86400 - 1800
				return QuotaData{UserID: u.Id, Username: u.Username, ModelName: model, CreatedAt: insightHourKey(at), Count: 1, Quota: dollars * dollar}
			}
			var rows []QuotaData
			for day := 1; day <= 7; day++ {
				rows = append(rows, row(grower, "claude-opus-5-5", day, 10), row(shrinker, "gpt-6", day, 20), row(stopped, "gpt-6", day, 7))
			}
			for day := 1; day <= 3; day++ {
				rows = append(rows, row(recent, "gpt-6", day, 6))
			}
			rows = append(rows,
				row(grower, "claude-opus-5-5", 0, 30), row(grower, "claude-fable-5-2", 0, 20),
				row(shrinker, "gpt-6", 0, 5),
				// returning spent ten days ago, before the baseline, and again in the range.
				row(returning, "gpt-6", 10, 40), row(returning, "gpt-6", 0, 12),
				row(recent, "gpt-6", 0, 30),
				row(newbie, "claude-fable-5-2", 0, 25),
				row(ops, "gpt-6", 0, 500), row(ops, "gpt-6", 3, 1),
			)
			require.NoError(t, DB.Create(&rows).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: newbie.Id, Money: 30, Amount: 30, TradeNo: "M1", PaymentMethod: "stripe",
				Status: common.TopUpStatusSuccess, CreateTime: r.Start + 700}).Error)

			insights, err := GetCustomerInsights(r)
			require.NoError(t, err)
			movers := insights.Movers
			require.NotNil(t, movers)

			assert.Equal(t, r.Start-7*86400, movers.BaselineStart, "a day is weighed against the week before it")
			assert.Equal(t, 7.0, movers.BaselineDays)
			assert.Equal(t, 122.0, movers.CurrentUSD, "staff are left out")
			// recent's $18 over the week is $18/7 a day.
			assert.Equal(t, 39.5714, movers.BaselineUSD)
			assert.Equal(t, 82.4286, movers.DeltaUSD)

			groups := make(map[string]UsageMoverGroup, len(movers.Groups))
			kinds := make([]string, 0, len(movers.Groups))
			for _, group := range movers.Groups {
				groups[group.Kind] = group
				kinds = append(kinds, group.Kind)
			}
			assert.Equal(t, []string{MoverNew, MoverRecent, MoverReturning, MoverGrowing, MoverShrinking}, kinds)
			assert.Equal(t, UsageMoverGroup{Kind: MoverNew, Customers: 1, CurrentUSD: 25, DeltaUSD: 25}, groups[MoverNew])
			assert.Equal(t, UsageMoverGroup{Kind: MoverRecent, Customers: 1, CurrentUSD: 30, BaselineUSD: 2.5714, DeltaUSD: 27.4286}, groups[MoverRecent])
			assert.Equal(t, UsageMoverGroup{Kind: MoverReturning, Customers: 1, CurrentUSD: 12, DeltaUSD: 12}, groups[MoverReturning],
				"spend before the baseline does not count")
			assert.Equal(t, UsageMoverGroup{Kind: MoverGrowing, Customers: 1, CurrentUSD: 50, BaselineUSD: 10, DeltaUSD: 40}, groups[MoverGrowing])
			assert.Equal(t, UsageMoverGroup{Kind: MoverShrinking, Customers: 2, CurrentUSD: 5, BaselineUSD: 27, DeltaUSD: -22}, groups[MoverShrinking],
				"a customer who spent nothing in the range has shrunk too")

			names := make([]string, 0, len(movers.Risers))
			for _, riser := range movers.Risers {
				names = append(names, riser.Username)
			}
			assert.Equal(t, []string{"grower", "recent", "newbie", "returning"}, names, "largest rise first, no one who shrank")
			top := movers.Risers[0]
			assert.Equal(t, MoverGrowing, top.Kind)
			assert.Equal(t, "grower remark", top.Remark)
			assert.Equal(t, old, top.RegisteredAt)
			assert.Equal(t, "claude-opus-5-5", top.MainModel)
			assert.Equal(t, 50.0, top.CurrentUSD)
			assert.Equal(t, 10.0, top.BaselineUSD)
			assert.Equal(t, 40.0, top.DeltaUSD)
			newcomer := movers.Risers[2]
			assert.Equal(t, MoverNew, newcomer.Kind)
			assert.Equal(t, grower.Id, newcomer.InviterID)
			assert.Equal(t, 30.0, newcomer.TopupPaid)
			assert.Zero(t, movers.Risers[3].InviterID)
		})
	}
}

// A range longer than the minimum baseline is weighed against as long a span
// before it.
func TestUsageMoversBaselineMatchesALongRange(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const end = int64(1759190400) + 40*86400
	insights, err := GetCustomerInsights(InsightsRange{Start: end - 14*86400, End: end})
	require.NoError(t, err)
	require.NotNil(t, insights.Movers)
	assert.Equal(t, end-28*86400, insights.Movers.BaselineStart)
	assert.Equal(t, 14.0, insights.Movers.BaselineDays)
	assert.Empty(t, insights.Movers.Risers)
	assert.NotNil(t, insights.Movers.Risers)
	assert.Len(t, insights.Movers.Groups, 5, "every kind is sent, empty ones too")
}
