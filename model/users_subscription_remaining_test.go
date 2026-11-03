package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUsersSubscriptionRemainingDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := openTopUpBonusTestDB(t, dialect)
			require.False(t, db.Migrator().HasTable(&UserSubscription{}), "use an empty test database")
			require.NoError(t, db.AutoMigrate(&UserSubscription{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&UserSubscription{})) })

			// Wallet only, the order would be 3, 1, 2, 4.
			wallets := map[int]int{1: 10, 2: 0, 3: 100, 4: -5}
			for id := 1; id <= 4; id++ {
				require.NoError(t, db.Create(&User{
					Id: id, Username: fmt.Sprintf("subrem%d", id), Password: "password123",
					Status: common.UserStatusEnabled, Group: "default", AffCode: fmt.Sprintf("subrem-aff-%d", id),
					Quota: wallets[id],
				}).Error)
			}
			now := common.GetTimestamp()
			future, past := now+86400, now-86400
			subs := []UserSubscription{
				{UserId: 1, AmountTotal: 100, AmountUsed: 30, EndTime: future, Status: "active"},
				// Used past its total: nothing left, not a negative amount.
				{UserId: 1, AmountTotal: 50, AmountUsed: 60, EndTime: future, Status: "active"},
				{UserId: 1, AmountTotal: 999, EndTime: past, Status: "active"},
				{UserId: 1, AmountTotal: 999, EndTime: future, Status: "expired"},
				{UserId: 1, AmountTotal: 999, EndTime: future, Status: "cancelled"},
				// Unlimited: no amount to add.
				{UserId: 1, AmountTotal: 0, EndTime: future, Status: "active"},
				{UserId: 2, AmountTotal: 500, EndTime: future, Status: "active"},
				{UserId: 4, AmountTotal: 20, EndTime: future, Status: "active"},
			}
			for i := range subs {
				require.NoError(t, db.Create(&subs[i]).Error)
			}

			remaining, err := UsersSubscriptionRemaining([]int{1, 2, 3, 4, 5})
			require.NoError(t, err)
			assert.Equal(t, map[int]int64{1: 70, 2: 500, 4: 20}, remaining)

			empty, err := UsersSubscriptionRemaining(nil)
			require.NoError(t, err)
			assert.Empty(t, empty)

			// Totals: 1 → 80, 2 → 500, 3 → 100, 4 → 15.
			desc, _, err := GetAllUsers(&common.PageInfo{Page: 1, PageSize: 10}, NewUserSortOptions("quota", "desc"))
			require.NoError(t, err)
			assert.Equal(t, []int{2, 3, 1, 4}, collectUserIDs(desc))

			asc, _, err := SearchUsers("subrem", "", nil, nil, 0, 10, NewUserSortOptions("quota", "asc"))
			require.NoError(t, err)
			assert.Equal(t, []int{4, 1, 3, 2}, collectUserIDs(asc))
		})
	}
}
