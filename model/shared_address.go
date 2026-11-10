package model

import (
	"slices"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
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
	// A proxy node also carries the console sign-ins of customers who never
	// send a request from it. An address that sharedExitBystanders or more
	// other accounts used in sharedAddressWindowSeconds without buying a plan
	// limited per user is a shared exit too. The accounts one person farms
	// from a home address all buy the plan, which is why they were made.
	sharedExitBystanders = 5
)

var ErrSubscriptionAddressTaken error = common.NewMessage("This plan has already been bought from your network. Contact support if you need it")

// sharedExit reports whether an address is a proxy or NAT exit rather than one
// person's: it carried requests for many accounts in a week, or many accounts
// other than parties used it without buying a plan limited per user.
func sharedExit(ip string, now int64, parties ...int) (bool, error) {
	var requesters int64
	if err := LOG_DB.Model(&Log{}).Where("ip = ? AND created_at > ?", ip, now-sharedExitWindowSeconds).
		Distinct("user_id").Count(&requesters).Error; err != nil || requesters >= sharedExitUsers {
		return requesters >= sharedExitUsers, err
	}
	since := now - sharedAddressWindowSeconds
	users, err := addressUsers(ip, since, nil)
	if err != nil {
		return false, err
	}
	others := make([]int, 0, len(users))
	for _, id := range users {
		if !slices.Contains(parties, id) {
			others = append(others, id)
		}
	}
	if len(others) < sharedExitBystanders {
		return false, nil
	}
	buyers, err := limitedPlanBuyers(others, since)
	return len(others)-len(buyers) >= sharedExitBystanders, err
}

// limitedPlanBuyers returns the users among userIds that bought a plan limited
// per user since since.
func limitedPlanBuyers(userIds []int, since int64) ([]int, error) {
	var plans []int
	if err := DB.Model(&SubscriptionPlan{}).Where("max_purchase_per_user > 0").Pluck("id", &plans).Error; err != nil || len(plans) == 0 {
		return nil, err
	}
	var buyers []int
	err := DB.Model(&UserSubscription{}).
		Where("plan_id IN ? AND user_id IN ? AND created_at > ? AND source IN ?", plans, userIds, since,
			[]string{"order", PaymentMethodBalance}).
		Distinct().Pluck("user_id", &buyers).Error
	return buyers, err
}

// usedAddress returns the users among userIds that used ip since since: a
// console sign-in, a plan order, or a request.
func usedAddress(ip string, userIds []int, since int64) ([]int, error) {
	if ip == "" || len(userIds) == 0 {
		return nil, nil
	}
	return addressUsers(ip, since, userIds)
}

// addressUsers returns the users that used ip since since, only those among
// userIds unless userIds is nil.
func addressUsers(ip string, since int64, userIds []int) ([]int, error) {
	among := func(query *gorm.DB) *gorm.DB {
		if userIds == nil {
			return query
		}
		return query.Where("user_id IN ?", userIds)
	}
	found := map[int]bool{}
	var ids []int
	if err := among(DB.Model(&UserSession{}).Where("ip = ? AND created_at > ?", ip, since)).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := among(DB.Model(&SubscriptionOrder{}).Where("ip = ? AND create_time > ?", ip, since)).
		Distinct().Pluck("user_id", &ids).Error; err != nil {
		return nil, err
	}
	for _, id := range ids {
		found[id] = true
	}
	ids = nil
	if err := among(LOG_DB.Model(&Log{}).Where("ip = ? AND created_at > ? AND type IN ?", ip, since,
		[]int{LogTypeConsume, LogTypeError})).Distinct().Pluck("user_id", &ids).Error; err != nil {
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
		exit, err := sharedExit(ip, now, a, b)
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
	exit, err := sharedExit(ip, common.GetTimestamp(), userId)
	if err != nil || exit {
		return err
	}
	exempt, err := subscriptionAddressExempt(userId)
	if err != nil || exempt {
		return err
	}
	return ErrSubscriptionAddressTaken
}

// SubscriptionAddressExemption lets one account buy a plan from an address
// another buyer of it used. Customers behind one VPN node or office exit are
// told to contact support; an administrator lifts the check for the account
// here, and the per-user limit still applies.
type SubscriptionAddressExemption struct {
	UserId    int   `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	CreatedBy int   `json:"created_by"`
	CreatedAt int64 `json:"created_at"`
}

func subscriptionAddressExempt(userId int) (bool, error) {
	var count int64
	err := DB.Model(&SubscriptionAddressExemption{}).Where("user_id = ?", userId).Count(&count).Error
	return count > 0, err
}

// GetSubscriptionAddressExemption returns the exemption of a user, or nil.
func GetSubscriptionAddressExemption(userId int) (*SubscriptionAddressExemption, error) {
	var exemption SubscriptionAddressExemption
	result := DB.Where("user_id = ?", userId).Limit(1).Find(&exemption)
	if result.Error != nil || result.RowsAffected == 0 {
		return nil, result.Error
	}
	return &exemption, nil
}

// SetSubscriptionAddressExemption grants or revokes the exemption.
func SetSubscriptionAddressExemption(userId int, exempt bool, adminId int) error {
	if !exempt {
		return DB.Where("user_id = ?", userId).Delete(&SubscriptionAddressExemption{}).Error
	}
	existing, err := GetSubscriptionAddressExemption(userId)
	if err != nil || existing != nil {
		return err
	}
	return DB.Create(&SubscriptionAddressExemption{UserId: userId, CreatedBy: adminId, CreatedAt: common.GetTimestamp()}).Error
}
