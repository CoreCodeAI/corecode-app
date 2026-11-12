package model

import (
	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
)

// UserModelSpend is what one user's requests to one model in one group on
// one channel cost at new-api's prices over a span, read from the consume
// logs. Group is the group the request was billed in, so its ratio can be
// taken back out.
type UserModelSpend struct {
	UserId    int
	ModelName string
	LogGroup  string
	ChannelId int
	Requests  int64
	Quota     int64
}

// ReadUserModelSpend sums the consume logs in [start, end) by user, model,
// group and channel. Root is included: its requests cost gpt-load as much as
// anyone's.
func ReadUserModelSpend(start, end int64) ([]UserModelSpend, error) {
	var rows []UserModelSpend
	err := LOG_DB.Model(&Log{}).
		Select("user_id, model_name, "+logGroupCol+" AS log_group, channel_id, COUNT(*) AS requests, COALESCE(SUM(quota), 0) AS quota").
		Where("created_at >= ? AND created_at < ? AND type = ?", start, end, LogTypeConsume).
		Group("user_id, model_name, " + logGroupCol + ", channel_id").
		Find(&rows).Error
	return rows, err
}

// EngineChannelIDs lists the channels the engine serves: those whose base URL
// names the engine's host, or a host that is not public, as the engine inside
// the deployment (http://gpt-load:3001) is. A channel with no base URL goes to
// its vendor's own API and is not the engine's.
func EngineChannelIDs(engineURL string) (map[int]bool, error) {
	var channels []struct {
		Id      int
		BaseURL *string
	}
	if err := DB.Model(&Channel{}).Select("id, base_url").Find(&channels).Error; err != nil {
		return nil, err
	}
	engineHost := upstreamHost(engineURL)
	ids := make(map[int]bool)
	for _, channel := range channels {
		if channel.BaseURL == nil || *channel.BaseURL == "" {
			continue
		}
		if !PublicUpstreamHost(*channel.BaseURL) || (engineHost != "" && upstreamHost(*channel.BaseURL) == engineHost) {
			ids[channel.Id] = true
		}
	}
	return ids, nil
}

// customerRoleBound is the first role that is not a customer. Staff are
// administrators and root, and every customer view leaves them out; a view
// that shows their traffic says so apart. A customer's role is below it.
const customerRoleBound = common.RoleAdminUser

// StaffUserIDs lists the staff accounts (administrators and root), deleted
// ones included. Those are the users the customer views leave out.
func StaffUserIDs() ([]int, error) {
	var ids []int
	err := DB.Model(&User{}).Unscoped().Where("role >= ?", customerRoleBound).Pluck("id", &ids).Error
	return ids, err
}

// UserSpendAccount is a user's name, email and balance, and what they have
// ever paid: TopupPaid for wallet top-ups and SubscriptionPaid for plans,
// both in the payment currency. Orders paid from the wallet are left out, as
// in the funds view, because the top-up that filled it already counted.
type UserSpendAccount struct {
	UserRef
	Email            string
	BalanceQuota     int64
	TopupPaid        float64
	SubscriptionPaid float64
}

// ReadUserSpendAccounts returns the account of each id that exists, deleted
// users included.
func ReadUserSpendAccounts(ids []int) (map[int]*UserSpendAccount, error) {
	accounts := make(map[int]*UserSpendAccount, len(ids))
	if len(ids) == 0 {
		return accounts, nil
	}
	var users []struct {
		Id       int
		Username string
		Email    string
		Quota    int64
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, username, email, quota").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		accounts[user.Id] = &UserSpendAccount{
			UserRef:      UserRef{UserID: user.Id, Username: user.Username},
			Email:        user.Email,
			BalanceQuota: user.Quota,
		}
	}
	var orders []struct {
		UserId  int
		Money   float64
		TradeNo string
	}
	if err := DB.Model(&TopUp{}).Select("user_id, money, trade_no").
		Where("status = ? AND (payment_provider IS NULL OR payment_provider <> ?) AND user_id IN ?", common.TopUpStatusSuccess, PaymentProviderBalance, ids).
		Find(&orders).Error; err != nil {
		return nil, err
	}
	var subscriptionTradeNos []string
	if err := DB.Model(&SubscriptionOrder{}).Where("status = ? AND user_id IN ?", common.TopUpStatusSuccess, ids).
		Pluck("trade_no", &subscriptionTradeNos).Error; err != nil {
		return nil, err
	}
	subscriptions := make(map[string]struct{}, len(subscriptionTradeNos))
	for _, tradeNo := range subscriptionTradeNos {
		subscriptions[tradeNo] = struct{}{}
	}
	topups := make(map[int]decimal.Decimal)
	plans := make(map[int]decimal.Decimal)
	for _, order := range orders {
		money := decimal.NewFromFloat(order.Money)
		if _, ok := subscriptions[order.TradeNo]; ok {
			plans[order.UserId] = plans[order.UserId].Add(money)
		} else {
			topups[order.UserId] = topups[order.UserId].Add(money)
		}
	}
	for id, account := range accounts {
		account.TopupPaid = topups[id].Round(2).InexactFloat64()
		account.SubscriptionPaid = plans[id].Round(2).InexactFloat64()
	}
	return accounts, nil
}
