package model

import (
	"errors"
	"fmt"
	"net/netip"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/go-redis/redis/v8"
	"golang.org/x/sync/singleflight"
	"gorm.io/gorm"
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

// Values of the limited_plan_ip_gate_exit marker: why a scope that carries
// enough holders did not gate a request, because it is a shared exit.
const (
	// LimitedPlanExitListed is a block an administrator listed in
	// SharedExitNetworks; its network is not counted.
	LimitedPlanExitListed = "listed"
	// LimitedPlanExitCrowd is a scope used by many accounts that hold no plan
	// limited per user.
	LimitedPlanExitCrowd = "crowd"
	// LimitedPlanExitTraffic is a scope where accounts that hold no such plan
	// spent real money, comparable to what the holders spent.
	LimitedPlanExitTraffic = "traffic"
	// LimitedPlanExitUnread is a scope that could not be read; the request is
	// let through.
	LimitedPlanExitUnread = "unread"
)

// A proxy exit that sells to the public carries customers who pay for what
// they use. A studio's address carries the accounts it opened and nothing
// else: on 2026-11-22 the holders of 185.220.236.0/24, a proxy block, had
// spent $286 in 30 days and the accounts without a plan $249, while the
// blocks of the two studios of 11-21 had $6 against $564, and $0 against
// $3,501. A scope whose accounts without a plan spent at least
// limitedPlanTrafficMinUSD dollars, and at least limitedPlanTrafficShare of what
// its holders spent, is a shared exit.
const (
	limitedPlanTrafficMinUSD = 20
	limitedPlanTrafficShare  = 0.5
)

// The newcomer plan is bought one per account, so a studio opens accounts, and
// the purchase checks (CheckSubscriptionPurchaseFrom) cannot see the address
// that gives it away: every order comes from a different proxy, and the
// requests start minutes later from one place. On 2026-11-21, 44 accounts
// bought it in turn and sent their requests from 117.150.5.21. A second
// studio bought it on seven accounts, sent their requests from a block of
// addresses (103.135.100.0/24) that rotate, and moved an account to a new
// address when it was caught.
//
// The gate runs when a request is billed, where the request's address is known.
// A request is not charged to the plans limited per user the customer holds
// when its address, or its network (an IPv4 /24, an IPv6 /64), already carries
// other accounts that used it and hold such a plan, or when the customer used
// such an address or network in the last limitedPlanUseSetting.StickyDays; see
// LimitedPlanGate.

// limitedPlanGateTTL is how long the holders of an address are remembered. A
// request pays one lookup per address per window, not one per request.
const limitedPlanGateTTL = 60 * time.Second

// limitedPlanStickyRecheck is how long a customer found clear of every gated
// address is not looked up again.
const limitedPlanStickyRecheck = 300 * time.Second

// limitedPlanGateMaxAddresses bounds the caches; past it, expired entries go
// first and then the cache starts over.
const limitedPlanGateMaxAddresses = 20000

// limitedPlanStickyKey is the Redis key that remembers a gated customer.
const limitedPlanStickyKey = "limited_plan_gate:sticky:"

// LimitedPlanGate is the verdict that a request may not draw on the plans
// limited per user a customer holds.
type LimitedPlanGate struct {
	// SubscriptionIds are the customer's active subscriptions of such plans,
	// which sit out of this request.
	SubscriptionIds []int
	// Holders counts the other accounts that used the address or network and
	// hold a plan limited per user; zero when the customer is gated by memory
	// of an earlier address.
	Holders int
	// Scope says what triggered: "address", "network" or "sticky".
	Scope string
}

// Values of LimitedPlanGate.Scope.
const (
	LimitedPlanScopeAddress = "address"
	LimitedPlanScopeNetwork = "network"
	LimitedPlanScopeSticky  = "sticky"
)

// limitedPlanScope is an address or a network and the accounts that hold a
// plan limited per user and used it.
type limitedPlanScope struct {
	expires int64
	holders map[int]bool
	key     string
	// ips lists the addresses of an IPv4 /24; prefix is the text every
	// address of an IPv6 /64 starts with. An address has neither.
	ips    []string
	prefix string
	exit   sync.Once
	// exitReason is why the scope is a shared exit, or "".
	exitReason string
}

type limitedPlanSticky struct {
	expires int64
	until   int64
}

var (
	limitedPlanScopeMu    sync.Mutex
	limitedPlanScopeCache = map[string]*limitedPlanScope{}
	limitedPlanScopeGroup singleflight.Group

	limitedPlanStickyMu    sync.Mutex
	limitedPlanStickyCache = map[string]*limitedPlanSticky{}
	// limitedPlanStickyLocal remembers gated customers when Redis is off.
	limitedPlanStickyLocal = map[int]int64{}
	limitedPlanStickyGroup singleflight.Group
)

// ResetLimitedPlanGateCache forgets every address and every gated customer,
// for tests. Exemptions and the customer's subscriptions are read on each
// request, not cached.
func ResetLimitedPlanGateCache() {
	limitedPlanScopeMu.Lock()
	limitedPlanScopeCache = map[string]*limitedPlanScope{}
	limitedPlanScopeMu.Unlock()
	limitedPlanStickyMu.Lock()
	limitedPlanStickyCache = map[string]*limitedPlanSticky{}
	limitedPlanStickyLocal = map[int]int64{}
	limitedPlanStickyMu.Unlock()
}

// LimitedPlanNetworkOf returns the network of an address: its IPv4 /24 as
// "a.b.c." or its IPv6 /64 as the first four groups; "" when it is neither.
func LimitedPlanNetworkOf(ip string) string {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return ""
	}
	addr = addr.Unmap()
	if addr.Is4() {
		octets := addr.As4()
		return fmt.Sprintf("%d.%d.%d.", octets[0], octets[1], octets[2])
	}
	groups := addr.As16()
	return fmt.Sprintf("%x:%x:%x:%x:", uint16(groups[0])<<8|uint16(groups[1]), uint16(groups[2])<<8|uint16(groups[3]),
		uint16(groups[4])<<8|uint16(groups[5]), uint16(groups[6])<<8|uint16(groups[7]))
}

