package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// OfflineTopUpInput is a payment received outside new-api: Money in the
// payment currency, bought Amount in whole quota dollars, paid at PaidAt.
// Backfill says administrators already added that quota to the wallet by
// hand, so recording the payment credits nothing.
type OfflineTopUpInput struct {
	UserId   int
	Money    float64
	Amount   int64
	PaidAt   int64
	Backfill bool
	CallerIp string
}

// ErrOfflineBackfillExceedsGrants refuses a backfill larger than the quota
// administrators added by hand and no earlier backfill paid for.
// Only scripts call this, so the message is not translated.
var ErrOfflineBackfillExceedsGrants = errors.New("the backfill exceeds the quota administrators added by hand")

// RecordOfflineTopUp stores an offline payment as a paid order, so it counts
// as revenue, in the user's paid total and in the funds view's paid share.
// Without Backfill the order credits Amount to the wallet, like a completed
// online order. With Backfill it credits nothing: the funds and channels
// views read the order as paying for that much of the quota administrators
// added (user.quota_add and the other adjustments), which then stops
// counting as given. A backfill may not exceed the net quota added by hand,
// less earlier backfills. Offline orders earn no affiliate commission; the
// customer may invoice them like a gateway order.
func RecordOfflineTopUp(input OfflineTopUpInput) (*TopUp, error) {
	now := common.GetTimestamp()
	if input.UserId <= 0 || input.Money <= 0 || input.Amount <= 0 || input.PaidAt <= 0 || input.PaidAt > now {
		return nil, common.NewMessage("Invalid parameters")
	}
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(input.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || quota <= 0 {
		return nil, ErrInvalidTopUpQuota
	}
	var granted int64
	if input.Backfill {
		if granted, err = handGrantedQuota(input.UserId, now+1); err != nil {
			return nil, err
		}
	}
	provider := PaymentProviderOffline
	if input.Backfill {
		provider = PaymentProviderOfflineBackfill
	}
	topUp := &TopUp{
		UserId:          input.UserId,
		Amount:          input.Amount,
		Money:           decimal.NewFromFloat(input.Money).Round(2).InexactFloat64(),
		TradeNo:         fmt.Sprintf("OFFLINE-%d-%d-%s", input.UserId, now, common.GetRandomString(6)),
		PaymentMethod:   PaymentMethodOffline,
		PaymentProvider: provider,
		// The funds view counts an order's money at its completion: both
		// times are when the money arrived, not when it was recorded.
		CreateTime:   input.PaidAt,
		CompleteTime: input.PaidAt,
		Status:       common.TopUpStatusSuccess,
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		// The user's row serializes recordings for one user, so two
		// backfills cannot both pass the check below.
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", input.UserId).First(&user).Error; err != nil {
			return err
		}
		if input.Backfill {
			var backfilled int64
			if err := tx.Model(&TopUp{}).Select("COALESCE(SUM(amount), 0)").
				Where("user_id = ? AND status = ? AND payment_provider = ?", input.UserId, common.TopUpStatusSuccess, PaymentProviderOfflineBackfill).
				Scan(&backfilled).Error; err != nil {
				return err
			}
			if (backfilled+input.Amount)*int64(common.QuotaPerUnit) > granted {
				return ErrOfflineBackfillExceedsGrants
			}
		}
		if err := tx.Create(topUp).Error; err != nil {
			return err
		}
		if input.Backfill {
			return nil
		}
		return creditTopUpQuota(tx, input.UserId, quota, nil)
	})
	if err != nil {
		return nil, err
	}
	if !input.Backfill {
		syncCreditUserQuotaCache(input.UserId, quota, common.LogText("offline topup"))
		// The completed-order line reads right for an offline payment and is
		// already translated.
		RecordTopupLog(input.UserId, topUpCreditMessage("Administrator completed the order, amount added: {{quota}}, payment amount: {{amount}}",
			"Administrator completed the order, amount added: {{quota}}, payment amount: {{amount}}", quota, topUp), input.CallerIp, PaymentMethodOffline, "admin")
	}
	return topUp, nil
}

// handGrantedQuota is the net quota administrators added to a user's wallet
// by hand before end, as the funds view reads it.
func handGrantedQuota(userId int, end int64) (int64, error) {
	var granted int64
	err := eachQuotaAdjustment(0, end, func(log AuditLog) {
		if !log.Success || log.Other.Op == nil {
			return
		}
		params := log.Other.Op.Params
		target, ok := auditInt(params, "target_user_id")
		before, hasBefore := auditInt(params, "from")
		after, hasAfter := auditInt(params, "to")
		if ok && hasBefore && hasAfter && int(target) == userId {
			granted += after - before
		}
	})
	return granted, err
}
