package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The newcomer plan is gated at billing time by the other holders that sent
// requests from the request's address.
func TestLimitedPlanGateDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			ResetLimitedPlanGateCache()
			t.Cleanup(ResetLimitedPlanGateCache)
			now := common.GetTimestamp()
			previous := *operation_setting.GetLimitedPlanUseSetting()
			*operation_setting.GetLimitedPlanUseSetting() = operation_setting.LimitedPlanUseSetting{Enabled: true, Threshold: 3}
			t.Cleanup(func() { *operation_setting.GetLimitedPlanUseSetting() = previous })
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			monthly := &SubscriptionPlan{Title: "monthly", PriceAmount: 99, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true}
			for _, plan := range []*SubscriptionPlan{newcomer, monthly} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}
			hold := func(user *User, plan *SubscriptionPlan, source string, status string) *UserSubscription {
				t.Helper()
				sub := &UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: status, Source: source,
					AmountTotal: 1000, StartTime: now - 3600, EndTime: now + 86400, CreatedAt: now - 3600, UpdatedAt: now - 3600}
				require.NoError(t, DB.Create(sub).Error)
				return sub
			}
			farm := func(prefix string, count int, ip string) []*UserSubscription {
				t.Helper()
				subs := make([]*UserSubscription, 0, count)
				for i := 0; i < count; i++ {
					user := registerAffiliateTestUser(t, fmt.Sprintf("%s_%d", prefix, i), "")
					subs = append(subs, hold(user, newcomer, "order", "active"))
					addressTestRequest(t, user.Id, ip, now-600)
				}
				return subs
			}

			// Below the threshold the plan serves the address: three holders see two others each.
			small := farm("small", 3, "198.51.100.1")
			for _, sub := range small {
				assert.Nil(t, CheckLimitedPlanGate(sub.UserId, "198.51.100.1"), "two other holders are under the threshold")
			}

			// At the threshold, every holder is gated: each sees three others.
			big := farm("big", 4, "198.51.100.2")
			for _, sub := range big {
				gate := CheckLimitedPlanGate(sub.UserId, "198.51.100.2")
				require.NotNil(t, gate, "three other holders reach the threshold")
				assert.Equal(t, []int{sub.Id}, gate.SubscriptionIds)
				assert.Equal(t, 3, gate.Holders)
			}
			assert.Nil(t, CheckLimitedPlanGate(big[0].UserId, "198.51.100.3"), "another address carries no holders")
			assert.Nil(t, CheckLimitedPlanGate(big[0].UserId, ""), "no address, no verdict")

			// A customer who holds no plan limited per user is never gated, whatever the address.
			bystander := registerAffiliateTestUser(t, "bystander", "")
			hold(bystander, monthly, "order", "active")
			addressTestRequest(t, bystander.Id, "198.51.100.2", now-60)
			assert.Nil(t, CheckLimitedPlanGate(bystander.Id, "198.51.100.2"), "a monthly plan is not limited per user")

			// Holders given by an administrator are staff, and a plan that ran out still marks its holder.
			staff := farm("staff", 4, "198.51.100.4")
			require.NoError(t, DB.Model(&UserSubscription{}).Where("id <> ? AND id IN ?", staff[0].Id, []int{staff[1].Id, staff[2].Id, staff[3].Id}).
				Update("source", "admin").Error)
			assert.Nil(t, CheckLimitedPlanGate(staff[0].UserId, "198.51.100.4"), "three administrator grants are not holders")

			spent := farm("spent", 4, "198.51.100.5")
			require.NoError(t, DB.Model(&UserSubscription{}).Where("id IN ?", []int{spent[1].Id, spent[2].Id, spent[3].Id}).
				Update("status", "expired").Error)
			require.NotNil(t, CheckLimitedPlanGate(spent[0].UserId, "198.51.100.5"), "holders whose plan ran out still count")
			assert.Nil(t, CheckLimitedPlanGate(spent[1].UserId, "198.51.100.5"), "a customer with no active plan has nothing to gate")

			// An exempt customer is served, and the next one is not.
			require.NoError(t, SetSubscriptionAddressExemption(big[0].UserId, true, 1))
			assert.Nil(t, CheckLimitedPlanGate(big[0].UserId, "198.51.100.2"))
			assert.NotNil(t, CheckLimitedPlanGate(big[1].UserId, "198.51.100.2"))

			// A shared exit is not a farm: six accounts that never took such a plan
			// used the address, as many as the four holders or more.
			exitHolders := farm("exit", 4, "198.51.100.6")
			for i := 0; i < 6; i++ {
				user := registerAffiliateTestUser(t, fmt.Sprintf("exit_bystander_%d", i), "")
				addressTestRequest(t, user.Id, "198.51.100.6", now-60)
			}
			assert.Nil(t, CheckLimitedPlanGate(exitHolders[0].UserId, "198.51.100.6"), "a proxy node carries many unrelated accounts")

			// Few bystanders do not make an exit: five on an address of forty holders.
			crowd := farm("crowd", 8, "198.51.100.7")
			for i := 0; i < 5; i++ {
				user := registerAffiliateTestUser(t, fmt.Sprintf("crowd_bystander_%d", i), "")
				addressTestRequest(t, user.Id, "198.51.100.7", now-60)
			}
			assert.NotNil(t, CheckLimitedPlanGate(crowd[0].UserId, "198.51.100.7"), "five bystanders among eight holders is a farm")

			// Requests older than 30 days do not count.
			old := farm("old", 4, "198.51.100.8")
			require.NoError(t, LOG_DB.Model(&Log{}).Where("ip = ?", "198.51.100.8").Update("created_at", now-31*86400).Error)
			assert.Nil(t, CheckLimitedPlanGate(old[0].UserId, "198.51.100.8"))

			// The threshold is an option.
			operation_setting.GetLimitedPlanUseSetting().Threshold = 4
			assert.Nil(t, CheckLimitedPlanGate(big[1].UserId, "198.51.100.2"), "three others are under a threshold of four")
			operation_setting.GetLimitedPlanUseSetting().Threshold = 0
			assert.NotNil(t, CheckLimitedPlanGate(small[0].UserId, "198.51.100.1"), "a threshold below one counts as one")
			operation_setting.GetLimitedPlanUseSetting().Threshold = 3

			// The holders of an address are remembered for a while: a request that
			// arrives after the logs are gone still reads them.
			require.NoError(t, LOG_DB.Where("ip = ?", "198.51.100.2").Delete(&Log{}).Error)
			assert.NotNil(t, CheckLimitedPlanGate(big[1].UserId, "198.51.100.2"), "cached")
			ResetLimitedPlanGateCache()
			assert.Nil(t, CheckLimitedPlanGate(big[1].UserId, "198.51.100.2"), "forgotten")

			// With the switch off the gate never decides.
			operation_setting.GetLimitedPlanUseSetting().Enabled = false
			assert.Nil(t, CheckLimitedPlanGate(spent[0].UserId, "198.51.100.5"))
		})
	}
}