// CheckLimitedPlanGate decides whether the request of userId from ip may be
// charged to the plans limited per user the customer holds. It returns nil
// when it may, which is every request of a customer who holds none, and
// the gate when it may not:
//   - the address was used by at least the threshold of other accounts that
//     hold such a plan, in the last 30 days (a request in the logs), or its
//     network was used by at least the network threshold;
//   - it is not a shared exit (limitedPlanScope.sharedExit): five or more
//     accounts used it that hold no such plan and they are no fewer than the
//     holders, the test the purchase check uses (checkLimitedPlanAddressFarm),
//     or the accounts without such a plan spent real money there; and its
//     network is not listed in SharedExitNetworks, which only drops the
//     network count, never the address's;
//   - or the customer used a gated address or network in the last sticky days,
//     which gates them from every address;
//   - the customer is not exempt (subscriptionAddressExempt).
//
// A free plan (price zero, or given by an inviter) is not such a plan while
// ExcludeFreePlans is on. A failed lookup lets the request through: billing
// is not worth refusing for.
func CheckLimitedPlanGate(userId int, ip string) *LimitedPlanGate {
	return checkLimitedPlanGateAt(userId, ip, common.GetTimestamp())
}

func checkLimitedPlanGateAt(userId int, ip string, now int64) *LimitedPlanGate {
	gate, _ := checkLimitedPlanVerdictAt(userId, ip, now)
	return gate
}

// CheckLimitedPlanVerdict is CheckLimitedPlanGate that also returns why the
// address was spared as a shared exit (LimitedPlanExit*), or "". The reason is
// set whether or not the request ends up gated, for the log.
func CheckLimitedPlanVerdict(userId int, ip string) (*LimitedPlanGate, string) {
	return checkLimitedPlanVerdictAt(userId, ip, common.GetTimestamp())
}

func checkLimitedPlanVerdictAt(userId int, ip string, now int64) (*LimitedPlanGate, string) {
	setting := operation_setting.GetLimitedPlanUseSetting()
	if !setting.Enabled || ip == "" || userId <= 0 {
		return nil, ""
	}
	owned, err := limitedPlanOwned(userId, now)
	if err != nil {
		common.SysLog(common.LogText("limited plan gate: reading the subscriptions of user %d: %s", userId, err.Error()))
		return nil, ""
	}
	if len(owned) == 0 {
		return nil, ""
	}
	scope, holders, exit, err := limitedPlanTrigger(userId, ip, now)
	if err != nil {
		common.SysLog(common.LogText("limited plan gate: reading address %s: %s", ip, err.Error()))
		return nil, ""
	}
	if scope == "" {
		scope, err = limitedPlanStickyScope(userId, now)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading the addresses of user %d: %s", userId, err.Error()))
			return nil, exit
		}
	} else {
		limitedPlanMarkSticky(userId, now)
	}
	if scope == "" {
		return nil, exit
	}
	if exempt, err := subscriptionAddressExempt(userId); err != nil || exempt {
		return nil, exit
	}
	return &LimitedPlanGate{SubscriptionIds: owned, Holders: holders, Scope: scope}, exit
}

