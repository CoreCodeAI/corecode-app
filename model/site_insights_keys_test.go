package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// keyTestUsers creates two customers, a staff account and a key for each of
// them, all in the same test database.
type keyTestUsers struct {
	alice, bob, root          *User
	aliceKey, bobKey, rootKey *Token
}

func newKeyTestUsers(t *testing.T) keyTestUsers {
	t.Helper()
	var users keyTestUsers
	users.alice = registerAffiliateTestUser(t, "alice", "")
	users.bob = registerAffiliateTestUser(t, "bob", "")
	users.root = &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
	require.NoError(t, users.root.Insert(0))
	users.aliceKey = &Token{UserId: users.alice.Id, Name: "alice-app", Key: "key-alice-app", Status: common.TokenStatusEnabled}
	users.bobKey = &Token{UserId: users.bob.Id, Name: "bob-app", Key: "key-bob-app", Status: common.TokenStatusEnabled}
	users.rootKey = &Token{UserId: users.root.Id, Name: "root-key", Key: "key-root", Status: common.TokenStatusEnabled}
	require.NoError(t, DB.Create([]*Token{users.aliceKey, users.bobKey, users.rootKey}).Error)
	return users
}

// keyTestLogs is one hour of traffic: a retried request that a second channel
// served, a customer's own 400 and a service 502, bob's served request and a
// refund of it written in the next hour, root's request, and a request with no
// key. The figures are in the test that reads them.
func keyTestLogs(users keyTestUsers, hour int64) []Log {
	dollar := int64(common.QuotaPerUnit)
	return []Log{
		{UserId: users.alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour + 10, UseTime: 2, ModelName: "gpt-6", ChannelId: 1,
			RequestId: "r1", TokenId: users.aliceKey.Id, TokenName: "alice-app", Content: "status_code=502, upstream failed", Other: `{}`},
		{UserId: users.alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour + 20, UseTime: 3, ModelName: "gpt-6", ChannelId: 2,
			RequestId: "r1", TokenId: users.aliceKey.Id, TokenName: "alice-app", Quota: int(dollar), Other: `{}`},
		{UserId: users.alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour + 30, UseTime: 1, ModelName: "gpt-6", ChannelId: 1,
			RequestId: "r2", TokenId: users.aliceKey.Id, TokenName: "alice-app", Content: "status_code=400, invalid prompt", Other: `{}`},
		{UserId: users.alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour + 40, UseTime: 1, ModelName: "gpt-6", ChannelId: 1,
			RequestId: "r3", TokenId: users.aliceKey.Id, TokenName: "alice-app", Content: "status_code=502, upstream failed", Other: `{}`},
		{UserId: users.bob.Id, Username: "bob", Type: LogTypeConsume, CreatedAt: hour + 50, UseTime: 4, ModelName: "claude-x", ChannelId: 3,
			RequestId: "r4", TokenId: users.bobKey.Id, TokenName: "bob-app", Quota: int(dollar / 2), Other: `{}`},
		{UserId: users.root.Id, Username: "root", Type: LogTypeConsume, CreatedAt: hour + 60, UseTime: 2, ModelName: "gpt-6", ChannelId: 2,
			RequestId: "r5", TokenId: users.rootKey.Id, TokenName: "root-key", Quota: int(dollar * 3 / 2), Other: `{}`},
		{UserId: users.alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour + 70, UseTime: 2, ModelName: "gpt-6", ChannelId: 2,
			RequestId: "r6", TokenId: 0, Quota: int(dollar / 4), Other: `{}`},
		{UserId: users.bob.Id, Username: "bob", Type: LogTypeRefund, CreatedAt: hour + 3600 + 100, ModelName: "claude-x", ChannelId: 3,
			TokenId: users.bobKey.Id, TokenName: "bob-app", Quota: int(dollar / 5), Other: `{"task_id":"task-1","is_task":true}`},
	}
}

