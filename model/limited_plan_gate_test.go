package model

import (
	"context"
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
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

// limitedPlanWorld seeds the plans of the refinement tests: a paid newcomer
// plan, a free one, and a paid plan an inviter gave away.
type limitedPlanWorld struct {
	t        *testing.T
	now      int64
	newcomer *SubscriptionPlan
	free     *SubscriptionPlan
	seq      int
}

func newLimitedPlanWorld(t *testing.T, dialect string, setting operation_setting.LimitedPlanUseSetting) *limitedPlanWorld {
	t.Helper()
	useAffiliateTestDB(t, dialect)
	ResetLimitedPlanGateCache()
	t.Cleanup(ResetLimitedPlanGateCache)
	previous := *operation_setting.GetLimitedPlanUseSetting()
	*operation_setting.GetLimitedPlanUseSetting() = setting
	t.Cleanup(func() { *operation_setting.GetLimitedPlanUseSetting() = previous })
	w := &limitedPlanWorld{t: t, now: common.GetTimestamp(),
		newcomer: &SubscriptionPlan{Title: "newcomer", PriceAmount: 9.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1},
		free:     &SubscriptionPlan{Title: "free", PriceAmount: 0, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1}}
	for _, plan := range []*SubscriptionPlan{w.newcomer, w.free} {
		require.NoError(t, DB.Create(plan).Error)
		InvalidateSubscriptionPlanCache(plan.Id)
		t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
	}
	return w
}

// holder opens an account that holds the plan from source and sent one
// request from each of ips.
func (w *limitedPlanWorld) holder(plan *SubscriptionPlan, source string, ips ...string) int {
	w.t.Helper()
	w.seq++
	user := registerAffiliateTestUser(w.t, fmt.Sprintf("lp_%d", w.seq), "")
	require.NoError(w.t, DB.Create(&UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", Source: source,
		AmountTotal: 1000, StartTime: w.now - 3600, EndTime: w.now + 86400, CreatedAt: w.now - 3600, UpdatedAt: w.now - 3600}).Error)
	for _, ip := range ips {
		addressTestRequest(w.t, user.Id, ip, w.now-600)
	}
	return user.Id
}

// bystander opens an account without a plan that sent a request from ip.
func (w *limitedPlanWorld) bystander(ip string) {
	w.t.Helper()
	w.seq++
	user := registerAffiliateTestUser(w.t, fmt.Sprintf("lp_%d", w.seq), "")
	addressTestRequest(w.t, user.Id, ip, w.now-60)
}

func (w *limitedPlanWorld) gate(userId int, ip string) *LimitedPlanGate {
	return checkLimitedPlanGateAt(userId, ip, w.now)
}

func (w *limitedPlanWorld) scopeOf(userId int, ip string) string {
	if gate := w.gate(userId, ip); gate != nil {
		return gate.Scope
	}
	return ""
}

func gateSetting() operation_setting.LimitedPlanUseSetting {
	return operation_setting.LimitedPlanUseSetting{Enabled: true, Threshold: 3, ExcludeFreePlans: true, NetworkEnabled: true, NetworkThreshold: 4}
}

