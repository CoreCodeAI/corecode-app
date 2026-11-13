package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionInFlightReservationsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := openTopUpBonusTestDB(t, dialect)
			require.False(t, db.Migrator().HasTable(&SubscriptionPreConsumeRecord{}), "use an empty test database")
			require.NoError(t, db.AutoMigrate(&SubscriptionPreConsumeRecord{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&SubscriptionPreConsumeRecord{})) })

			now := common.GetTimestamp()
			records := []SubscriptionPreConsumeRecord{
				{RequestId: "running-a", UserId: 1, UserSubscriptionId: 10, PreConsumed: 400, Status: SubscriptionPreConsumeReserved},
				{RequestId: "running-b", UserId: 1, UserSubscriptionId: 10, PreConsumed: 300, Status: SubscriptionPreConsumeReserved},
				{RequestId: "settled", UserId: 1, UserSubscriptionId: 10, PreConsumed: 900, Status: "consumed"},
				{RequestId: "refunded", UserId: 1, UserSubscriptionId: 10, PreConsumed: 900, Status: "refunded"},
				{RequestId: "other-sub", UserId: 1, UserSubscriptionId: 11, PreConsumed: 50, Status: SubscriptionPreConsumeReserved},
				{RequestId: "other-user", UserId: 2, UserSubscriptionId: 12, PreConsumed: 70, Status: SubscriptionPreConsumeReserved},
			}
			for i := range records {
				require.NoError(t, db.Create(&records[i]).Error)
			}
			// A request that died without settling stops counting after the window.
			require.NoError(t, db.Create(&SubscriptionPreConsumeRecord{
				RequestId: "died", UserId: 1, UserSubscriptionId: 10, PreConsumed: 5000, Status: SubscriptionPreConsumeReserved,
			}).Error)
			require.NoError(t, db.Model(&SubscriptionPreConsumeRecord{}).Where("request_id = ?", "died").
				Update("created_at", now-subscriptionInFlightWindow-60).Error)

			reserved, err := SubscriptionInFlightReserved(1)
			require.NoError(t, err)
			assert.Equal(t, map[int]int64{10: 700, 11: 50}, reserved)

			summaries := []SubscriptionSummary{
				{Subscription: &UserSubscription{Id: 10, AmountTotal: 10000, AmountUsed: 2500}},
				{Subscription: &UserSubscription{Id: 11, AmountTotal: 1000, AmountUsed: 30}},
				{Subscription: &UserSubscription{Id: 13, AmountTotal: 1000, AmountUsed: 200}},
			}
			shown := WithoutInFlightReservations(1, summaries)
			assert.Equal(t, int64(1800), shown[0].Subscription.AmountUsed)
			assert.Equal(t, int64(0), shown[1].Subscription.AmountUsed, "never below zero")
			assert.Equal(t, int64(200), shown[2].Subscription.AmountUsed)
			assert.Equal(t, int64(2500), summaries[0].Subscription.AmountUsed, "the stored row is not changed")

			require.NoError(t, MarkSubscriptionPreConsumeSettled("running-a"))
			require.NoError(t, MarkSubscriptionPreConsumeSettled("refunded"))
			reserved, err = SubscriptionInFlightReserved(1)
			require.NoError(t, err)
			assert.Equal(t, map[int]int64{10: 300, 11: 50}, reserved)
			var refunded SubscriptionPreConsumeRecord
			require.NoError(t, db.Where("request_id = ?", "refunded").First(&refunded).Error)
			assert.Equal(t, "refunded", refunded.Status)
		})
	}
}
