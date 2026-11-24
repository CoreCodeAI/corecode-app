package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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
			previous := *operation_setting.GetLimitedPlanAddressSetting()
			*operation_setting.GetLimitedPlanAddressSetting() = operation_setting.LimitedPlanAddressSetting{Enabled: true, FarmEnabled: true, Threshold: 2}
			t.Cleanup(func() { *operation_setting.GetLimitedPlanAddressSetting() = previous })
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

			// With the address limit off, a plan is limited per account only.
			operation_setting.GetLimitedPlanAddressSetting().Enabled = false
			for _, ip := range []string{"198.51.100.7", "203.0.113.9", "192.0.2.44"} {
				assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, ip), "address limit off, %s", ip)
			}
			assert.Error(t, CheckSubscriptionPurchaseFrom(first.Id, newcomer, "198.51.100.8"), "the per-user limit still holds")
			operation_setting.GetLimitedPlanAddressSetting().Enabled = true
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, unlimited, "198.51.100.7"), "a plan without a per-user limit")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(first.Id, unlimited, "198.51.100.7"))
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, ""), "no address, no address limit")

			// An administrator exempts an account another person shares a VPN
			// node with; the per-user limit still holds, and revoking restores
			// the check.
			require.NoError(t, SetSubscriptionAddressExemption(second.Id, true, 1))
			require.NoError(t, SetSubscriptionAddressExemption(second.Id, true, 1), "granting twice is a no-op")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "198.51.100.7"))
			assert.Error(t, CheckSubscriptionPurchaseFrom(first.Id, newcomer, "198.51.100.8"), "the exemption is not the per-user limit")
			third := registerAffiliateTestUser(t, "addr_third", "")
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "198.51.100.7"), ErrSubscriptionAddressTaken, "only the exempted account")
			require.NoError(t, SetSubscriptionAddressExemption(second.Id, false, 1))
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(second.Id, newcomer, "198.51.100.7"), ErrSubscriptionAddressTaken)

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