func TestLimitedPlanGateExcludesFreePlansDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			setting := gateSetting()
			setting.NetworkEnabled = false
			w := newLimitedPlanWorld(t, dialect, setting)

			// Three holders of a plan that costs nothing: neither gated nor counted.
			// They count as ordinary accounts when the address is tested for a shared exit,
			// so there are fewer than the five bystanders that make one.
			gifts := []int{}
			for i := 0; i < 3; i++ {
				gifts = append(gifts, w.holder(w.free, "order", "198.51.100.1"))
			}
			for _, id := range gifts {
				assert.Nil(t, w.gate(id, "198.51.100.1"), "a free plan is not guarded")
			}

			// Three paid holders share the address with them: two others, under the threshold.
			paid := []int{}
			for i := 0; i < 3; i++ {
				paid = append(paid, w.holder(w.newcomer, "order", "198.51.100.1"))
			}
			assert.Nil(t, w.gate(paid[0], "198.51.100.1"), "free holders do not count towards the threshold")

			// A paid plan an inviter gave away is free as well.
			giftOnPaid := w.holder(w.newcomer, "affiliate_gift", "198.51.100.1")
			assert.Nil(t, w.gate(giftOnPaid, "198.51.100.1"), "a gift is not guarded")
			assert.Nil(t, w.gate(paid[0], "198.51.100.1"), "a gift does not count towards the threshold")

			// A fourth buyer makes it a farm; the free holders stay clear.
			w.holder(w.newcomer, "order", "198.51.100.1")
			ResetLimitedPlanGateCache()
			gate := w.gate(paid[0], "198.51.100.1")
			require.NotNil(t, gate)
			assert.Equal(t, 3, gate.Holders)
			assert.Equal(t, LimitedPlanScopeAddress, gate.Scope)
			assert.Nil(t, w.gate(gifts[0], "198.51.100.1"), "the free holder is still clear")

			// With the switch off the free plans count again.
			operation_setting.GetLimitedPlanUseSetting().ExcludeFreePlans = false
			ResetLimitedPlanGateCache()
			assert.NotNil(t, w.gate(gifts[0], "198.51.100.1"))
		})
	}
}

func TestLimitedPlanGateNetworkDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			w := newLimitedPlanWorld(t, dialect, gateSetting())

			// Four holders, each on its own address of 203.0.113.0/24: no address
			// carries three others, and the network carries three, under four.
			holders := []int{}
			for i := 0; i < 4; i++ {
				holders = append(holders, w.holder(w.newcomer, "order", fmt.Sprintf("203.0.113.%d", 10+i)))
			}
			for i, id := range holders {
				assert.Empty(t, w.scopeOf(id, fmt.Sprintf("203.0.113.%d", 10+i)))
			}

			// A fifth makes four others: every holder is gated, from an address of
			// their own, and from one nobody used.
			fifth := w.holder(w.newcomer, "order", "203.0.113.99")
			ResetLimitedPlanGateCache()
			gate := w.gate(holders[0], "203.0.113.10")
			require.NotNil(t, gate)
			assert.Equal(t, LimitedPlanScopeNetwork, gate.Scope)
			assert.Equal(t, 4, gate.Holders)
			assert.Equal(t, LimitedPlanScopeNetwork, w.scopeOf(fifth, "203.0.113.200"))
			assert.Empty(t, w.scopeOf(holders[0], "203.0.114.10"), "a neighbouring network carries nobody")

			// The network threshold is its own option.
			operation_setting.GetLimitedPlanUseSetting().NetworkThreshold = 5
			ResetLimitedPlanGateCache()
			assert.Empty(t, w.scopeOf(holders[0], "203.0.113.10"))
			operation_setting.GetLimitedPlanUseSetting().NetworkThreshold = 4
			operation_setting.GetLimitedPlanUseSetting().NetworkEnabled = false
			ResetLimitedPlanGateCache()
			assert.Empty(t, w.scopeOf(holders[0], "203.0.113.10"), "the network check is off")
			operation_setting.GetLimitedPlanUseSetting().NetworkEnabled = true
			ResetLimitedPlanGateCache()

			// The address threshold still wins and names the address.
			farm := []int{}
			for i := 0; i < 4; i++ {
				farm = append(farm, w.holder(w.newcomer, "order", "192.0.2.7"))
			}
			assert.Equal(t, LimitedPlanScopeAddress, w.scopeOf(farm[0], "192.0.2.7"))

			// A shared exit by network: unrelated accounts across the /24 outnumber the holders.
			exit := []int{}
			for i := 0; i < 5; i++ {
				exit = append(exit, w.holder(w.newcomer, "order", fmt.Sprintf("198.18.0.%d", 20+i)))
			}
			for i := 0; i < 6; i++ {
				w.bystander(fmt.Sprintf("198.18.0.%d", 100+i))
			}
			ResetLimitedPlanGateCache()
			assert.Empty(t, w.scopeOf(exit[0], "198.18.0.20"), "a campus or proxy block is not a farm")

			// An IPv6 network is the /64.
			six := []int{}
			for i := 0; i < 5; i++ {
				six = append(six, w.holder(w.newcomer, "order", fmt.Sprintf("2001:db8:1:2::%x", 10+i)))
			}
			ResetLimitedPlanGateCache()
			assert.Equal(t, LimitedPlanScopeNetwork, w.scopeOf(six[0], "2001:db8:1:2:aaaa:bbbb:cccc:dddd"))
			assert.Empty(t, w.scopeOf(six[0], "2001:db8:1:3::1"), "another /64")
		})
	}
}

