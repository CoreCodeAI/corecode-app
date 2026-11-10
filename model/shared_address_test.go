package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func addressTestSession(t *testing.T, userId int, ip string, at int64) {
	t.Helper()
	require.NoError(t, DB.Create(&UserSession{SID: fmt.Sprintf("s-%d-%s-%d", userId, ip, at), UserID: userId, Status: "active",
		RefreshHash: "h", LoginMethod: "oauth", IP: ip, CreatedAt: at, LastActiveAt: at, ExpiresAt: at + 3600}).Error)
}

func addressTestRequest(t *testing.T, userId int, ip string, at int64) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&Log{UserId: userId, CreatedAt: at, Type: LogTypeConsume, Ip: ip}).Error)
}

func TestNewcomerPlanOnePerAddressDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			unlimited := &SubscriptionPlan{Title: "monthly", PriceAmount: 99, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true}
			for _, plan := range []*SubscriptionPlan{newcomer, unlimited} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}
			buy := func(user *User, plan *SubscriptionPlan, at int64) {
				t.Helper()
				require.NoError(t, DB.Create(&UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", Source: "order",
					StartTime: at, EndTime: at + 7*86400, CreatedAt: at, UpdatedAt: at}).Error)
			}

			first := registerAffiliateTestUser(t, "addr_first", "")
			buy(first, newcomer, now-3600)
			addressTestSession(t, first.Id, "198.51.100.7", now-3600)
			addressTestRequest(t, first.Id, "203.0.113.9", now-1800)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: first.Id, PlanId: newcomer.Id, TradeNo: "addr-first", Status: "success",
				CreateTime: now - 3600, Ip: "192.0.2.44"}).Error)

			second := registerAffiliateTestUser(t, "addr_second", "")
			for _, ip := range []string{"198.51.100.7", "203.0.113.9", "192.0.2.44"} {
				assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, ip), ErrSubscriptionAddressTaken,
					"a sign-in, a request or an order of the first buyer from %s counts", ip)
			}
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "198.51.100.8"), "another address")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, unlimited, "198.51.100.7"), "a plan without a per-user limit")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(first.Id, unlimited, "198.51.100.7"))
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, ""), "no address, no address limit")

			// A shared exit carries many customers' requests and proves nothing.
			for i := range sharedExitUsers {
				addressTestRequest(t, 100000+i, "203.0.113.9", now-60)
			}
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "203.0.113.9"))
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "198.51.100.7"), ErrSubscriptionAddressTaken)

			// A proxy node carries the sign-ins of customers who never buy the
			// plan: five of them, not counting the purchaser, make it a shared
			// exit. Accounts that bought a limited plan there are one person's.
			proxy := "198.51.100.60"
			addressTestRequest(t, first.Id, proxy, now-7*86400)
			addressTestSession(t, second.Id, proxy, now-60)
			for i := range sharedExitBystanders - 1 {
				farmed := registerAffiliateTestUser(t, fmt.Sprintf("addr_farm_%d", i), "")
				buy(farmed, newcomer, now-600)
				addressTestSession(t, farmed.Id, proxy, now-600)
				addressTestSession(t, 300000+i, proxy, now-600)
			}
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, proxy), ErrSubscriptionAddressTaken,
				"four bystanders, and buyers and the purchaser do not count")
			addressTestSession(t, 300000+sharedExitBystanders, proxy, now-600)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, proxy), "five bystanders")

			// A limited plan nobody bought is refused nowhere.
			trial := &SubscriptionPlan{Title: "trial", PriceAmount: 9.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			require.NoError(t, DB.Create(trial).Error)
			InvalidateSubscriptionPlanCache(trial.Id)
			t.Cleanup(func() { InvalidateSubscriptionPlanCache(trial.Id) })
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, trial, "198.51.100.7"))

			// A purchase from more than 30 days ago no longer counts.
			old := registerAffiliateTestUser(t, "addr_old", "")
			buy(old, newcomer, now-sharedAddressWindowSeconds-60)
			addressTestSession(t, old.Id, "198.51.100.50", now-sharedAddressWindowSeconds-60)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "198.51.100.50"))
		})
	}
}

func TestSelfInvitedCommissionDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			inviter := registerAffiliateTestUser(t, "self_inviter", "")
			require.NoError(t, EnsureDefaultAffiliate(inviter.Id))
			own := registerAffiliateTestUser(t, "self_own", inviter.AffCode)
			friend := registerAffiliateTestUser(t, "self_friend", inviter.AffCode)
			for _, user := range []*User{own, friend} {
				payAffiliateTestTopUp(t, user.Id, 100, PaymentProviderEpay)
			}
			// The inviter signed in from the address the second account sends
			// requests from; the friend uses another one.
			addressTestSession(t, inviter.Id, "198.51.100.20", now-600)
			addressTestRequest(t, own.Id, "198.51.100.20", now-300)
			addressTestRequest(t, friend.Id, "198.51.100.21", now-300)

			consumeAffiliateTestQuota(t, own.Id, 50)
			consumeAffiliateTestQuota(t, friend.Id, 50)
			settleAffiliateTestUser(t, own.Id)
			settleAffiliateTestUser(t, friend.Id)
			assert.Empty(t, affiliateTestCredits(t, own.Id), "no commission on an account that shares the inviter's address")
			assert.Equal(t, []affiliateTestCredit{{inviter.Id, 1, 10, int64(5 * affiliateDollar)}}, affiliateTestCredits(t, friend.Id))

			// Behind a shared exit the address is no evidence, and the
			// commission is paid.
			for i := range sharedExitUsers {
				addressTestRequest(t, 200000+i, "198.51.100.20", now-60)
			}
			consumeAffiliateTestQuota(t, own.Id, 10)
			settleAffiliateTestUser(t, own.Id)
			assert.Equal(t, []affiliateTestCredit{{inviter.Id, 1, 10, int64(1 * affiliateDollar)}}, affiliateTestCredits(t, own.Id))
		})
	}
}
