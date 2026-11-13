package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// RefundedTopUp is one order MarkTopUpsRefunded changed from paid to
// refunded.
type RefundedTopUp struct {
	TradeNo string  `json:"trade_no"`
	UserId  int     `json:"user_id"`
	Money   float64 `json:"money"`
}

// TopUpRefundResult reports what MarkTopUpsRefunded did: the orders it
// marked, and how many were already refunded.
type TopUpRefundResult struct {
	Refunded        []RefundedTopUp `json:"refunded"`
	AlreadyRefunded int             `json:"already_refunded"`
}

// MarkTopUpsRefunded records that the payments behind the given orders went
// back to the payer. A successful order becomes refunded, and so does the
// plan order sharing its number, so the payment drops out of every paid
// total: revenue, invoiceable amounts, the users' paid totals and the
// affiliate program. An order already refunded is left as it is. Any other
// order, or one that does not exist, fails the whole call and changes
// nothing. The user's balance and subscriptions are not touched; an
// administrator adjusts them separately.
func MarkTopUpsRefunded(tradeNos []string) (TopUpRefundResult, error) {
	result := TopUpRefundResult{Refunded: []RefundedTopUp{}}
	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		for _, tradeNo := range tradeNos {
			topUp := &TopUp{}
			if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
				return common.NewMessage("Top-up order {{tradeNo}} does not exist", map[string]any{"tradeNo": tradeNo})
			}
			switch topUp.Status {
			case common.TopUpStatusRefunded:
				result.AlreadyRefunded++
				continue
			case common.TopUpStatusSuccess:
			default:
				return common.NewMessage("Only paid orders can be marked refunded: {{tradeNo}}", map[string]any{"tradeNo": tradeNo})
			}
			if err := tx.Model(topUp).Update("status", common.TopUpStatusRefunded).Error; err != nil {
				return err
			}
			if err := tx.Model(&SubscriptionOrder{}).Where(refCol+" = ? AND status = ?", tradeNo, common.TopUpStatusSuccess).
				Update("status", common.TopUpStatusRefunded).Error; err != nil {
				return err
			}
			result.Refunded = append(result.Refunded, RefundedTopUp{TradeNo: topUp.TradeNo, UserId: topUp.UserId, Money: topUp.Money})
		}
		return nil
	})
	if err != nil {
		return TopUpRefundResult{}, err
	}
	return result, nil
}