// A gated subscription sits out of the reservation and another one pays it.
func TestPreConsumeUserSubscriptionExceptDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			now := common.GetTimestamp()
			newcomer := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}
			monthly := &SubscriptionPlan{Title: "monthly", PriceAmount: 99, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true}
			for _, plan := range []*SubscriptionPlan{newcomer, monthly} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}
			user := registerAffiliateTestUser(t, "except_user", "")
			gifted := &UserSubscription{UserId: user.Id, PlanId: newcomer.Id, Status: "active", Source: "order", AllowWalletOverflow: true,
				AmountTotal: 1000, StartTime: now - 60, EndTime: now + 3600, CreatedAt: now - 60, UpdatedAt: now - 60}
			require.NoError(t, DB.Create(gifted).Error)

			ok, err := HasActiveUserSubscriptionExcept(user.Id, []int{gifted.Id})
			require.NoError(t, err)
			assert.False(t, ok)
			ok, err = HasActiveUserSubscriptionExcept(user.Id, nil)
			require.NoError(t, err)
			assert.True(t, ok)

			_, err = PreConsumeUserSubscriptionExcept("req-except-1", user.Id, 100, false, []int{gifted.Id})
			require.Error(t, err, "the only subscription sits out")
			assert.Contains(t, err.Error(), "no active subscription")
			require.NoError(t, DB.First(gifted, gifted.Id).Error)
			assert.Zero(t, gifted.AmountUsed)

			paid := &UserSubscription{UserId: user.Id, PlanId: monthly.Id, Status: "active", Source: "order", AllowWalletOverflow: false,
				AmountTotal: 1000, StartTime: now - 60, EndTime: now + 7200, CreatedAt: now - 60, UpdatedAt: now - 60}
			require.NoError(t, DB.Create(paid).Error)
			allowed, err := UserActiveSubscriptionsAllowWalletOverflowExcept(user.Id, []int{paid.Id})
			require.NoError(t, err)
			assert.True(t, allowed, "the gated plan's flag is not read; the other's is")
			allowed, err = UserActiveSubscriptionsAllowWalletOverflowExcept(user.Id, nil)
			require.NoError(t, err)
			assert.False(t, allowed)

			result, err := PreConsumeUserSubscriptionExcept("req-except-2", user.Id, 100, false, []int{gifted.Id})
			require.NoError(t, err)
			assert.Equal(t, paid.Id, result.UserSubscriptionId, "the other subscription pays although the gated one ends sooner")
			require.NoError(t, DB.First(gifted, gifted.Id).Error)
			assert.Zero(t, gifted.AmountUsed)

			// Without the exception the one that ends first is used.
			result, err = PreConsumeUserSubscriptionExcept("req-except-3", user.Id, 100, false, nil)
			require.NoError(t, err)
			assert.Equal(t, gifted.Id, result.UserSubscriptionId)
		})
	}
}