// spend adds a consumed request of quota from ip to the account.
func (w *limitedPlanWorld) spend(userId int, ip string, dollars float64) {
	w.t.Helper()
	require.NoError(w.t, LOG_DB.Create(&Log{UserId: userId, CreatedAt: w.now - 300, Type: LogTypeConsume, Ip: ip,
		Quota: int(dollars * common.QuotaPerUnit)}).Error)
}

// payer opens an account without a plan that spent dollars through ip.
func (w *limitedPlanWorld) payer(ip string, dollars float64) int {
	w.t.Helper()
	w.seq++
	user := registerAffiliateTestUser(w.t, fmt.Sprintf("lp_%d", w.seq), "")
	w.spend(user.Id, ip, dollars)
	return user.Id
}

func (w *limitedPlanWorld) verdict(userId int, ip string) (string, string) {
	gate, exit := checkLimitedPlanVerdictAt(userId, ip, w.now)
	if gate == nil {
		return "", exit
	}
	return gate.Scope, exit
}

// A block an administrator lists is not counted per network; its addresses are.
func TestLimitedPlanGateListedExitDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			w := newLimitedPlanWorld(t, dialect, gateSetting())

			// Five accounts, each on an address of its own in 203.0.113.0/24 and
			// each rotating through a second one: the shape of a studio behind
			// a proxy pool, and of a newcomer that bought the plan behind one.
			pool := []int{}
			for i := 0; i < 5; i++ {
				pool = append(pool, w.holder(w.newcomer, "order", fmt.Sprintf("203.0.113.%d", 10+i), fmt.Sprintf("203.0.113.%d", 110+i)))
			}
			ResetLimitedPlanGateCache()
			scope, exit := w.verdict(pool[0], "203.0.113.10")
			assert.Equal(t, LimitedPlanScopeNetwork, scope, "unlisted, the block is a farm")
			assert.Empty(t, exit)

			operation_setting.GetLimitedPlanUseSetting().SharedExitNetworks = "198.51.100.0/24, 203.0.113.0/24"
			ResetLimitedPlanGateCache()
			ResetLimitedPlanGateCache()
			fresh := w.holder(w.newcomer, "order", "203.0.113.77")
			scope, exit = w.verdict(fresh, "203.0.113.77")
			assert.Empty(t, scope, "listed, the block is not counted per network")
			assert.Equal(t, LimitedPlanExitListed, exit, "and the log says why")
			scope, exit = w.verdict(pool[0], "203.0.113.200")
			assert.Empty(t, scope, "nor from an address nobody used")
			assert.Equal(t, LimitedPlanExitListed, exit)
			assert.Empty(t, w.scopeOf(pool[1], "203.0.113.11"))
			scope, exit = w.verdict(pool[0], "203.0.114.5")
			assert.Empty(t, scope)
			assert.Empty(t, exit, "a neighbouring block is not listed and carries nobody")

			// An address of the listed block that three others hold is a farm of its own.
			farm := []int{}
			for i := 0; i < 4; i++ {
				farm = append(farm, w.holder(w.newcomer, "order", "203.0.113.50"))
			}
			scope, _ = w.verdict(farm[0], "203.0.113.50")
			assert.Equal(t, LimitedPlanScopeAddress, scope, "a listed block still counts its addresses")

			// The log reads "listed" only when the network would have gated.
			quiet := w.holder(w.newcomer, "order", "198.51.100.9")
			scope, exit = w.verdict(quiet, "198.51.100.9")
			assert.Empty(t, scope)
			assert.Empty(t, exit, "a listed block with no other holders spared nothing")

			// Removing the entry brings the network back.
			operation_setting.GetLimitedPlanUseSetting().SharedExitNetworks = ""
			ResetLimitedPlanGateCache()
			assert.Equal(t, LimitedPlanScopeNetwork, w.scopeOf(pool[0], "203.0.113.10"))
		})
	}
}

