package model

import (
	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
)

// UserModelSpend is what one user's requests to one model in one group cost
// at new-api's prices over a span, read from the consume logs. Group is the
// group the request was billed in, so its ratio can be taken back out.
type UserModelSpend struct {
	UserId    int
	ModelName string
	LogGroup  string
	Requests  int64
	Quota     int64
}

// ReadUserModelSpend sums the consume logs in [start, end) by user, model and
// group. Root is included: its requests cost gpt-load as much as anyone's.
func ReadUserModelSpend(start, end int64) ([]UserModelSpend, error) {
	var rows []UserModelSpend
	err := LOG_DB.Model(&Log{}).
		Select("user_id, model_name, "+logGroupCol+" AS log_group, COUNT(*) AS requests, COALESCE(SUM(quota), 0) AS quota").
		Where("created_at >= ? AND created_at < ? AND type = ?", start, end, LogTypeConsume).
		Group("user_id, model_name, " + logGroupCol).
		Find(&rows).Error
	return rows, err
}

// RootUserIDs lists the root accounts, deleted ones included.
func RootUserIDs() ([]int, error) {
	var ids []int
	err := DB.Model(&User{}).Unscoped().Where("role >= ?", common.RoleRootUser).Pluck("id", &ids).Error
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
