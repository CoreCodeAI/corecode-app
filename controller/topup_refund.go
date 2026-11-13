package controller

import (
	"context"
	"errors"
	"slices"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
)

type AdminRefundTopUpsRequest struct {
	TradeNos []string `json:"trade_nos"`
}

// AdminRefundTopUps marks paid orders refunded after their payments were
// returned outside new-api, for example from the Stripe dashboard. It needs a
// step-up proof bound to the exact orders, and writes one audit entry per
// affected user. Balances are left alone: the console asks the operator to
// adjust them separately.
func AdminRefundTopUps(c *gin.Context) {
	var req AdminRefundTopUpsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	tradeNos, ok := service.NormalizeTopUpRefundTradeNos(req.TradeNos)
	if !ok {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	authorization := requireAdminUserProof(c, service.VerificationScopeAdminTopUpRefund, service.AdminTopUpRefundContext{TradeNos: tradeNos})
	if authorization == nil {
		return
	}
	for _, tradeNo := range tradeNos {
		LockOrder(tradeNo)
	}
	defer func() {
		for _, tradeNo := range tradeNos {
			UnlockOrder(tradeNo)
		}
	}()
	result, err := model.MarkTopUpsRefunded(tradeNos)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byUser := make(map[int][]model.RefundedTopUp)
	for _, order := range result.Refunded {
		byUser[order.UserId] = append(byUser[order.UserId], order)
	}
	userIds := make([]int, 0, len(byUser))
	for userId := range byUser {
		userIds = append(userIds, userId)
	}
	slices.Sort(userIds)
	for _, userId := range userIds {
		orders := byUser[userId]
		money := decimal.Zero
		orderNos := make([]string, 0, len(orders))
		for _, order := range orders {
			money = money.Add(decimal.NewFromFloat(order.Money))
			orderNos = append(orderNos, order.TradeNo)
		}
		recordManageAuditFor(c, userId, "user.topup_refund", map[string]any{
			"count":               len(orders),
			"money":               money.Round(2).String(),
			"trade_nos":           orderNos,
			"verification_method": authorization.Method,
		})
	}
	common.ApiSuccess(c, result)
}

// stripeTradeNoForPaymentIntent finds the order a payment belongs to. A
// charge event carries only its PaymentIntent, and the order number lives on
// the Checkout Session that created it. A variable so tests can replace the
// lookup.
var stripeTradeNoForPaymentIntent = func(paymentIntent string) (string, error) {
	stripe.Key = setting.StripeApiSecret
	iter := session.List(&stripe.CheckoutSessionListParams{PaymentIntent: stripe.String(paymentIntent)})
	for iter.Next() {
		if reference := iter.CheckoutSession().ClientReferenceID; reference != "" {
			return reference, nil
		}
	}
	return "", iter.Err()
}

// chargeRefunded marks the order of a fully refunded Stripe charge refunded.
// A partial refund leaves the order paid: the console shows no partial
// state, and an administrator settles it by hand.
func chargeRefunded(ctx context.Context, event stripe.Event, callerIp string) {
	charge := event.GetObjectValue("id")
	paymentIntent := event.GetObjectValue("payment_intent")
	if event.GetObjectValue("refunded") != "true" {
		logger.LogInfo(ctx, common.LogText("Stripe charge partially refunded, order left paid charge=%s amount_refunded=%s client_ip=%s", charge, event.GetObjectValue("amount_refunded"), callerIp))
		return
	}
	if paymentIntent == "" {
		logger.LogWarn(ctx, common.LogText("Stripe charge refunded without a payment intent, ignored charge=%s client_ip=%s", charge, callerIp))
		return
	}
	tradeNo, err := stripeTradeNoForPaymentIntent(paymentIntent)
	if err != nil || tradeNo == "" {
		message := "no checkout session"
		if err != nil {
			message = err.Error()
		}
		logger.LogWarn(ctx, common.LogText("Stripe charge refunded but its order was not found charge=%s payment_intent=%s client_ip=%s error=%q", charge, paymentIntent, callerIp, message))
		return
	}
	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	result, err := model.MarkTopUpsRefunded([]string{tradeNo})
	if err != nil {
		var message *common.Message
		if errors.As(err, &message) {
			logger.LogWarn(ctx, common.LogText("Stripe charge refunded but its order cannot be marked refunded trade_no=%s charge=%s client_ip=%s error=%q", tradeNo, charge, callerIp, err.Error()))
			return
		}
		logger.LogError(ctx, common.LogText("Stripe failed to mark order refunded trade_no=%s charge=%s client_ip=%s error=%q", tradeNo, charge, callerIp, err.Error()))
		return
	}
	if result.AlreadyRefunded > 0 {
		logger.LogInfo(ctx, common.LogText("Stripe charge refunded, order already refunded trade_no=%s charge=%s client_ip=%s", tradeNo, charge, callerIp))
		return
	}
	logger.LogInfo(ctx, common.LogText("Stripe charge refunded, order marked refunded trade_no=%s charge=%s client_ip=%s", tradeNo, charge, callerIp))
}