// A request counts once for its key however many attempts it took; a failover
// that another channel served is not a failure; a customer's own 400 is not a
// service failure; a refund in the next hour nets the key's spend; staff keys
// are listed apart; a request with no key is one row.
func TestKeyInsightsFoldsEachRequestAndCharge(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour = int64(1759248000)
			users := newKeyTestUsers(t)
			logs := keyTestLogs(users, hour)
			require.NoError(t, LOG_DB.Create(&logs).Error)

			r := InsightsRange{Start: hour, End: hour + 2*3600}
			keys, err := GetKeyInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 5, keys.Requests, "r1 to r4 and r6 are customers' requests; r5 is staff's")
			assert.EqualValues(t, 2, keys.FailedRequests, "r2 and r3 were not served; r1 was")
			assert.EqualValues(t, 1, keys.ClientFailures, "r2's 400 is the customer's own")
			assert.Equal(t, 0.2, keys.ServiceFailureRate, "one service failure over five requests")
			assert.Equal(t, 1.55, keys.QuotaUSD, "1 for alice's r1, 0.5 less the 0.2 refund for bob, 0.25 with no key")
			assert.EqualValues(t, 2, keys.ActiveKeys, "alice's and bob's keys; the no-key row is not a key")
			assert.False(t, keys.KeysTruncated)
			assert.Nil(t, keys.OtherKeys)
			assert.Zero(t, keys.StaleHours)

			require.Len(t, keys.Keys, 3)
			assert.Equal(t, APIKeyUsage{
				TokenID: users.aliceKey.Id, TokenName: "alice-app", Owner: UserRef{users.alice.Id, "alice"},
				Requests: 3, FailedRequests: 2, ClientFailures: 1, ServiceFailureRate: 0.3333, QuotaUSD: 1, Share: 0.6452,
				TopModels: []KeyModelUsage{{Model: "gpt-6", Requests: 3, QuotaUSD: 1}},
			}, keys.Keys[0], "the retried request counts once, the failover is served")
			assert.Equal(t, APIKeyUsage{
				TokenID: users.bobKey.Id, TokenName: "bob-app", Owner: UserRef{users.bob.Id, "bob"},
				Requests: 1, QuotaUSD: 0.3, Share: 0.1935,
				TopModels: []KeyModelUsage{{Model: "claude-x", Requests: 1, QuotaUSD: 0.3}},
			}, keys.Keys[1], "the refund in the next hour nets the spend")
			assert.Equal(t, APIKeyUsage{
				TokenID: 0, Requests: 1, QuotaUSD: 0.25, Share: 0.1613,
				TopModels: []KeyModelUsage{{Model: "gpt-6", Requests: 1, QuotaUSD: 0.25}},
			}, keys.Keys[2], "a request with no key is one row, named as such")

			assert.EqualValues(t, 1, keys.StaffRequests, "staff's request is counted apart")
			assert.Equal(t, 1.5, keys.StaffQuotaUSD)
			require.Len(t, keys.StaffKeys, 1)
			assert.Equal(t, APIKeyUsage{
				TokenID: users.rootKey.Id, TokenName: "root-key", Owner: UserRef{users.root.Id, "root"},
				Requests: 1, QuotaUSD: 1.5, Share: 1,
				TopModels: []KeyModelUsage{{Model: "gpt-6", Requests: 1, QuotaUSD: 1.5}},
			}, keys.StaffKeys[0])

			var stored int64
			require.NoError(t, DB.Model(&InsightKeyHour{}).Where("hour_start = ?", hour).Count(&stored).Error)
			assert.EqualValues(t, 4, stored, "one row per key and model with figures, staff included")
		})
	}
}

