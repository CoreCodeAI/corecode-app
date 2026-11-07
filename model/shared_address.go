package model

import (
	"github.com/QuantumNous/new-api/common"
)

// One person with many accounts shows up as accounts that share an address:
// the console sign-ins in user_sessions, the requests in logs, and now the
// address that opened a plan order. On 2026-11-06 to 11-08 one person bought
// the newcomer plan on nine Google accounts in turn from one home address,
// and the account that invited the others took commission on their use.
const (
	// sharedAddressWindowSeconds is how far back an address counts as one
	// both accounts used.
	sharedAddressWindowSeconds = 30 * 24 * 60 * 60
	// A shared exit, such as a proxy node or a campus NAT, carries the
	// requests of many unrelated customers. An address that sent requests
	// for sharedExitUsers or more accounts in sharedExitWindowSeconds is not
	// evidence that two of them are one person.
	sharedExitUsers         = 20
	sharedExitWindowSeconds = 7 * 24 * 60 * 60
)

var ErrSubscriptionAddressTaken error = common.NewMessage("This plan has already been bought from your network. Contact support if you need it")

// sharedExit reports whether an address carried requests for so many accounts
// that it is a proxy or NAT exit rather than one person's.
func sharedExit(ip string, now int64) (bool, error) {
	var users int64
	err := LOG_DB.Model(&Log{}).Where("ip = ? AND created_at > ?", ip, now-sharedExitWindowSeconds).
		Distinct("user_id").Count(&users).Error
	return users >= sharedExitUsers, err
}

// usedAddress returns the users among userIds that used ip since since: a
// console sign-in, a plan order, or a request.
func usedAddress(ip string, userIds []int, since int64) ([]int, error) {
	if ip == "" || len(userIds) == 0 {
		return nil, nil
	}
	found := map[int]bool{}
	var ids []int
	if err := DB.Model(&UserSession{}).Where("ip = ? AND user_id IN ? AND created_at > ?", ip, userIds, since).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := DB.Model(&SubscriptionOrder{}).Where("ip = ? AND user_id IN ? AND create_time > ?", ip, userIds, since).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := LOG_DB.Model(&Log{}).Where("ip = ? AND user_id IN ? AND created_at > ? AND type IN ?", ip, userIds, since,
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

// addressesOf returns the addresses a user signed in, ordered a plan or sent
// requests from since since.
func addressesOf(userId int, since int64) (map[string]bool, error) {
	addresses := map[string]bool{}
	var ips []string
	if err := DB.Model(&UserSession{}).Where("user_id = ? AND created_at > ? AND ip <> ''", userId, since).
		Distinct().Pluck("ip", &ips).Error; err != nil {
		return nil, err
	}
	for _, ip := range ips {
		addresses[ip] = true
	}
	ips = nil
	if err := DB.Model(&SubscriptionOrder{}).Where("user_id = ? AND create_time > ? AND ip <> ''", userId, since).
		Distinct().Pluck("ip", &ips).Error; err != nil {
		return nil, err
	}
	for _, ip := range ips {
		addresses[ip] = true
	}
	ips = nil
	if err := LOG_DB.Model(&Log{}).Where("user_id = ? AND created_at > ? AND ip <> '' AND type IN ?", userId, since,
		[]int{LogTypeConsume, LogTypeError}).Distinct().Pluck("ip", &ips).Error; err != nil {
		return nil, err
	}
	for _, ip := range ips {
		addresses[ip] = true
	}
	return addresses, nil
}

// SharesAddress reports whether two users signed in, ordered or sent requests
// from one address in the last 30 days that is not a shared exit.
func SharesAddress(a int, b int, now int64) (bool, error) {
	since := now - sharedAddressWindowSeconds
	first, err := addressesOf(a, since)
	if err != nil || len(first) == 0 {
		return false, err
	}
	second, err := addressesOf(b, since)
	if err != nil {
		return false, err
	}
	for ip := range second {
		if !first[ip] {
			continue
		}
		exit, err := sharedExit(ip, now)
		if err != nil {
			return false, err
		}
		if !exit {
			return true, nil
		}
	}
	return false, nil
}

// CheckSubscriptionPurchaseFrom is CheckSubscriptionPurchase for a purchase
// opened from ip. The refusal asks the customer to contact support, who can
// bind the plan from the console when the address is a household or office. A plan limited per user is also limited per address: it is
// refused when another account that bought it in the last 30 days signed in,
// ordered or sent requests from the same address, unless the address is a
// shared exit.
func CheckSubscriptionPurchaseFrom(userId int, plan *SubscriptionPlan, ip string) error {
	if err := CheckSubscriptionPurchase(userId, plan); err != nil {
		return err
	}
	if plan.MaxPurchasePerUser <= 0 || ip == "" {
		return nil
	}
	since := common.GetTimestamp() - sharedAddressWindowSeconds
	var buyers []int
	if err := DB.Model(&UserSubscription{}).
		Where("plan_id = ? AND user_id <> ? AND created_at > ? AND source IN ?", plan.Id, userId, since,
			[]string{"order", PaymentMethodBalance}).
		Distinct().Pluck("user_id", &buyers).Error; err != nil {
		return err
	}
	users, err := usedAddress(ip, buyers, since)
	if err != nil || len(users) == 0 {
		return err
	}
	exit, err := sharedExit(ip, common.GetTimestamp())
	if err != nil || exit {
		return err
	}
	return ErrSubscriptionAddressTaken
}