// limitedPlanOwned returns the customer's active subscriptions of plans the
// gate guards: limited per user, and not free while ExcludeFreePlans is on.
func limitedPlanOwned(userId int, now int64) ([]int, error) {
	var owned []int
	query := DB.Table("user_subscriptions").
		Joins("JOIN subscription_plans ON subscription_plans.id = user_subscriptions.plan_id").
		Where("user_subscriptions.user_id = ? AND user_subscriptions.status = ? AND user_subscriptions.end_time > ? AND user_subscriptions.start_time <= ? AND subscription_plans.max_purchase_per_user > 0",
			userId, "active", now, now)
	query = limitedPlanNotFree(query)
	err := query.Pluck("user_subscriptions.id", &owned).Error
	return owned, err
}

// limitedPlanNotFree leaves a free plan out of a query that joins
// user_subscriptions to subscription_plans while ExcludeFreePlans is on.
func limitedPlanNotFree(query *gorm.DB) *gorm.DB {
	if !operation_setting.GetLimitedPlanUseSetting().ExcludeFreePlans {
		return query
	}
	return query.Where("subscription_plans.price_amount > 0 AND user_subscriptions.source <> ?", "affiliate_gift")
}

// limitedPlanTrigger reports which of the request's address and network
// carries enough other holders to gate it, and how many. exit says why a scope
// that carried enough holders was spared as a shared exit, or "".
func limitedPlanTrigger(userId int, ip string, now int64) (scope string, holders int, exit string, err error) {
	setting := operation_setting.GetLimitedPlanUseSetting()
	address, err := limitedPlanScopeOf(ip, now)
	if err != nil {
		return "", 0, "", err
	}
	triggered, count, spared := address.triggers(userId, setting.Threshold, now)
	if triggered {
		return LimitedPlanScopeAddress, count, "", nil
	}
	exit = spared
	if !setting.NetworkEnabled {
		return "", 0, exit, nil
	}
	net := LimitedPlanNetworkOf(ip)
	if net == "" {
		return "", 0, exit, nil
	}
	network, err := limitedPlanScopeOf(net, now)
	if err != nil {
		return "", 0, "", err
	}
	if limitedPlanListedExit(ip) {
		// The administrator's list decides first: the block is a proxy, so its
		// holders are not one studio however many they are. The address was
		// counted above.
		if network.otherHolders(userId) >= max(setting.NetworkThreshold, 1) && exit == "" {
			exit = LimitedPlanExitListed
		}
		return "", 0, exit, nil
	}
	triggered, count, spared = network.triggers(userId, setting.NetworkThreshold, now)
	if triggered {
		return LimitedPlanScopeNetwork, count, exit, nil
	}
	if exit == "" {
		exit = spared
	}
	return "", 0, exit, nil
}

