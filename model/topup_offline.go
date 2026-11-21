package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// OfflineTopUpInput is a payment received outside new-api: Money in the
// payment currency, bought Amount in whole quota dollars, with Bonus whole
// quota dollars credited on top (an enterprise's 10%), paid at PaidAt.
// Backfill says administrators already added that quota to the wallet by
// hand, so recording the payment credits nothing.
type OfflineTopUpInput struct {
	UserId   int
	Money    float64
	Amount   int64
	Bonus    int64
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
// Without Backfill the order credits Amount and Bonus to the wallet, like a
// completed online order with a bonus; the bonus is stored as BonusQuota. With Backfill it credits nothing: the funds and channels
// views read the order as paying for that much of the quota administrators
// added (user.quota_add and the other adjustments), which then stops
// counting as given. A backfill's Amount and Bonus together may not exceed the
// net quota added by hand, less earlier backfills'. Offline orders earn no affiliate commission; the
// customer may invoice them like a gateway order.
func RecordOfflineTopUp(input OfflineTopUpInput) (*TopUp, error) {
	now := common.GetTimestamp()
	if input.UserId <= 0 || input.Money <= 0 || input.Amount <= 0 || input.Bonus < 0 || input.PaidAt <= 0 || input.PaidAt > now {
		return nil, common.NewMessage("Invalid parameters")
	}
	perUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(input.Amount).Add(decimal.NewFromInt(input.Bonus)).Mul(perUnit))
	if err != nil || quota <= 0 {
		return nil, ErrInvalidTopUpQuota
	}
	bonusQuota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(input.Bonus).Mul(perUnit))
	if err != nil {
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
		BonusQuota:      int64(bonusQuota),
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
			var earlier struct{ Amount, Bonus int64 }
			if err := tx.Model(&TopUp{}).Select("COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(bonus_quota), 0) AS bonus").
				Where("user_id = ? AND status = ? AND payment_provider = ?", input.UserId, common.TopUpStatusSuccess, PaymentProviderOfflineBackfill).
				Scan(&earlier).Error; err != nil {
				return err
			}
			if (earlier.Amount+input.Amount)*int64(common.QuotaPerUnit)+earlier.Bonus+int64(bonusQuota) > granted {
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
			"Administrator completed the order, amount added: {{quota}} including a bonus of {{bonus}}, payment amount: {{amount}}", quota, topUp), input.CallerIp, PaymentMethodOffline, "admin")
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

// OfflineBackfillCorrection moves a recorded backfill from one split of what
// it covers to another, in whole quota dollars: Amount bought and Bonus on
// top. FromAmount and FromBonus are what the order must hold now. An order's
// own total may change, because a hand deduction between two transfers can have
// been netted into their amounts; the corrections for one user must keep the
// sum of their totals, so the quota the user's backfills cover and the wallet
// do not change.
type OfflineBackfillCorrection struct {
	Id         int
	FromAmount int64
	FromBonus  int64
	Amount     int64
	Bonus      int64
}

// OfflineBackfillCorrected reports one order's correction. Changed is false
// when the order already held the corrected split.
type OfflineBackfillCorrected struct {
	Id      int
	UserId  int
	TradeNo string
	Money   float64
	Before  OfflineBackfillCorrection
	Changed bool
}