// A block where customers without a plan paid is a proxy exit, however its holders move.
func TestLimitedPlanGateTrafficExitDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			w := newLimitedPlanWorld(t, dialect, gateSetting())

			// A rotating studio: five holders spent $10 each and nobody else did.
			studio := []int{}
			for i := 0; i < 5; i++ {
				id := w.holder(w.newcomer, "order", fmt.Sprintf("203.0.113.%d", 10+i))
				w.spend(id, fmt.Sprintf("203.0.113.%d", 10+i), 10)
				studio = append(studio, id)
			}
			scope, exit := w.verdict(studio[0], "203.0.113.10")
			assert.Equal(t, LimitedPlanScopeNetwork, scope)
			assert.Empty(t, exit)

			// Two customers without a plan spent $10: under the $20 floor.
			w.payer("203.0.113.130", 5)
			w.payer("203.0.113.131", 5)
			ResetLimitedPlanGateCache()
			scope, _ = w.verdict(studio[0], "203.0.113.10")
			assert.Equal(t, LimitedPlanScopeNetwork, scope, "$10 of $50 is not a proxy's traffic")

			// $20 of $50 reaches the floor but not half of what the holders spent.
			w.payer("203.0.113.132", 10)
			ResetLimitedPlanGateCache()
			scope, _ = w.verdict(studio[0], "203.0.113.10")
			assert.Equal(t, LimitedPlanScopeNetwork, scope, "$20 of $50 is under half")

			// $25 is half of $50: a proxy exit, at the network and for each holder.
			w.payer("203.0.113.133", 5)
			ResetLimitedPlanGateCache()
			scope, exit = w.verdict(studio[0], "203.0.113.10")
			assert.Empty(t, scope)
			assert.Equal(t, LimitedPlanExitTraffic, exit)
			scope, exit = w.verdict(studio[4], "203.0.113.14")
			assert.Empty(t, scope)
			assert.Equal(t, LimitedPlanExitTraffic, exit)

			// The same traffic on one address spares that address.
			one := []int{}
			for i := 0; i < 4; i++ {
				id := w.holder(w.newcomer, "order", "192.0.2.7")
				w.spend(id, "192.0.2.7", 10)
				one = append(one, id)
			}
			scope, _ = w.verdict(one[0], "192.0.2.7")
			assert.Equal(t, LimitedPlanScopeAddress, scope, "a single address with no other traffic is a farm")
			w.payer("192.0.2.7", 20)
			ResetLimitedPlanGateCache()
			scope, exit = w.verdict(one[0], "192.0.2.7")
			assert.Empty(t, scope)
			assert.Equal(t, LimitedPlanExitTraffic, exit)

			// A customer's plan spending counts towards the holders' side,
			// and the customer who asks is one of the holders.
			assert.Empty(t, w.scopeOf(one[1], "192.0.2.7"))

			// An error log carries no spending; failed requests do not make a proxy.
			e := []int{}
			for i := 0; i < 4; i++ {
				id := w.holder(w.newcomer, "order", "192.0.2.9")
				w.spend(id, "192.0.2.9", 10)
				e = append(e, id)
			}
			w.seq++
			victim := registerAffiliateTestUser(t, fmt.Sprintf("lp_%d", w.seq), "")
			require.NoError(t, LOG_DB.Create(&Log{UserId: victim.Id, CreatedAt: w.now - 30, Type: LogTypeError, Ip: "192.0.2.9", Quota: int(100 * common.QuotaPerUnit)}).Error)
			ResetLimitedPlanGateCache()
			scope, _ = w.verdict(e[0], "192.0.2.9")
			assert.Equal(t, LimitedPlanScopeAddress, scope)
		})
	}
}

