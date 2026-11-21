package controller

import (
	"context"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// CoreCode addition: the deposit dialog follows each transfer the deposit
// service's webhooks reported, from seen to confirmed to credited. The service
// says whether a transfer's block has been read; the app knows what it has
// credited.

// Stages of a transfer, in order.
const (
	// The block has not been read at the confirmed height yet.
	chainDepositStageConfirming = "confirming"
	// Confirmed, and the app has not credited it yet.
	chainDepositStageCrediting = "crediting"
	// Confirmed, but what is left to credit is under one dollar, which
	// waits for more (model.ChainDepositWaiting).
	chainDepositStageWaiting  = "waiting"
	chainDepositStageCredited = "credited"
)

type chainDepositTransferItem struct {
	Network   string `json:"network"`
	Token     string `json:"token"`
	Decimals  int    `json:"decimals"`
	Amount    string `json:"amount"`
	TxHash    string `json:"tx_hash"`
	SeenAt    int64  `json:"seen_at"`
	Confirmed bool   `json:"confirmed"`
}

type chainDepositActivityReply struct {
	UserID    int                        `json:"user_id"`
	Transfers []chainDepositTransferItem `json:"transfers"`
	Totals    []chainDepositTotalItem    `json:"totals"`
}

// ChainDepositTransfer is one transfer as the dialog shows it.
type ChainDepositTransfer struct {
	Network     string `json:"network"`
	NetworkName string `json:"network_name"`
	Token       string `json:"token"`
	// Amount is the coins sent, as a decimal.
	Amount string `json:"amount"`
	TxHash string `json:"tx_hash"`
	SeenAt int64  `json:"seen_at"`
	Stage  string `json:"stage"`
	// Credited and Bonus are what the credit added, in wallet units. Only a
	// transfer whose point a credit ended at carries them: one credit can
	// cover several transfers.
	Credited float64 `json:"credited,omitempty"`
	Bonus    float64 `json:"bonus,omitempty"`
}

func chainDepositFetchActivity(ctx context.Context, userId int) (*chainDepositActivityReply, error) {
	body, err := chainDepositCall(ctx, http.MethodPost, "/v1/activity", chainDepositUserBody(userId))
	if err != nil {
		return nil, err
	}
	reply := &chainDepositActivityReply{}
	if err := common.Unmarshal(body, reply); err != nil {
		return nil, err
	}
	if reply.UserID != userId {
		return nil, errChainDepositOtherUser
	}
	return reply, nil
}

// chainDepositStages places each transfer, newest first, against the totals
// the service has confirmed and what the app has credited of them. A
// transfer's point is the total as it stood once the transfer arrived: the
// present total less the newer confirmed transfers of its token. It is credited
// once the credited total reaches its point.
func chainDepositStages(userId int, reply *chainDepositActivityReply, credited map[string]*big.Int) []ChainDepositTransfer {
	points := make(map[string]*big.Int, len(reply.Totals))
	for _, total := range reply.Totals {
		if value, ok := new(big.Int).SetString(total.Received, 10); ok {
			points[model.ChainDepositKey(total.Network, total.Token)] = value
		}
	}
	out := make([]ChainDepositTransfer, 0, len(reply.Transfers))
	for _, item := range reply.Transfers {
		units, ok := new(big.Int).SetString(item.Amount, 10)
		if !ok || units.Sign() <= 0 || !chainDepositKnownToken(item.Network, item.Token, item.Decimals) {
			continue
		}
		key := model.ChainDepositKey(item.Network, item.Token)
		transfer := ChainDepositTransfer{
			Network:     item.Network,
			NetworkName: model.ChainDepositNetworkName(item.Network),
			Token:       model.ChainDepositTokenName(item.Token),
			Amount:      model.ChainDepositDollars(units, item.Decimals).String(),
			TxHash:      item.TxHash,
			SeenAt:      item.SeenAt,
			Stage:       chainDepositStageConfirming,
		}
		point, done := points[key], credited[key]
		if done == nil {
			done = new(big.Int)
		}
		if item.Confirmed && point != nil && point.Sign() > 0 {
			switch {
			case done.Cmp(point) >= 0:
				transfer.Stage = chainDepositStageCredited
				if done.Cmp(point) == 0 {
					chainDepositCreditOf(userId, item.Network, item.Token, done, &transfer)
				}
			case model.ChainDepositDollars(new(big.Int).Sub(point, done), item.Decimals).LessThan(decimal.NewFromInt(1)):
				transfer.Stage = chainDepositStageWaiting
			default:
				transfer.Stage = chainDepositStageCrediting
			}
			points[key] = new(big.Int).Sub(point, units)
		}
		out = append(out, transfer)
	}
	return out
}

// chainDepositCreditOf fills in the credit that brought a token's credited
// total to its present value.
func chainDepositCreditOf(userId int, network string, token string, credited *big.Int, transfer *ChainDepositTransfer) {
	topUp := model.GetTopUpByTradeNo(model.ChainDepositTradeNo(userId, network, token, credited))
	if topUp == nil || topUp.UserId != userId || operation_setting.Price <= 0 || common.QuotaPerUnit <= 0 {
		return
	}
	transfer.Credited = decimal.NewFromFloat(topUp.Money).Div(decimal.NewFromFloat(operation_setting.Price)).Round(2).InexactFloat64()
	transfer.Bonus = decimal.NewFromInt(topUp.BonusQuota).Div(decimal.NewFromFloat(common.QuotaPerUnit)).Round(2).InexactFloat64()
}

// chainDepositActivityPass credits what the service has confirmed without
// waiting for the next scheduled pass. A dialog polls every few seconds, so
// passes started this way are at most one at a time and one per interval.
var chainDepositActivityPass = func(ctx context.Context) error {
	if !chainDepositActivityPassGate.TryLock() {
		return nil
	}
	defer chainDepositActivityPassGate.Unlock()
	if time.Since(chainDepositActivityPassLast) < chainDepositActivityPassEvery {
		return nil
	}
	chainDepositActivityPassLast = time.Now()
	return RunChainDepositPass(ctx)
}

var (
	chainDepositActivityPassGate  sync.Mutex
	chainDepositActivityPassLast  time.Time
	chainDepositActivityPassEvery = 2 * time.Second
)

func chainDepositActivity(ctx context.Context, userId int) ([]ChainDepositTransfer, error) {
	reply, err := chainDepositFetchActivity(ctx, userId)
	if err != nil {
		return nil, err
	}
	credited, err := model.ChainDepositCreditedOf(userId)
	if err != nil {
		return nil, err
	}
	transfers := chainDepositStages(userId, reply, credited)
	for _, transfer := range transfers {
		if transfer.Stage != chainDepositStageCrediting {
			continue
		}
		if err := chainDepositActivityPass(ctx); err != nil {
			// The scheduled pass credits it; the dialog shows it crediting.
			common.SysError(common.LogText("chain deposit pass for activity failed: %s", err.Error()))
			return transfers, nil
		}
		if credited, err = model.ChainDepositCreditedOf(userId); err != nil {
			return nil, err
		}
		return chainDepositStages(userId, reply, credited), nil
	}
	return transfers, nil
}

// RequestChainDepositActivity answers the caller's transfers of the last day
// and how far each has got.
func RequestChainDepositActivity(c *gin.Context) {
	if !canUseChainDeposit(c.GetInt("role")) {
		paymentError(c, common.NewMessage("Payment method does not exist"))
		return
	}
	id := c.GetInt("id")
	transfers, err := chainDepositActivity(c.Request.Context(), id)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("chain deposit activity failed user_id=%d error=%q", id, err.Error()))
		paymentError(c, common.NewMessage("Failed to check the deposit"))
		return
	}
	common.ApiSuccess(c, gin.H{"transfers": transfers})
}
