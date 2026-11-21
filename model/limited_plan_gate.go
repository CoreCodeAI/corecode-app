package model

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"golang.org/x/sync/singleflight"
)

// Values of the limited_plan_ip_gate marker a request's log carries.
const (
	// LimitedPlanGateWallet marks a request charged to the wallet because its
	// address was gated.
	LimitedPlanGateWallet = "wallet"
	// LimitedPlanGateRefused marks a request turned away because its address
	// was gated and the wallet could not pay.
	LimitedPlanGateRefused = "refused"
	// LimitedPlanGateOtherPlan marks a request charged to another plan the
	// customer holds while the gated plan sat out.
	LimitedPlanGateOtherPlan = "other_plan"
)

// The newcomer plan is bought one per account, so a studio opens accounts, and
// the purchase checks (CheckSubscriptionPurchaseFrom) cannot see the address
// that gives it away: every order comes from a different proxy, and the
// requests start minutes later from one place. On 2026-11-21, 44 accounts
// bought it in turn and sent their requests from 117.150.5.21.
//
// The gate runs when a request is billed, where the request's address is known.
// A request whose address already carries limitedPlanUseSetting.Threshold other
// accounts that used it and hold a plan limited per user is not charged to the
// plan; see LimitedPlanGate.

// limitedPlanGateTTL is how long the holders of an address are remembered. A
// request pays one lookup per address per window, not one per request.
const limitedPlanGateTTL = 60 * time.Second

// limitedPlanGateMaxAddresses bounds the cache; past it, expired entries go
// first and then the cache starts over.
const limitedPlanGateMaxAddresses = 20000

// LimitedPlanGate is the verdict that an address may not draw on the plans
// limited per user a customer holds.
type LimitedPlanGate struct {
	// SubscriptionIds are the customer's active subscriptions of such plans,
	// which sit out of this request.
	SubscriptionIds []int
	// Holders counts the other accounts that used the address and hold a
	// plan limited per user.
	Holders int
}

type limitedPlanAddress struct {
	expires int64
	holders map[int]bool
	ip      string
	exit    sync.Once
	isExit  bool
}

var (
	limitedPlanAddressMu    sync.Mutex
	limitedPlanAddressCache = map[string]*limitedPlanAddress{}
	limitedPlanAddressGroup singleflight.Group
)

// ResetLimitedPlanGateCache forgets every address, for tests. Exemptions and
// the customer's subscriptions are read on each request, not cached.
func ResetLimitedPlanGateCache() {
	limitedPlanAddressMu.Lock()
	defer limitedPlanAddressMu.Unlock()
	limitedPlanAddressCache = map[string]*limitedPlanAddress{}
}

// CheckLimitedPlanGate decides whether the request of userId from ip may be
// charged to the plans limited per user the customer holds. It returns nil
// when it may, which is every request of a customer who holds none, and
// the gate when it may not:
//   - the address was used by at least the threshold of other accounts that
//     hold such a plan, in the last 30 days (a request in the logs);
//   - it is not a shared exit: five or more accounts used it that hold no such
//     plan and they are no fewer than the holders, the test the purchase check
//     uses (checkLimitedPlanAddressFarm);
//   - the customer is not exempt (subscriptionAddressExempt).
//
// A failed lookup lets the request through: billing is not worth refusing for.
func CheckLimitedPlanGate(userId int, ip string) *LimitedPlanGate {
	setting := operation_setting.GetLimitedPlanUseSetting()
	if !setting.Enabled || ip == "" || userId <= 0 {
		return nil
	}
	now := common.GetTimestamp()
	var owned []int
	if err := DB.Table("user_subscriptions").
		Joins("JOIN subscription_plans ON subscription_plans.id = user_subscriptions.plan_id").
		Where("user_subscriptions.user_id = ? AND user_subscriptions.status = ? AND user_subscriptions.end_time > ? AND subscription_plans.max_purchase_per_user > 0",
			userId, "active", now).
		Pluck("user_subscriptions.id", &owned).Error; err != nil {
		common.SysLog(common.LogText("limited plan gate: reading the subscriptions of user %d: %s", userId, err.Error()))
		return nil
	}
	if len(owned) == 0 {
		return nil
	}
	address, err := limitedPlanAddressOf(ip, now)
	if err != nil {
		common.SysLog(common.LogText("limited plan gate: reading address %s: %s", ip, err.Error()))
		return nil
	}
	holders := len(address.holders)
	if address.holders[userId] {
		holders--
	}
	if holders < max(setting.Threshold, 1) {
		return nil
	}
	if address.isSharedExit(now) {
		return nil
	}
	if exempt, err := subscriptionAddressExempt(userId); err != nil || exempt {
		return nil
	}
	return &LimitedPlanGate{SubscriptionIds: owned, Holders: holders}
}

