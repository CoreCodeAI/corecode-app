package model

import (
	"errors"
	"fmt"
	"math/big"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// CoreCode addition: on-chain deposits. The deposit service keeps, for each
// user address, network and token, the cumulative amount ever received. The
// app remembers how much of each total it has already credited and credits
// the difference. Two servers may run a pass at once, so every write here is
// a conditional update or sits behind a unique key.

// ChainDepositCredit is the amount already credited for one user, network and
// token, in the token's base units as a decimal string: an 18-decimal coin
// passes the range of a 64-bit integer at about 9 dollars.
type ChainDepositCredit struct {
	Id        int    `json:"id"`
	UserId    int    `json:"user_id" gorm:"not null;uniqueIndex:idx_chain_deposit_credit_key,priority:1"`
	Network   string `json:"network" gorm:"type:varchar(32);not null;uniqueIndex:idx_chain_deposit_credit_key,priority:2"`
	Token     string `json:"token" gorm:"type:varchar(32);not null;uniqueIndex:idx_chain_deposit_credit_key,priority:3"`
	Credited  string `json:"credited" gorm:"type:varchar(80);not null;default:'0'"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint"`
}

// ChainDepositCursor is the one row that remembers how far the deposit
// service's feed has been read.
type ChainDepositCursor struct {
	Id        int   `json:"id" gorm:"primaryKey;autoIncrement:false"`
	LastSeq   int64 `json:"last_seq" gorm:"bigint;not null;default:0"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

const chainDepositCursorId = 1

// ErrChainDepositInvalidTotal marks a total that cannot be applied however
// often it is retried.
var ErrChainDepositInvalidTotal = errors.New("invalid chain deposit total")

// ChainDepositOutcome says what a total did.
type ChainDepositOutcome string

const (
	ChainDepositUnchanged ChainDepositOutcome = "unchanged"
	// ChainDepositWaiting: the uncredited difference is under one dollar.
	ChainDepositWaiting ChainDepositOutcome = "waiting"
	// ChainDepositLower: the service reports less than was credited.
	ChainDepositLower   ChainDepositOutcome = "lower"
	ChainDepositCredits ChainDepositOutcome = "credited"
)

// ChainDepositTotal is one cumulative total from the deposit service.
type ChainDepositTotal struct {
	UserId   int
	Network  string
	Token    string
	Decimals int
	Received *big.Int
}

// ChainDepositPrice is what a credited difference is worth in the wallet.
type ChainDepositPrice struct {
	// Amount and Money are what the top-up row records.
	Amount int64
	Money  float64
	// Quota is what the dollars bought, BonusQuota the bonus on top.
	Quota      int
	BonusQuota int64
}

// ChainDepositResult reports one total's outcome.
type ChainDepositResult struct {
	Outcome  ChainDepositOutcome
	Credited *big.Int // the credited amount before this total
	Dollars  decimal.Decimal
	TopUp    *TopUp
	Quota    int // total quota added, bonus included
}

// ChainDepositTradeNo names the top-up a credit to this total creates. It is
// unique, so a second server crediting the same total cannot insert it twice.
func ChainDepositTradeNo(userId int, network string, token string, received *big.Int) string {
	return fmt.Sprintf("CHAIN_%s_%s_%d_%s", network, token, userId, received.String())
}

// ChainDepositDollars is an amount of base units as dollars: every accepted
// token counts as one dollar.
func ChainDepositDollars(units *big.Int, decimals int) decimal.Decimal {
	return decimal.NewFromBigInt(units, int32(-decimals))
}

func parseChainDepositCredited(value string) (*big.Int, error) {
	credited, ok := new(big.Int).SetString(value, 10)
	if !ok || credited.Sign() < 0 {
		return nil, fmt.Errorf("chain deposit credited %q is not a non-negative integer", value)
	}
	return credited, nil
}

// CreditChainDeposit applies one total. Under the row's lock it compares the
// total with what was credited: equal changes nothing, lower credits nothing,
// under one dollar more waits, and otherwise the whole difference becomes one
// successful top-up whose price the callback sets. The row's credited value
// moves with a conditional update in the same transaction as the top-up and
// the quota, so a server that loses the race changes nothing.
func CreditChainDeposit(total ChainDepositTotal, price func(dollars decimal.Decimal) (ChainDepositPrice, error)) (*ChainDepositResult, error) {
	if total.UserId <= 0 || total.Network == "" || total.Token == "" || total.Decimals < 0 || total.Decimals > 30 || total.Received == nil || total.Received.Sign() < 0 {
		return nil, ErrChainDepositInvalidTotal
	}
	result := &ChainDepositResult{Outcome: ChainDepositUnchanged}
	err := DB.Transaction(func(tx *gorm.DB) error {
		row := &ChainDepositCredit{UserId: total.UserId, Network: total.Network, Token: total.Token, Credited: "0"}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
			return err
		}
		row = &ChainDepositCredit{}
		if err := lockForUpdate(tx).Where("user_id = ? AND network = ? AND token = ?", total.UserId, total.Network, total.Token).First(row).Error; err != nil {
			return err
		}
		credited, err := parseChainDepositCredited(row.Credited)
		if err != nil {
			return err
		}
		result.Credited = credited
		switch cmp := total.Received.Cmp(credited); {
		case cmp == 0:
			return nil
		case cmp < 0:
			result.Outcome = ChainDepositLower
			return nil
		}
		diff := new(big.Int).Sub(total.Received, credited)
		result.Dollars = ChainDepositDollars(diff, total.Decimals)
		if result.Dollars.LessThan(decimal.NewFromInt(1)) {
			result.Outcome = ChainDepositWaiting
			return nil
		}
		priced, err := price(result.Dollars)
		if err != nil {
			return err
		}
		credit := tx.Model(&ChainDepositCredit{}).
			Where("id = ? AND credited = ?", row.Id, row.Credited).
			Updates(map[string]any{"credited": total.Received.String(), "updated_at": common.GetTimestamp()})
		if credit.Error != nil {
			return credit.Error
		}
		if credit.RowsAffected != 1 {
			// Another server credited first; nothing is left to do here.
			return nil
		}
		now := common.GetTimestamp()
		topUp := &TopUp{
			UserId:          total.UserId,
			Amount:          priced.Amount,
			Money:           priced.Money,
			TradeNo:         ChainDepositTradeNo(total.UserId, total.Network, total.Token, total.Received),
			PaymentMethod:   PaymentMethodChainDeposit,
			PaymentProvider: PaymentProviderChainDeposit,
			BonusQuota:      priced.BonusQuota,
			CreateTime:      now,
			CompleteTime:    now,
			Status:          common.TopUpStatusSuccess,
		}
		if err := tx.Create(topUp).Error; err != nil {
			return err
		}
		quota := priced.Quota + int(priced.BonusQuota)
		if err := creditTopUpQuota(tx, total.UserId, quota, nil); err != nil {
			return err
		}
		result.Outcome = ChainDepositCredits
		result.TopUp = topUp
		result.Quota = quota
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.Outcome == ChainDepositCredits {
		syncCreditUserQuotaCache(result.TopUp.UserId, result.Quota, common.LogText("%s topup", PaymentProviderChainDeposit))
		RecordTopupLog(result.TopUp.UserId, chainDepositCreditMessage(total, result), "", PaymentMethodChainDeposit, PaymentProviderChainDeposit)
	}
	return result, nil
}

var chainDepositNetworkNames = map[string]string{"bsc": "BNB Smart Chain", "arbitrum": "Arbitrum One"}

// ChainDepositNetworkName is the network's name for people.
func ChainDepositNetworkName(network string) string {
	if name, ok := chainDepositNetworkNames[network]; ok {
		return name
	}
	return network
}

// ChainDepositTokenName is the token's symbol for people. Arbitrum's USDT0 is
// USDT: exchanges send it as USDT on Arbitrum, and the dialog lists it so.
func ChainDepositTokenName(token string) string {
	if token == "USDT0" {
		return "USDT"
	}
	return token
}

// ChainDepositCreditedOf returns what has been credited to a user, in base
// units, keyed by network and token as ChainDepositKey names them.
func ChainDepositCreditedOf(userId int) (map[string]*big.Int, error) {
	var rows []ChainDepositCredit
	if err := DB.Where("user_id = ?", userId).Find(&rows).Error; err != nil {
		return nil, err
	}
	credited := make(map[string]*big.Int, len(rows))
	for _, row := range rows {
		value, err := parseChainDepositCredited(row.Credited)
		if err != nil {
			return nil, err
		}
		credited[ChainDepositKey(row.Network, row.Token)] = value
	}
	return credited, nil
}

// ChainDepositKey names one network's token.
func ChainDepositKey(network string, token string) string {
	return network + "/" + token
}

// chainDepositCreditMessage is a credit's log line. Its payment amount is the
// coins that arrived and their network, which is what the customer sent,
// rather than the top-up's money.
func chainDepositCreditMessage(total ChainDepositTotal, result *ChainDepositResult) *common.Message {
	token := ChainDepositTokenName(total.Token)
	message := topUpCreditMessage("Online top-up succeeded, amount added: {{quota}}, payment amount: {{amount}}",
		"Online top-up succeeded, amount added: {{quota}} including a bonus of {{bonus}}, payment amount: {{amount}}", result.Quota, result.TopUp)
	message.Params["amount"] = fmt.Sprintf("%s %s (%s)", result.Dollars.String(), token, ChainDepositNetworkName(total.Network))
	return message
}

// GetChainDepositCursor returns how far the deposit feed has been read,
// creating the row at zero the first time.
func GetChainDepositCursor() (int64, error) {
	row := &ChainDepositCursor{Id: chainDepositCursorId, UpdatedAt: common.GetTimestamp()}
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error; err != nil {
		return 0, err
	}
	if err := DB.Where("id = ?", chainDepositCursorId).First(row).Error; err != nil {
		return 0, err
	}
	return row.LastSeq, nil
}

// AdvanceChainDepositCursor moves the cursor from one value to another and
// reports whether this caller made the move. Of two servers reading the same
// page, only one wins.
func AdvanceChainDepositCursor(from int64, to int64) (bool, error) {
	if to <= from {
		return false, nil
	}
	result := DB.Model(&ChainDepositCursor{}).
		Where("id = ? AND last_seq = ?", chainDepositCursorId, from).
		Updates(map[string]any{"last_seq": to, "updated_at": common.GetTimestamp()})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}