// The log marker also names the older test, many accounts without a plan.
func TestLimitedPlanGateCrowdExitMarker(t *testing.T) {
	w := newLimitedPlanWorld(t, "sqlite", gateSetting())
	holders := []int{}
	for i := 0; i < 4; i++ {
		holders = append(holders, w.holder(w.newcomer, "order", "198.51.100.1"))
	}
	for i := 0; i < 5; i++ {
		w.bystander("198.51.100.1")
	}
	ResetLimitedPlanGateCache()
	scope, exit := w.verdict(holders[0], "198.51.100.1")
	assert.Empty(t, scope)
	assert.Equal(t, LimitedPlanExitCrowd, exit)
	scope, exit = w.verdict(w.holder(w.newcomer, "order", "203.0.113.5"), "203.0.113.5")
	assert.Empty(t, scope)
	assert.Empty(t, exit, "an address nobody shares spared nothing")
}

func TestLimitedPlanListedNetworks(t *testing.T) {
	assert.Empty(t, limitedPlanListedNetworks(""))
	got := limitedPlanListedNetworks("185.220.236.0/24, 203.0.113.9\n2001:db8:1:2::/64;not-a-network ::ffff:198.51.100.0/120 10.0.0.1/99")
	var texts []string
	for _, prefix := range got {
		texts = append(texts, prefix.String())
	}
	assert.Equal(t, []string{"185.220.236.0/24", "203.0.113.9/32", "2001:db8:1:2::/64", "198.51.100.0/24"}, texts)

	setting := operation_setting.GetLimitedPlanUseSetting()
	previous := setting.SharedExitNetworks
	t.Cleanup(func() { setting.SharedExitNetworks = previous })
	setting.SharedExitNetworks = "185.220.236.0/24"
	assert.True(t, limitedPlanListedExit("185.220.236.155"))
	assert.True(t, limitedPlanListedExit("::ffff:185.220.236.9"))
	assert.False(t, limitedPlanListedExit("185.220.237.1"))
	assert.False(t, limitedPlanListedExit("not an address"))
	setting.SharedExitNetworks = "2001:db8:1:2::/64"
	assert.False(t, limitedPlanListedExit("185.220.236.155"), "a changed option is read again")
	assert.True(t, limitedPlanListedExit("2001:db8:1:2:aaaa::1"))
}

func TestLimitedPlanNetworkOf(t *testing.T) {
	assert.Equal(t, "103.135.100.", LimitedPlanNetworkOf("103.135.100.181"))
	assert.Equal(t, "103.135.100.", LimitedPlanNetworkOf("::ffff:103.135.100.7"))
	assert.Equal(t, "2001:db8:1:2:", LimitedPlanNetworkOf("2001:db8:1:2::5"))
	assert.Equal(t, "2408:8207:abcd:ef:", LimitedPlanNetworkOf("2408:8207:abcd:00ef:1:2:3:4"))
	assert.Empty(t, LimitedPlanNetworkOf("not an address"))
	assert.Empty(t, LimitedPlanNetworkOf(""))
}

func TestLimitedPlanGateStickyDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			setting := gateSetting()
			setting.StickyDays = 7
			w := newLimitedPlanWorld(t, dialect, setting)
			farm := []int{}
			for i := 0; i < 4; i++ {
				farm = append(farm, w.holder(w.newcomer, "order", "117.150.5.21"))
			}
			const clean = "119.246.95.21"

			// A fifth holder never used the farm's address.
			other := w.holder(w.newcomer, "order", "192.0.2.50")

			// A holder that never used a gated address is served from a clean one.
			assert.Empty(t, w.scopeOf(other, clean))

			// The farm's requests were made from the gated address, so its accounts are
			// gated from a clean one too, before and after the first gated request.
			assert.Equal(t, LimitedPlanScopeSticky, w.scopeOf(farm[0], clean), "found in the logs")
			assert.Equal(t, LimitedPlanScopeAddress, w.scopeOf(farm[0], "117.150.5.21"))
			assert.Equal(t, LimitedPlanScopeSticky, w.scopeOf(farm[0], clean))
			assert.Empty(t, w.scopeOf(other, clean), "the mark is the account's, not the farm's")

			// A customer who holds no guarded plan is not gated by a mark.
			bystander := registerAffiliateTestUser(t, "lp_bystander", "")
			assert.Empty(t, w.scopeOf(bystander.Id, clean))

			// An exempt account is not gated by a mark.
			require.NoError(t, SetSubscriptionAddressExemption(farm[0], true, 1))
			assert.Nil(t, w.gate(farm[0], clean))
			assert.Nil(t, w.gate(farm[0], "117.150.5.21"))
			require.NoError(t, SetSubscriptionAddressExemption(farm[0], false, 1))

			// The mark is forgotten with the process: the account's own requests
			// from the gated address bring it back.
			ResetLimitedPlanGateCache()
			assert.Equal(t, LimitedPlanScopeSticky, w.scopeOf(farm[0], clean), "recomputed from the logs")
			assert.Equal(t, LimitedPlanScopeSticky, w.scopeOf(farm[2], clean), "every account that used the gated address is found")
			assert.Empty(t, w.scopeOf(other, clean), "an account that did not is not")

			// It runs out after the sticky days, and the old requests age out of the lookback.
			later := w.now + 8*86400
			assert.Nil(t, checkLimitedPlanGateAt(farm[0], clean, later))

			// Off, the mark is neither read nor written.
			operation_setting.GetLimitedPlanUseSetting().StickyDays = 0
			ResetLimitedPlanGateCache()
			assert.Equal(t, LimitedPlanScopeAddress, w.scopeOf(farm[3], "117.150.5.21"), "the address still gates")
			assert.Empty(t, w.scopeOf(farm[3], clean), "and writes no mark")
			assert.Empty(t, w.scopeOf(farm[0], clean))
		})
	}
}

// The mark is shared between servers through Redis.
func TestLimitedPlanGateStickyRedis(t *testing.T) {
	setting := gateSetting()
	setting.StickyDays = 7
	w := newLimitedPlanWorld(t, "sqlite", setting)
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	require.NoError(t, client.Ping(context.Background()).Err())
	previousEnabled, previousClient := common.RedisEnabled, common.RDB
	common.RedisEnabled, common.RDB = true, client
	t.Cleanup(func() {
		_ = client.Close()
		common.RedisEnabled, common.RDB = previousEnabled, previousClient
	})

	farm := []int{}
	for i := 0; i < 4; i++ {
		farm = append(farm, w.holder(w.newcomer, "order", "117.150.5.21"))
	}
	assert.Equal(t, LimitedPlanScopeAddress, w.scopeOf(farm[0], "117.150.5.21"))
	key := fmt.Sprintf("%s%d", limitedPlanStickyKey, farm[0])
	assert.True(t, server.Exists(key), "the mark is in Redis")
	assert.InDelta(t, 7*86400, server.TTL(key).Seconds(), 5)

	// Another server has no cache and no logs of its own for this address.
	require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)
	ResetLimitedPlanGateCache()
	assert.Equal(t, LimitedPlanScopeSticky, w.scopeOf(farm[0], "119.246.95.21"))
	assert.Empty(t, w.scopeOf(farm[1], "119.246.95.21"))
}