// limitedPlanListedExit reports whether ip is inside a block listed in
// SharedExitNetworks.
func limitedPlanListedExit(ip string) bool {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}
	addr = addr.Unmap()
	for _, prefix := range limitedPlanListedNetworks(operation_setting.GetLimitedPlanUseSetting().SharedExitNetworks) {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

var (
	limitedPlanListedMu    sync.Mutex
	limitedPlanListedText  string
	limitedPlanListedCache []netip.Prefix
)

// limitedPlanListedNetworks parses the SharedExitNetworks option, keeping the
// result until the text changes. An entry that is not a CIDR is skipped; a bare
// address counts as its own /32 or /128.
func limitedPlanListedNetworks(text string) []netip.Prefix {
	limitedPlanListedMu.Lock()
	defer limitedPlanListedMu.Unlock()
	if text == limitedPlanListedText && limitedPlanListedCache != nil {
		return limitedPlanListedCache
	}
	parsed := []netip.Prefix{}
	for _, entry := range strings.FieldsFunc(text, func(r rune) bool { return r == ',' || r == ';' || r == ' ' || r == '\n' || r == '\r' || r == '\t' }) {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			addr, addrErr := netip.ParseAddr(entry)
			if addrErr != nil {
				continue
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		addr, bits := prefix.Addr(), prefix.Bits()
		if addr.Is4In6() && bits >= 96 {
			addr, bits = addr.Unmap(), bits-96
		}
		parsed = append(parsed, netip.PrefixFrom(addr, bits).Masked())
	}
	limitedPlanListedText = text
	limitedPlanListedCache = parsed
	return parsed
}

// otherHolders counts the holders of the scope other than userId.
func (s *limitedPlanScope) otherHolders(userId int) int {
	holders := len(s.holders)
	if s.holders[userId] {
		holders--
	}
	return holders
}

// triggers reports whether the holders of the scope other than userId reach
// the threshold and the scope is not a shared exit, and how many holders there
// are. When the holders reach the threshold but the scope is a shared exit,
// spared says why (LimitedPlanExit*).
func (s *limitedPlanScope) triggers(userId int, threshold int, now int64) (triggered bool, holders int, spared string) {
	holders = s.otherHolders(userId)
	if holders < max(threshold, 1) {
		return false, holders, ""
	}
	if reason := s.sharedExit(now); reason != "" {
		return false, holders, reason
	}
	return true, holders, ""
}

// limitedPlanScopeOf returns the holders of an address, or of a network when
// key ends in "." or ":", from the cache while it is fresh. Concurrent
// requests of a farm share one lookup.
func limitedPlanScopeOf(key string, now int64) (*limitedPlanScope, error) {
	limitedPlanScopeMu.Lock()
	cached := limitedPlanScopeCache[key]
	limitedPlanScopeMu.Unlock()
	if cached != nil && cached.expires > now {
		return cached, nil
	}
	result, err, _ := limitedPlanScopeGroup.Do(key, func() (any, error) {
		scope := &limitedPlanScope{key: key, expires: now + int64(limitedPlanGateTTL/time.Second)}
		switch {
		case strings.HasSuffix(key, "."):
			for host := range 256 {
				scope.ips = append(scope.ips, fmt.Sprintf("%s%d", key, host))
			}
		case strings.HasSuffix(key, ":"):
			scope.prefix = key
		default:
			scope.ips = []string{key}
		}
		holders, err := limitedPlanHoldersIn(scope, now)
		if err != nil {
			return nil, err
		}
		scope.holders = holders
		limitedPlanScopeMu.Lock()
		defer limitedPlanScopeMu.Unlock()
		if len(limitedPlanScopeCache) >= limitedPlanGateMaxAddresses {
			for key, old := range limitedPlanScopeCache {
				if old.expires <= now {
					delete(limitedPlanScopeCache, key)
				}
			}
			if len(limitedPlanScopeCache) >= limitedPlanGateMaxAddresses {
				limitedPlanScopeCache = map[string]*limitedPlanScope{}
			}
		}
		limitedPlanScopeCache[key] = scope
		return scope, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*limitedPlanScope), nil
}

// whereIn narrows a query on a table with an ip column to the
// scope's addresses.
func (s *limitedPlanScope) whereIn(query *gorm.DB, column string) *gorm.DB {
	if s.prefix != "" {
		return query.Where(column+" LIKE ?", s.prefix+"%")
	}
	if len(s.ips) == 1 {
		return query.Where(column+" = ?", s.ips[0])
	}
	return query.Where(column+" IN ?", s.ips)
}

// limitedPlanHoldersIn reads the accounts that sent requests from the scope in
// the 30 days before now and hold a plan limited per user, not given by an
// administrator.
func limitedPlanHoldersIn(scope *limitedPlanScope, now int64) (map[int]bool, error) {
	since := now - sharedAddressWindowSeconds
	var requesters []int
	if err := scope.whereIn(LOG_DB.Model(&Log{}), "ip").Where("created_at > ? AND created_at <= ? AND type IN ?", since, now,
		[]int{LogTypeConsume, LogTypeError}).Distinct().Pluck("user_id", &requesters).Error; err != nil {
		return nil, err
	}
	return limitedPlanHoldersAmong(requesters, now)
}

// limitedPlanHoldersAmong returns the users among userIds that hold, or held,
// a plan limited per user by now: bought, or given by an inviter. An
// administrator's grant is staff, not a farm, and a free plan is not counted
// while ExcludeFreePlans is on.
func limitedPlanHoldersAmong(userIds []int, now int64) (map[int]bool, error) {
	holders := map[int]bool{}
	for chunk := range slices.Chunk(userIds, sharedAddressChunk) {
		var held []int
		query := DB.Table("user_subscriptions").
			Joins("JOIN subscription_plans ON subscription_plans.id = user_subscriptions.plan_id").
			Where("subscription_plans.max_purchase_per_user > 0 AND user_subscriptions.user_id IN ? AND user_subscriptions.source <> ? AND user_subscriptions.created_at <= ?", chunk, "admin", now)
		if err := limitedPlanNotFree(query).Distinct().Pluck("user_subscriptions.user_id", &held).Error; err != nil {
			return nil, err
		}
		for _, id := range held {
			holders[id] = true
		}
	}
	return holders, nil
}

// sharedExit reports why the scope is a proxy or NAT exit rather than one
// person's, or "" when it is not (LimitedPlanExit*):
//   - crowd: at least sharedExitBystanders accounts used it, by request,
//     sign-in or order, that hold no plan limited per user, and they are no
//     fewer than the accounts that do;
//   - traffic: the accounts that hold no such plan spent at least
//     limitedPlanTrafficMinUSD in the window and limitedPlanTrafficShare of
//     what the holders spent.
//
// The farm's own accounts all send requests, so sharedExit's other test, many
// requesters in a week, is not used: forty accounts of one studio would pass
// for a proxy node. A failed lookup counts as a shared exit, which lets the
// request through. The answer is kept with the scope.
func (s *limitedPlanScope) sharedExit(now int64) string {
	s.exit.Do(func() {
		users, err := scopeUsers(s, now-sharedAddressWindowSeconds, now)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading users of %s: %s", s.key, err.Error()))
			s.exitReason = LimitedPlanExitUnread
			return
		}
		held, err := limitedPlanHoldersAmong(users, now)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading holders among users of %s: %s", s.key, err.Error()))
			s.exitReason = LimitedPlanExitUnread
			return
		}
		for id := range s.holders {
			held[id] = true
		}
		bystanders := 0
		for _, id := range users {
			if !held[id] {
				bystanders++
			}
		}
		if bystanders >= sharedExitBystanders && bystanders >= len(held) {
			s.exitReason = LimitedPlanExitCrowd
			return
		}
		if bystanders == 0 {
			return
		}
		spent, err := scopeSpend(s, now-sharedAddressWindowSeconds, now)
		if err != nil {
			common.SysLog(common.LogText("limited plan gate: reading spending of %s: %s", s.key, err.Error()))
			s.exitReason = LimitedPlanExitUnread
			return
		}
		var holdersSpent, othersSpent int64
		for id, quota := range spent {
			if held[id] {
				holdersSpent += quota
			} else {
				othersSpent += quota
			}
		}
		if float64(othersSpent) >= limitedPlanTrafficMinUSD*common.QuotaPerUnit && float64(othersSpent) >= limitedPlanTrafficShare*float64(holdersSpent) {
			s.exitReason = LimitedPlanExitTraffic
		}
	})
	return s.exitReason
}

// scopeSpend returns the quota each account consumed through the scope in
// (since, until].
func scopeSpend(scope *limitedPlanScope, since int64, until int64) (map[int]int64, error) {
	var rows []struct {
		UserId int
		Quota  int64
	}
	if err := scope.whereIn(LOG_DB.Model(&Log{}), "ip").Where("created_at > ? AND created_at <= ? AND type = ?", since, until, LogTypeConsume).
		Select("user_id, SUM(quota) AS quota").Group("user_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	spent := make(map[int]int64, len(rows))
	for _, row := range rows {
		spent[row.UserId] = row.Quota
	}
	return spent, nil
}

// scopeUsers returns the users that signed in, ordered or sent requests from
// the scope in (since, until].
func scopeUsers(scope *limitedPlanScope, since int64, until int64) ([]int, error) {
	found := map[int]bool{}
	var ids []int
	if err := scope.whereIn(DB.Model(&UserSession{}), "ip").Where("created_at > ? AND created_at <= ?", since, until).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := scope.whereIn(DB.Model(&SubscriptionOrder{}), "ip").Where("create_time > ? AND create_time <= ?", since, until).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := scope.whereIn(LOG_DB.Model(&Log{}), "ip").Where("created_at > ? AND created_at <= ? AND type IN ?", since, until,
		[]int{LogTypeConsume, LogTypeError}).Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	users := make([]int, 0, len(found))
	for id := range found {
		users = append(users, id)
	}
	return users, nil
}

// limitedPlanStickyScope returns LimitedPlanScopeSticky when the customer is
// remembered as gated, or when the addresses of their latest requests in the
// sticky window include one that triggers now, and "" otherwise. A customer
// found clear is not looked up again for limitedPlanStickyRecheck.
func limitedPlanStickyScope(userId int, now int64) (string, error) {
	setting := operation_setting.GetLimitedPlanUseSetting()
	if setting.StickyDays <= 0 {
		return "", nil
	}
	key := strconv.Itoa(userId)
	limitedPlanStickyMu.Lock()
	cached := limitedPlanStickyCache[key]
	limitedPlanStickyMu.Unlock()
	if cached == nil || cached.expires <= now {
		result, err, _ := limitedPlanStickyGroup.Do(key, func() (any, error) {
			entry := &limitedPlanSticky{expires: now + int64(limitedPlanGateTTL/time.Second)}
			until, err := limitedPlanStickyUntil(userId, now)
			if err != nil {
				return nil, err
			}
			if until <= now {
				found, err := limitedPlanUsedGatedAddress(userId, now)
				if err != nil {
					return nil, err
				}
				if found {
					until = now + int64(setting.StickyDays)*86400
					limitedPlanStore(userId, until, now)
				} else {
					entry.expires = now + int64(limitedPlanStickyRecheck/time.Second)
				}
			}
			entry.until = until
			limitedPlanStickyMu.Lock()
			defer limitedPlanStickyMu.Unlock()
			if len(limitedPlanStickyCache) >= limitedPlanGateMaxAddresses {
				limitedPlanStickyCache = map[string]*limitedPlanSticky{}
			}
			limitedPlanStickyCache[key] = entry
			return entry, nil
		})
		if err != nil {
			return "", err
		}
		cached = result.(*limitedPlanSticky)
	}
	if cached.until > now {
		return LimitedPlanScopeSticky, nil
	}
	return "", nil
}

// limitedPlanMarkSticky remembers that the customer used a gated address,
// for StickyDays from now.
func limitedPlanMarkSticky(userId int, now int64) {
	days := operation_setting.GetLimitedPlanUseSetting().StickyDays
	if days <= 0 {
		return
	}
	until := now + int64(days)*86400
	limitedPlanStore(userId, until, now)
	limitedPlanStickyMu.Lock()
	limitedPlanStickyCache[strconv.Itoa(userId)] = &limitedPlanSticky{expires: now + int64(limitedPlanGateTTL/time.Second), until: until}
	limitedPlanStickyMu.Unlock()
}

// limitedPlanStore keeps the sticky mark where every server reads it: Redis,
// or the process when Redis is off.
func limitedPlanStore(userId int, until int64, now int64) {
	if common.RedisEnabled && common.RDB != nil {
		if err := common.RedisSet(limitedPlanStickyKey+strconv.Itoa(userId), strconv.FormatInt(until, 10), time.Duration(until-now)*time.Second); err != nil {
			common.SysLog(common.LogText("limited plan gate: remembering user %d: %s", userId, err.Error()))
		}
		return
	}
	limitedPlanStickyMu.Lock()
	limitedPlanStickyLocal[userId] = until
	limitedPlanStickyMu.Unlock()
}

// limitedPlanStickyUntil returns when the customer's mark runs out, or zero.
func limitedPlanStickyUntil(userId int, now int64) (int64, error) {
	if common.RedisEnabled && common.RDB != nil {
		value, err := common.RedisGet(limitedPlanStickyKey + strconv.Itoa(userId))
		if errors.Is(err, redis.Nil) {
			return 0, nil
		}
		if err != nil {
			return 0, err
		}
		until, _ := strconv.ParseInt(value, 10, 64)
		return until, nil
	}
	limitedPlanStickyMu.Lock()
	defer limitedPlanStickyMu.Unlock()
	return limitedPlanStickyLocal[userId], nil
}

// limitedPlanUsedGatedAddress reports whether the addresses of the customer's
// latest requests in the sticky window include one whose address or network
// triggers the gate now.
func limitedPlanUsedGatedAddress(userId int, now int64) (bool, error) {
	setting := operation_setting.GetLimitedPlanUseSetting()
	var recent []string
	if err := LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ? AND created_at > ? AND created_at <= ? AND ip <> ''",
		userId, LogTypeConsume, now-int64(setting.StickyDays)*86400, now).
		Order("id desc").Limit(limitedPlanRecentRequests).Pluck("ip", &recent).Error; err != nil {
		return false, err
	}
	seen := map[string]bool{}
	for _, ip := range recent {
		if seen[ip] {
			continue
		}
		seen[ip] = true
		scope, _, _, err := limitedPlanTrigger(userId, ip, now)
		if err != nil {
			return false, err
		}
		if scope != "" {
			return true, nil
		}
	}
	return false, nil
}
