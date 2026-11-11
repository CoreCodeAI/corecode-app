package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpstreamInsightsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			require.NoError(t, DB.AutoMigrate(&Option{}, &Channel{}))
			t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Option{}, &Channel{})) })
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })

			const hour1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			engine, relay := "http://gpt-load:3001", "https://usdj.example.cc"
			high, low := int64(10), int64(0)
			require.NoError(t, DB.Create(&[]Channel{
				{Id: 2, Name: "engine-gpt", Type: 1, Key: "k2", Status: common.ChannelStatusEnabled, BaseURL: &engine, Priority: &high},
				{Id: 7, Name: "relay", Type: 1, Key: "k7", Status: common.ChannelStatusEnabled, BaseURL: &relay, Priority: &low},
				{Id: 9, Name: "idle", Type: 1, Key: "k9", Status: common.ChannelStatusEnabled, BaseURL: &relay},
				{Id: 11, Name: "retired", Type: 1, Key: "k11", Status: common.ChannelStatusManuallyDisabled, BaseURL: &relay},
			}).Error)
			alice := registerAffiliateTestUser(t, "alice", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))

			// One request fails on the engine and is served by the relay; one
			// is served by the engine; root's test on the relay is counted
			// but earns nothing; one request was refused before any channel.
			logs := []Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour1 + 100, ChannelId: 2, ModelName: "gpt-6.1-sol",
					Content: "status_code=503, Our servers are currently overloaded. Please try again later."},
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour1 + 130, UseTime: 30, ChannelId: 7, ModelName: "gpt-6.1-sol",
					Quota: int(dollar), PromptTokens: 100, CompletionTokens: 10, IsStream: true, UpstreamRequestId: "up-1",
					Other: `{"frt":900,"cache_tokens":40,"admin_info":{"use_channel":["2","7"]}}`},
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour1 + 200, UseTime: 20, ChannelId: 2, ModelName: "gpt-6.1-sol",
					Quota: int(2 * dollar), PromptTokens: 50, IsStream: true, Other: `{"frt":3000,"admin_info":{"use_channel":["2"]}}`},
				{UserId: root.Id, Username: "root", Type: LogTypeConsume, CreatedAt: hour1 + 300, UseTime: 5, ChannelId: 7, ModelName: "gpt-6-luna",
					Quota: int(dollar), Other: `{}`},
				{UserId: alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour1 + 400, ModelName: "gpt-6.1-sol",
					Content: "status_code=403, model not allowed"},
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)

			// The relay billed two requests, one of them read twice; the
			// engine has a monthly fee.
			cost := UpstreamCost{ChannelId: 7, RequestId: "up-1", CreatedAt: hour1 + 131, ModelName: "gpt-6.1-sol", Quota: 50_000, QuotaPerUnit: 500_000, GroupName: "GPT特惠", GroupRatio: 0.09}
			added, err := SaveUpstreamCosts([]UpstreamCost{cost, {ChannelId: 7, RequestId: "up-2", CreatedAt: hour1 + 301, ModelName: "gpt-6-luna", Quota: 25_000, QuotaPerUnit: 500_000, GroupName: "GPT特惠", GroupRatio: 0.09}})
			require.NoError(t, err)
			assert.EqualValues(t, 2, added)
			added, err = SaveUpstreamCosts([]UpstreamCost{cost})
			require.NoError(t, err)
			assert.Zero(t, added, "a request read again is not stored twice")
			require.NoError(t, SaveUpstreamFees(map[int]float64{2: 300, 9: 0}))

			r := InsightsRange{Start: hour1, End: hour1 + 86400, Offset: 8 * 3600}
			insights, err := GetUpstreamInsights(r)
			require.NoError(t, err)

			require.Len(t, insights.Channels, 3, "the disabled channel without traffic is left out, the idle enabled one is listed")
			byID := map[int]UpstreamChannel{}
			for _, channel := range insights.Channels {
				byID[channel.ID] = channel
			}
			engineRow, relayRow, idle := byID[2], byID[7], byID[9]
			assert.Equal(t, 2, insights.Channels[0].ID, "the busiest channel first")

			assert.EqualValues(t, 1, engineRow.Requests)
			assert.EqualValues(t, 1, engineRow.Errors)
			assert.InDelta(t, 0.5, engineRow.FailureRate, 1e-9)
			assert.InDelta(t, 2, engineRow.RevenueUSD, 1e-9)
			assert.Equal(t, UpstreamCostSourceFee, engineRow.CostSource)
			assert.InDelta(t, 10, engineRow.CostUSD, 1e-9, "a day of a $300 month")
			assert.Equal(t, []NamedCount{{Name: "Our servers are currently overloaded", Count: 1}}, engineRow.Reasons)
			assert.Equal(t, "gpt-load", engineRow.Host)

			assert.EqualValues(t, 2, relayRow.Requests)
			assert.Zero(t, relayRow.Errors)
			assert.EqualValues(t, 1, relayRow.Rescued)
			assert.InDelta(t, 1, relayRow.RevenueUSD, 1e-9, "root's request earns nothing")
			assert.Equal(t, UpstreamCostSourceUpstream, relayRow.CostSource)
			assert.InDelta(t, 0.15, relayRow.CostUSD, 1e-9)
			assert.Equal(t, hour1+301, relayRow.LatestCostAt)
			assert.Equal(t, "GPT特惠", relayRow.UpstreamGroup)
			assert.InDelta(t, 0.09, relayRow.UpstreamRatio, 1e-9)
			assert.EqualValues(t, 900, relayRow.TTFTP50)
			assert.EqualValues(t, 40, relayRow.CacheRead)

			assert.Zero(t, idle.Requests)
			assert.Equal(t, UpstreamCostSourceNone, idle.CostSource)

			assert.Equal(t, []UpstreamRescue{{From: 2, To: 7, Count: 1}}, insights.Rescues)

			var sol []UpstreamModel
			for _, row := range insights.Models {
				if row.Model == "gpt-6.1-sol" {
					sol = append(sol, row)
				}
			}
			require.Len(t, sol, 2)
			assert.Equal(t, 2, sol[0].ChannelID, "a model's busiest channel first")
			assert.InDelta(t, 0.5, sol[0].FailureRate, 1e-9)
			assert.Zero(t, sol[0].CostUSD, "a fee is not split by model")
			assert.InDelta(t, 0.1, sol[1].CostUSD, 1e-9)

			var dayCost float64
			for _, day := range insights.Daily {
				assert.Equal(t, hour1, day.Day)
				dayCost += day.CostUSD
			}
			assert.InDelta(t, 10.15, dayCost, 1e-9, "the daily costs add up to the channels' costs")

			// Hourly rows: the engine's fee is prorated over each of the 24
			// hours; the relay's bill and traffic sit in the first.
			assert.Len(t, insights.Hourly, 25, "the engine's 24 fee hours and the relay's one")
			var hourCost, hourRevenue float64
			var hourRequests int64
			for _, hour := range insights.Hourly {
				hourCost += hour.CostUSD
				hourRevenue += hour.RevenueUSD
				hourRequests += hour.Requests
				if hour.ChannelID == 2 {
					assert.InDelta(t, 10.0/24, hour.CostUSD, 1e-9, "an hour of a $300 month")
				}
			}
			assert.InDelta(t, 10.15, hourCost, 1e-9, "the hourly costs add up to the channels' costs")
			assert.InDelta(t, engineRow.RevenueUSD+relayRow.RevenueUSD, hourRevenue, 1e-9)
			assert.Equal(t, engineRow.Requests+relayRow.Requests, hourRequests)
			relayHour := insights.Hourly[1]
			assert.InDelta(t, 0.15, relayHour.CostUSD, 1e-9)
			relayHour.CostUSD = 0
			assert.Equal(t, UpstreamHour{Hour: hour1, ChannelID: 7, Requests: 2, RevenueUSD: 1}, relayHour)

			week, err := GetUpstreamInsights(InsightsRange{Start: hour1, End: hour1 + 7*86400, Offset: 8 * 3600})
			require.NoError(t, err)
			assert.Nil(t, week.Hourly, "a week has no hourly series")
			assert.NotEmpty(t, week.Daily)

			// Stored hours read back the same figures.
			again, err := GetUpstreamInsights(r)
			require.NoError(t, err)
			assert.Equal(t, insights, again)
		})
	}
}

func TestPublicUpstreamHost(t *testing.T) {
	for url, want := range map[string]bool{
		"https://usdj.zzshu.cc":      true,
		"https://api.example.com/v1": true,
		"http://gpt-load:3001":       false,
		"http://localhost:3000":      false,
		"http://10.0.0.5:8080":       false,
		"https://[::1]:443":          false,
		"ftp://files.example.com":    false,
		"":                           false,
	} {
		assert.Equal(t, want, PublicUpstreamHost(url), url)
	}
}

func TestSaveUpstreamFeesRejectsInvalidFees(t *testing.T) {
	for _, fees := range []map[int]float64{{0: 10}, {2: -1}, {2: 2e7}} {
		assert.Error(t, SaveUpstreamFees(fees))
	}
}