// A studio opens each order from another address but sends every account's
// requests from one place, so the rule reads the buyer's request addresses.
func TestLimitedPlanOnePerNetworkDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			previous := *operation_setting.GetLimitedPlanAddressSetting()
			*operation_setting.GetLimitedPlanAddressSetting() = operation_setting.LimitedPlanAddressSetting{Enabled: false, FarmEnabled: true, Threshold: 2}
			t.Cleanup(func() { *operation_setting.GetLimitedPlanAddressSetting() = previous })
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			unlimited := &SubscriptionPlan{Title: "monthly", PriceAmount: 99, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true}
			for _, plan := range []*SubscriptionPlan{newcomer, unlimited} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}
			hold := func(user *User, source string) {
				t.Helper()
				require.NoError(t, DB.Create(&UserSubscription{UserId: user.Id, PlanId: newcomer.Id, Status: "active", Source: source,
					StartTime: now - 600, EndTime: now + 86400, CreatedAt: now - 600, UpdatedAt: now - 600}).Error)
			}
			studio := "198.51.100.20"
			a := registerAffiliateTestUser(t, "net_a", "")
			b := registerAffiliateTestUser(t, "net_b", "")
			c := registerAffiliateTestUser(t, "net_c", "")
			addressTestRequest(t, a.Id, studio, now-3000)
			addressTestRequest(t, b.Id, studio, now-2000)
			addressTestRequest(t, c.Id, "203.0.113.77", now-2000)
			addressTestRequest(t, c.Id, studio, now-1000)

			hold(a, "order")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), "one holder is below the threshold of two")
			hold(b, "order")
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), ErrSubscriptionAddressShared,
				"the order comes from another address; the buyer's own requests came from the studio's")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, unlimited, "192.0.2.1"), "a plan without a per-user limit is never refused")

			loner := registerAffiliateTestUser(t, "net_loner", "")
			addressTestRequest(t, loner.Id, "203.0.113.78", now-1000)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(loner.Id, newcomer, "192.0.2.2"), "another address")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(loner.Id, newcomer, ""), "no address from the order, none from the requests")

			old := registerAffiliateTestUser(t, "net_old", "")
			addressTestRequest(t, old.Id, studio, now-sharedAddressWindowSeconds-60)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(old.Id, newcomer, "192.0.2.3"), "a request older than 30 days is not an address")

			require.NoError(t, SetSubscriptionAddressExemption(c.Id, true, 1))
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), "an exempt account")
			require.NoError(t, SetSubscriptionAddressExemption(c.Id, false, 1))
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), ErrSubscriptionAddressShared)

			operation_setting.GetLimitedPlanAddressSetting().FarmEnabled = false
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), "farm switch off")
			operation_setting.GetLimitedPlanAddressSetting().FarmEnabled = true
			operation_setting.GetLimitedPlanAddressSetting().Threshold = 3
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), "two holders, threshold three")
			operation_setting.GetLimitedPlanAddressSetting().Threshold = 2

			// A plan an administrator bound is not a purchase.
			admin := &SubscriptionPlan{Title: "admin-bound", PriceAmount: 9.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			require.NoError(t, DB.Create(admin).Error)
			InvalidateSubscriptionPlanCache(admin.Id)
			t.Cleanup(func() { InvalidateSubscriptionPlanCache(admin.Id) })
			for i := range 3 {
				granted := registerAffiliateTestUser(t, fmt.Sprintf("net_granted_%d", i), "")
				addressTestRequest(t, granted.Id, studio, now-900)
				require.NoError(t, DB.Create(&UserSubscription{UserId: granted.Id, PlanId: admin.Id, Status: "active", Source: "admin",
					StartTime: now - 600, EndTime: now + 86400, CreatedAt: now - 600, UpdatedAt: now - 600}).Error)
			}
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, admin, "192.0.2.1"), "three administrator-bound holders")

			// A proxy node carries many customers who never took the plan.
			node := "198.51.100.30"
			addressTestRequest(t, c.Id, node, now-500)
			for i := range sharedExitBystanders {
				addressTestRequest(t, 400000+i, node, now-500)
			}
			addressTestRequest(t, a.Id, node, now-500)
			addressTestRequest(t, b.Id, node, now-500)
			require.NoError(t, DB.Where("user_id IN ?", []int{a.Id, b.Id}).Delete(&UserSubscription{}).Error)
			hold(a, "order")
			hold(b, "order")
			// The buyer no longer sends from the studio, only from the node.
			require.NoError(t, LOG_DB.Where("user_id = ? AND ip = ?", c.Id, studio).Delete(&Log{}).Error)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(c.Id, newcomer, "192.0.2.1"), "holders are outnumbered by bystanders on a proxy node")

			// Twenty accounts that all hold the plan are a studio, not a proxy node.
			farm := "198.51.100.40"
			for i := range sharedExitUsers {
				member := registerAffiliateTestUser(t, fmt.Sprintf("net_farm_%d", i), "")
				addressTestRequest(t, member.Id, farm, now-300)
				hold(member, "order")
			}
			farmer := registerAffiliateTestUser(t, "net_farmer", "")
			addressTestRequest(t, farmer.Id, farm, now-100)
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(farmer.Id, newcomer, "192.0.2.4"), ErrSubscriptionAddressShared)

			// A new account that has sent no request is judged by the address
			// of the purchase itself: the studio's next account is refused.
			fresh := registerAffiliateTestUser(t, "net_fresh", "")
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(fresh.Id, newcomer, farm), ErrSubscriptionAddressShared,
				"no request yet, the purchase comes from an address already holding twenty buyers")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(fresh.Id, newcomer, "192.0.2.9"), "no request yet, an unshared address")
		})
	}
}