// CorrectOfflineBackfills applies corrections to offline backfill orders in
// one transaction, or only checks them when apply is false. Each order must
// be a successful backfill holding either its FromAmount/FromBonus split or
// the corrected one, so a second run changes nothing; any other split, a
// different kind of order or a change of one user's total fails the whole batch. Money,
// status and times are never touched. Each changed order writes one
// user.topup_offline_correct audit entry naming operatorId and the reason.
func CorrectOfflineBackfills(corrections []OfflineBackfillCorrection, apply bool, operatorId int, reason string) ([]OfflineBackfillCorrected, error) {
	if len(corrections) == 0 {
		return nil, errors.New("no corrections given")
	}
	if apply && (operatorId <= 0 || reason == "") {
		return nil, errors.New("an operator and a reason are required to apply")
	}
	var operator User
	if apply {
		if err := DB.Select("username", "role").Where("id = ?", operatorId).First(&operator).Error; err != nil {
			return nil, fmt.Errorf("operator %d: %w", operatorId, err)
		}
		if operator.Role < common.RoleAdminUser {
			return nil, fmt.Errorf("operator %d is not an administrator", operatorId)
		}
	}
	perUnit := int64(common.QuotaPerUnit)
	results := make([]OfflineBackfillCorrected, 0, len(corrections))
	totalChange := make(map[int]int64)
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, want := range corrections {
			if want.Id <= 0 || want.Amount <= 0 || want.Bonus < 0 || want.FromAmount <= 0 || want.FromBonus < 0 {
				return fmt.Errorf("correction for order %d is invalid: amounts must be positive", want.Id)
			}
			var order TopUp
			if err := lockForUpdate(tx).Where("id = ?", want.Id).First(&order).Error; err != nil {
				return fmt.Errorf("order %d: %w", want.Id, err)
			}
			if order.PaymentProvider != PaymentProviderOfflineBackfill || order.Status != common.TopUpStatusSuccess {
				return fmt.Errorf("order %d is not a successful offline backfill (provider %q, status %q)", order.Id, order.PaymentProvider, order.Status)
			}
			totalChange[order.UserId] += want.Amount + want.Bonus - want.FromAmount - want.FromBonus
			result := OfflineBackfillCorrected{
				Id: order.Id, UserId: order.UserId, TradeNo: order.TradeNo, Money: order.Money,
				Before: OfflineBackfillCorrection{Id: order.Id, Amount: order.Amount, Bonus: order.BonusQuota / perUnit},
			}
			holdsCorrected := order.Amount == want.Amount && order.BonusQuota == want.Bonus*perUnit
			holdsExpected := order.Amount == want.FromAmount && order.BonusQuota == want.FromBonus*perUnit
			switch {
			case holdsCorrected:
			case holdsExpected:
				result.Changed = true
				if apply {
					if err := tx.Model(&TopUp{}).Where("id = ?", order.Id).
						Updates(map[string]any{"amount": want.Amount, "bonus_quota": want.Bonus * perUnit}).Error; err != nil {
						return err
					}
				}
			default:
				return fmt.Errorf("order %d holds amount %d and bonus quota %d, expected amount %d and bonus %d dollars", order.Id, order.Amount, order.BonusQuota, want.FromAmount, want.FromBonus)
			}
			results = append(results, result)
		}
		for userId, change := range totalChange {
			if change != 0 {
				return fmt.Errorf("the corrections change the quota user %d's backfills cover by %d dollars", userId, change)
			}
		}
		return nil
	})
	if err != nil || !apply {
		return results, err
	}
	for i, result := range results {
		if !result.Changed {
			continue
		}
		want := corrections[i]
		params := map[string]any{
			"target_user_id": result.UserId, "order_id": result.Id, "trade_no": result.TradeNo,
			"money":       decimal.NewFromFloat(result.Money).StringFixed(2),
			"from_amount": result.Before.Amount, "from_bonus": result.Before.Bonus,
			"amount": want.Amount, "bonus": want.Bonus, "reason": reason,
		}
		// The entry names the operator by the name read above: the user cache
		// needs Redis, which this path does not open.
		RecordAuditLog(nil, AuditLog{
			UserId: operatorId, Username: operator.Username, ActorRole: common.RoleRootUser, Category: AuditCategoryOperation,
			Action: "user.topup_offline_correct", Status: 200, Success: true,
			Content: fmt.Sprintf("Corrected offline backfill %s: amount %d to %d, bonus %d to %d dollars. %s", result.TradeNo, result.Before.Amount, want.Amount, result.Before.Bonus, want.Bonus, reason),
			Other: AuditOther{
				Op:        &AuditOperation{Action: "user.topup_offline_correct", Params: params},
				AdminInfo: &AuditAdminInfo{AdminID: operatorId, AdminUsername: operator.Username, AdminRole: operator.Role, AuthMethod: "cli"},
			},
		})
	}
	return results, nil
}
