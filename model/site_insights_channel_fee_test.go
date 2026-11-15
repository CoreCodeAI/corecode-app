package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The funds view's channel fee is the channels view's fee column summed, so
// the waterfall and the channels tab's card cannot disagree over a range.
func TestFundsChannelFeeEqualsChannelsView(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })

			const day1 = int64(1759248000)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}
			first := registerAffiliateTestUser(t, "first-channel", "")
			second := registerAffiliateTestUser(t, "second-channel", "")
			require.NoError(t, DB.Create(&[]Affiliate{
				{UserId: first.Id, Rate: 10, Channel: true, Tier: "retail"},
				{UserId: second.Id, Rate: 10, Channel: true, Tier: "retail"},
			}).Error)

			// A fee changed on the second day without closing the first entry,
			// and a second channel's fee starts within the range and ends in it.
			require.NoError(t, SaveChannelCosts([]ChannelCost{
				{UserID: first.Id, MonthlyUSD: 1000, Start: day1 - 86400},
				{UserID: first.Id, MonthlyUSD: 600, Start: day1 + 86400},
				{UserID: second.Id, MonthlyUSD: 333.33, Start: day1 + 3600, End: day1 + 40000},
			}))

			channels, err := GetChannelInsights(r)
			require.NoError(t, err)
			finance, err := GetFinanceInsights(r)
			require.NoError(t, err)

			var channelFees float64
			for _, row := range channels.Channels {
				channelFees += row.FeeUSD
			}
			assert.Equal(t, roundTo(channelFees, 2), finance.ChannelFeeUSD, "the funds view sums the channels view's fee column")
			// 1000 for the first day, 600 for the second, and 333.33 for the
			// second channel's 10 hours and 7 minutes of its month.
			assert.InDelta(t, 33.33+20+333.33*36400/(30*86400), finance.ChannelFeeUSD, 0.01)
		})
	}
}