// The two address checks have a switch each: the strict one-buyer-per-address
// check (enabled) and the per-network threshold (farm_enabled). Production
// runs the second alone, so a customer who shares an order address with a
// buyer is not refused, while accounts that send requests from one place are.
func TestLimitedPlanAddressSwitchesAreIndependent(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			previous := *operation_setting.GetLimitedPlanAddressSetting()
			t.Cleanup(func() { *operation_setting.GetLimitedPlanAddressSetting() = previous })
			set := func(strict, farm bool, threshold int) {
				*operation_setting.GetLimitedPlanAddressSetting() = operation_setting.LimitedPlanAddressSetting{Enabled: strict, FarmEnabled: farm, Threshold: threshold}
			}
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			require.NoError(t, DB.Create(newcomer).Error)
			InvalidateSubscriptionPlanCache(newcomer.Id)
			t.Cleanup(func() { InvalidateSubscriptionPlanCache(newcomer.Id) })
			hold := func(user *User) {
				t.Helper()
				require.NoError(t, DB.Create(&UserSubscription{UserId: user.Id, PlanId: newcomer.Id, Status: "active", Source: "order",
					StartTime: now - 600, EndTime: now + 86400, CreatedAt: now - 600, UpdatedAt: now - 600}).Error)
			}

			// One holder signed in from the customer's address: the strict
			// check refuses, the farm check (two holders) lets them through.
			holder := registerAffiliateTestUser(t, "sw_holder", "")
			hold(holder)
			addressTestSession(t, holder.Id, "198.51.100.7", now-600)
			customer := registerAffiliateTestUser(t, "sw_customer", "")
			set(true, false, 2)
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(customer.Id, newcomer, "198.51.100.7"), ErrSubscriptionAddressTaken, "strict on, farm off")
			set(false, true, 2)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(customer.Id, newcomer, "198.51.100.7"), "strict off, farm on: a customer who shares an address with one buyer")
			set(false, false, 2)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(customer.Id, newcomer, "198.51.100.7"), "both off")
			set(true, true, 2)
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(customer.Id, newcomer, "198.51.100.7"), ErrSubscriptionAddressTaken, "both on, the strict check answers first")

			// A studio: two holders send requests from one address, the third
			// account did too before buying and orders from another one.
			studio := "203.0.113.50"
			second := registerAffiliateTestUser(t, "sw_second", "")
			for _, member := range []*User{holder, second} {
				addressTestRequest(t, member.Id, studio, now-1200)
			}
			hold(second)
			third := registerAffiliateTestUser(t, "sw_third", "")
			addressTestRequest(t, third.Id, studio, now-300)
			set(true, false, 2)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77"), "strict on, farm off: the order address is unknown to the holders")
			set(false, true, 2)
			err := CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77")
			assert.ErrorIs(t, err, ErrSubscriptionAddressShared, "strict off, farm on")
			assert.Contains(t, err.Error(), "contact support", "the refusal says what to do")
			assert.Contains(t, err.Error(), "top-up", "and that regular top-up stays open")
			set(false, true, 3)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77"), "two holders, threshold three")
			set(false, true, 0)
			assert.ErrorIs(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77"), ErrSubscriptionAddressShared, "a threshold below one counts as one")
			set(false, true, 2)
			require.NoError(t, SetSubscriptionAddressExemption(third.Id, true, 1))
			assert.NoError(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77"), "an exempt account passes the farm check")
			require.NoError(t, SetSubscriptionAddressExemption(third.Id, false, 1))
			set(false, false, 2)
			assert.NoError(t, CheckSubscriptionPurchaseFrom(third.Id, newcomer, "192.0.2.77"), "both off")

			// The farm check reads addresses the buyer used before buying. A
			// brand-new account that has sent no request and orders from an
			// address of its own has none the holders share, so it passes: this
			// is the studio pattern of 2026-11-21, caught after the purchase by
			// relay-watch, not here.
			set(false, true, 2)
			fresh := registerAffiliateTestUser(t, "sw_fresh", "")
			assert.NoError(t, CheckSubscriptionPurchaseFrom(fresh.Id, newcomer, "192.0.2.88"), "no request yet and an address of its own")
			// Its own account limit still holds.
			hold(fresh)
			assert.Error(t, CheckSubscriptionPurchaseFrom(fresh.Id, newcomer, "192.0.2.88"), "the per-account limit")
		})
	}
}

func TestSelfInvitedCommissionDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			inviter := registerAffiliateTestUser(t, "self_inviter", "")
			keepAffiliateTestCommission(t, inviter)
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

			// A root user exempts the inviter: the account's later use earns
			// commission, and revoking the exemption stops it again.
			require.NoError(t, SetAffiliateAddressExemption(inviter.Id, true, 1))
			require.NoError(t, SetAffiliateAddressExemption(inviter.Id, true, 1), "granting twice is a no-op")
			consumeAffiliateTestQuota(t, own.Id, 20)
			settleAffiliateTestUser(t, own.Id)
			exempted := affiliateTestCredit{inviter.Id, 1, 10, int64(2 * affiliateDollar)}
			assert.Equal(t, []affiliateTestCredit{exempted}, affiliateTestCredits(t, own.Id))
			require.NoError(t, SetAffiliateAddressExemption(inviter.Id, false, 1))
			consumeAffiliateTestQuota(t, own.Id, 10)
			settleAffiliateTestUser(t, own.Id)
			assert.Equal(t, []affiliateTestCredit{exempted}, affiliateTestCredits(t, own.Id), "no commission once the exemption is revoked")

			// Behind a shared exit the address is no evidence, and the
			// commission is paid.
			for i := range sharedExitUsers {
				addressTestRequest(t, 200000+i, "198.51.100.20", now-60)
			}
			consumeAffiliateTestQuota(t, own.Id, 10)
			settleAffiliateTestUser(t, own.Id)
			assert.Equal(t, []affiliateTestCredit{exempted, {inviter.Id, 1, 10, int64(1 * affiliateDollar)}}, affiliateTestCredits(t, own.Id))
		})
	}
}