// limitedPlanAddressOf returns the accounts that sent requests from ip in
// the last 30 days and hold a plan limited per user, from the cache while it
// is fresh. Concurrent requests of a farm share one lookup.
func limitedPlanAddressOf(ip string, now int64) (*limitedPlanAddress, error) {
	limitedPlanAddressMu.Lock()
	cached := limitedPlanAddressCache[ip]
	limitedPlanAddressMu.Unlock()
	if cached != nil && cached.expires > now {
		return cached, nil
	}
	result, err, _ := limitedPlanAddressGroup.Do(ip, func() (any, error) {
		holders, err := limitedPlanHoldersAt(ip, now)
		if err != nil {
			return nil, err
		}
		entry := &limitedPlanAddress{expires: now + int64(limitedPlanGateTTL/time.Second), holders: holders, ip: ip}
		limitedPlanAddressMu.Lock()
		defer limitedPlanAddressMu.Unlock()
		if len(limitedPlanAddressCache) >= limitedPlanGateMaxAddresses {
			for key, old := range limitedPlanAddressCache {
				if old.expires <= now {
					delete(limitedPlanAddressCache, key)
				}
			}
			if len(limitedPlanAddressCache) >= limitedPlanGateMaxAddresses {
				limitedPlanAddressCache = map[string]*limitedPlanAddress{}
			}
		}
		limitedPlanAddressCache[ip] = entry
		return entry, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*limitedPlanAddress), nil
}

// limitedPlanHoldersAt reads the accounts that sent requests from ip since 30
// days before now and hold a plan limited per user, not given by an
// administrator.
func limitedPlanHoldersAt(ip string, now int64) (map[int]bool, error) {
	since := now - sharedAddressWindowSeconds
	var requesters []int
	if err := LOG_DB.Model(&Log{}).Where("ip = ? AND created_at > ? AND type IN ?", ip, since,
		[]int{LogTypeConsume, LogTypeError}).Distinct().Pluck("user_id", &requesters).Error; err != nil {
		return nil, err
	}
	return limitedPlanHoldersAmong(requesters)
}

// limitedPlanHoldersAmong returns the users among userIds that hold, or held,
// a plan limited per user: bought, or given by an inviter. An administrator's
// grant is staff, not a farm.
func limitedPlanHoldersAmong(userIds []int) (map[int]bool, error) {
	holders := map[int]bool{}
	for start := 0; start < len(userIds); start += sharedAddressChunk {
		chunk := userIds[start:min(start+sharedAddressChunk, len(userIds))]
		var held []int
		if err := DB.Table("user_subscriptions").
			Joins("JOIN subscription_plans ON subscription_plans.id = user_subscriptions.plan_id").
			Where("subscription_plans.max_purchase_per_user > 0 AND user_subscriptions.user_id IN ? AND user_subscriptions.source <> ?", chunk, "admin").
			Distinct().Pluck("user_subscriptions.user_id", &held).Error; err != nil {
			return nil, err
		}
		for _, id := range held {
			holders[id] = true
		}
	}
	return holders, nil
}

// isSharedExit reports whether the address is a proxy or NAT exit rather than
// one person's: at least sharedExitBystanders accounts used it, by request,
// sign-in or order, that hold no plan limited per user, and they are no
// fewer than the accounts that do. The farm's own accounts all send requests,
// so sharedExit's other test, many requesters in a week, is not used: forty
// accounts of one studio would pass for a proxy node. A failed lookup counts
// as a shared exit, which lets the request through. The answer is kept with
// the address.
func (a *limitedPlanAddress) isSharedExit(now int64) bool {
	a.exit.Do(func() {
		users, err := addressUsers(a.ip, now-sharedAddressWindowSeconds, nil)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading users of %s: %s", a.ip, err.Error()))
			a.isExit = true
			return
		}
		held, err := limitedPlanHoldersAmong(users)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading holders among users of %s: %s", a.ip, err.Error()))
			a.isExit = true
			return
		}
		for id := range a.holders {
			held[id] = true
		}
		bystanders := 0
		for _, id := range users {
			if !held[id] {
				bystanders++
			}
		}
		a.isExit = bystanders >= sharedExitBystanders && bystanders >= len(held)
	})
	return a.isExit
}
