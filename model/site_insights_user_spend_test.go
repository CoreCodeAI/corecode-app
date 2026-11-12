package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserSpendDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const start = int64(1761408000)
			dollar := int64(common.QuotaPerUnit)

			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			require.NoError(t, DB.Model(&User{}).Where("id = ?", alice.Id).Updates(map[string]any{"email": "alice@example.com", "quota": 30 * dollar}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", bob.Id).Updates(map[string]any{"quota": -2 * dollar}).Error)

			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: start + 10, ModelName: "claude-opus", Group: "vip", ChannelId: 2, Quota: int(3 * dollar)},
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: start + 20, ModelName: "claude-opus", Group: "vip", ChannelId: 2, Quota: int(dollar)},
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: start + 30, ModelName: "claude-opus", Group: "plain", ChannelId: 2, Quota: int(dollar)},
				{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: start + 40, ModelName: "claude-sonnet", Group: "vip", ChannelId: 2, Quota: int(dollar)},
				// The same model served by another channel is its own row.
				{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: start + 45, ModelName: "claude-sonnet", Group: "vip", ChannelId: 7, Quota: int(dollar)},
				// An error, a log before the window and one at its end are
				// not counted.
				{UserId: bob.Id, Type: LogTypeError, CreatedAt: start + 50, ModelName: "claude-sonnet", Group: "vip"},
				{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: start - 1, ModelName: "claude-sonnet", Group: "vip", Quota: int(dollar)},
				{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: start + 3600, ModelName: "claude-sonnet", Group: "vip", Quota: int(dollar)},
				{UserId: root.Id, Type: LogTypeConsume, CreatedAt: start + 60, ModelName: "claude-opus", Group: "root", Quota: int(dollar)},
			}).Error)

			rows, err := ReadUserModelSpend(start, start+3600)
			require.NoError(t, err)
			type key struct {
				user    int
				model   string
				group   string
				channel int
			}
			got := map[key][2]int64{}
			for _, row := range rows {
				got[key{row.UserId, row.ModelName, row.LogGroup, row.ChannelId}] = [2]int64{row.Requests, row.Quota}
			}
			assert.Equal(t, map[key][2]int64{
				{alice.Id, "claude-opus", "vip", 2}:   {2, 4 * dollar},
				{alice.Id, "claude-opus", "plain", 2}: {1, dollar},
				{bob.Id, "claude-sonnet", "vip", 2}:   {1, dollar},
				{bob.Id, "claude-sonnet", "vip", 7}:   {1, dollar},
				{root.Id, "claude-opus", "root", 0}:   {1, dollar},
			}, got)

			require.NoError(t, DB.AutoMigrate(&Channel{}))
			t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Channel{})) })
			inside, sameHost, public := "http://gpt-load:3001", "https://engine.example.com/v1", "https://api.example.com"
			require.NoError(t, DB.Create(&[]Channel{
				{Id: 2, Name: "engine", Key: "k2", BaseURL: &inside},
				{Id: 3, Name: "engine by name", Key: "k3", BaseURL: &sameHost},
				{Id: 7, Name: "relay", Key: "k7", BaseURL: &public},
				{Id: 8, Name: "official", Key: "k8"},
			}).Error)
			engineChannels, err := EngineChannelIDs("https://engine.example.com")
			require.NoError(t, err)
			assert.Equal(t, map[int]bool{2: true, 3: true}, engineChannels)

			// An administrator is staff too: the customer views leave both out.
			admin := &User{Username: "admin", DisplayName: "admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}
			require.NoError(t, admin.Insert(0))
			staff, err := StaffUserIDs()
			require.NoError(t, err)
			assert.ElementsMatch(t, []int{root.Id, admin.Id}, staff)
			assert.NotContains(t, staff, alice.Id)

			// Alice topped up twice and bought a plan; a wallet-paid order and
			// a pending one do not count.
			orders := []TopUp{
				{UserId: alice.Id, Money: 10.5, Status: common.TopUpStatusSuccess, TradeNo: "us-1"},
				{UserId: alice.Id, Money: 20.25, Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderStripe, TradeNo: "us-2"},
				{UserId: alice.Id, Money: 99, Status: common.TopUpStatusSuccess, TradeNo: "us-plan"},
				{UserId: alice.Id, Money: 5, Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderBalance, TradeNo: "us-wallet"},
				{UserId: bob.Id, Money: 7, Status: common.TopUpStatusPending, TradeNo: "us-pending"},
			}
			require.NoError(t, DB.Create(&orders).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: alice.Id, Money: 99, TradeNo: "us-plan", Status: common.TopUpStatusSuccess}).Error)

			accounts, err := ReadUserSpendAccounts([]int{alice.Id, bob.Id, 999})
			require.NoError(t, err)
			require.Len(t, accounts, 2)
			assert.Equal(t, UserSpendAccount{
				UserRef: UserRef{UserID: alice.Id, Username: "alice"}, Email: "alice@example.com",
				BalanceQuota: 30 * dollar, TopupPaid: 30.75, SubscriptionPaid: 99,
			}, *accounts[alice.Id])
			assert.Equal(t, UserSpendAccount{
				UserRef: UserRef{UserID: bob.Id, Username: "bob"}, BalanceQuota: -2 * dollar,
			}, *accounts[bob.Id])

			empty, err := ReadUserSpendAccounts(nil)
			require.NoError(t, err)
			assert.Empty(t, empty)
		})
	}
}