// A stored hour of the previous version has no key rows: the keys view counts
// it in stale_hours and leaves its keys out, and a rebuild stores them.
func TestKeyInsightsStaleHourIsRebuilt(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			now := time.Now().Unix()
			base := now - now%3600 - 10*3600
			dollar := int64(common.QuotaPerUnit)
			alice := registerAffiliateTestUser(t, "alice", "")
			key := &Token{UserId: alice.Id, Name: "alice-app", Key: "key-stale", Status: common.TokenStatusEnabled}
			require.NoError(t, DB.Create(key).Error)
			require.NoError(t, DB.Create(&InsightHour{HourStart: base, Version: insightHourVersion - 1, Data: `{"requests":1}`, CreatedAt: 1}).Error)
			require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: base + 100, UseTime: 2,
				ModelName: "gpt-6", TokenId: key.Id, TokenName: "alice-app", Quota: int(dollar), Other: `{}`}).Error)
			// A later log shows the earliest hour's logs were not cleaned
			// (insightFirstHourWhole), so the rebuild may take that hour.
			require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: base + 3600 + 7200 + 600 + 100,
				UseTime: 2, ModelName: "gpt-6", Quota: 1, Other: `{}`}).Error)

			r := InsightsRange{Start: base, End: base + 3600}
			before, err := GetKeyInsights(r)
			require.NoError(t, err)
			assert.Equal(t, 1, before.StaleHours)
			assert.Empty(t, before.Keys, "a stale hour's keys are not in the figures")
			assert.Zero(t, before.Requests)

			allowInsightRebuild(t)
			_, err = FillInsightHours(1, 1000)
			require.NoError(t, err)
			var version int
			require.NoError(t, DB.Model(&InsightHour{}).Where("hour_start = ?", base).Pluck("version", &version).Error)
			assert.Equal(t, insightHourVersion, version)

			after, err := GetKeyInsights(r)
			require.NoError(t, err)
			assert.Zero(t, after.StaleHours)
			require.Len(t, after.Keys, 1)
			assert.Equal(t, int64(1), after.Keys[0].Requests)
			assert.Equal(t, 1.0, after.Keys[0].QuotaUSD)
		})
	}
}

// The stored hours are summed by SQL and the open hours come from memory, and
// both must give the same figures for the same logs: the same logs are written
// once in a settled hour and once in the hour still open.
func TestKeyInsightsStoredAndOpenHoursAgree(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			now := time.Now().Unix()
			open := now - now%3600
			past := open - 6*3600
			users := newKeyTestUsers(t)

			pastLogs := keyTestLogs(users, past)
			require.NoError(t, LOG_DB.Create(&pastLogs).Error)
			stored, err := GetKeyInsights(InsightsRange{Start: past, End: past + 3600})
			require.NoError(t, err)
			require.NotZero(t, stored.Requests)

			openLogs := keyTestLogs(users, open)
			require.NoError(t, LOG_DB.Create(&openLogs).Error)
			memory, err := GetKeyInsights(InsightsRange{Start: open, End: open + 3600})
			require.NoError(t, err)
			again, err := GetKeyInsights(InsightsRange{Start: past, End: past + 3600})
			require.NoError(t, err)

			assert.Equal(t, stored, again, "a stored hour reads back the same")
			assert.Equal(t, stored, memory, "the stored and the open hour agree")
		})
	}
}

// An hour keeps at most 2*insightKeyTopN customer keys: the ones with the most
// spend and the most requests. The others fold into one row, so the hour's
// totals stay whole.
func TestKeyHourKeepsTopKeysAndFoldsTheRest(t *testing.T) {
	const keys = 500
	hour := &insightHour{start: 3600, keys: make(map[insightKeyRowKey]*InsightKeyHour)}
	var wantRequests int64
	var folded int64
	for i := 1; i <= keys; i++ {
		row := hour.keyOf(i, "", 1, false, "gpt-6")
		row.Requests = int64(i)
		row.Quota = int64(keys + 1 - i)
		wantRequests += row.Requests
		// Requests rank 301 to 500 first, spend ranks 1 to 200 first: the kept
		// keys are 1 to 500 less those in neither list, 201 to 300.
		if i > 200 && i <= 300 {
			folded += row.Requests
		}
	}
	hour.keepTopKeys()

	var named, requests int64
	for key, row := range hour.keys {
		requests += row.Requests
		if key.tokenID > 0 && key.tokenID != insightKeyOther {
			named++
		}
	}
	assert.EqualValues(t, 2*insightKeyTopN, named)
	other := hour.keys[insightKeyRowKey{tokenID: insightKeyOther, model: "gpt-6"}]
	require.NotNil(t, other)
	assert.Equal(t, folded, other.Requests)
	assert.Equal(t, wantRequests, requests, "the totals are whole")
}
