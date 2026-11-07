package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// CoreCode addition: subscription plans paid in USDT or USDC through
// NOWPayments. The plan price is CNY, like an epay order; the invoice asks for
// it in US dollars at USDExchangeRate. Plan orders share the top-up IPN
// endpoint and are told apart by their trade number.

const nowPaymentsSubscriptionTradePrefix = "NPSUB"

func isNowPaymentsSubscriptionTradeNo(tradeNo string) bool {
	return strings.HasPrefix(tradeNo, nowPaymentsSubscriptionTradePrefix)
}

type SubscriptionNowPaymentsPayRequest struct {
	PlanId      int    `json:"plan_id"`
	PayCurrency string `json:"pay_currency"`
}

func SubscriptionRequestNowPaymentsPay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req SubscriptionNowPaymentsPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if !isNowPaymentsTopUpEnabled() {
		common.ApiErrorT(c, "Payment information has not been configured by administrator")
		return
	}
	payCurrency := strings.ToLower(strings.TrimSpace(req.PayCurrency))
	if !isNowPaymentsPayCurrency(payCurrency) {
		common.ApiErrorT(c, "Payment method does not exist")
		return
	}
	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorT(c, "Subscription plan is not enabled")
		return
	}
	priceUSD, err := nowPaymentsPriceUSD(plan.PriceAmount)
	if err != nil || priceUSD.LessThan(decimal.NewFromFloat(0.01)) {
		common.ApiErrorT(c, "Plan amount is too low")
		return
	}
	userId := c.GetInt("id")
	if err := model.CheckSubscriptionPurchaseFrom(userId, plan, c.ClientIP()); err != nil {
		common.ApiError(c, err)
		return
	}

	ctx := c.Request.Context()
	tradeNo := fmt.Sprintf("%sUSR%dNO%s%d", nowPaymentsSubscriptionTradePrefix, userId, common.GetRandomString(6), time.Now().Unix())
	invoiceURL, err := createNowPaymentsInvoice(ctx, tradeNo, priceUSD, payCurrency, "CoreCode plan "+tradeNo, "/wallet")
	if err != nil {
		logger.LogError(ctx, common.LogText("NOWPayments failed to create subscription invoice user_id=%d plan_id=%d trade_no=%s pay_currency=%s price_usd=%s error=%q", userId, plan.Id, tradeNo, payCurrency, priceUSD.StringFixed(2), err.Error()))
		common.ApiError(c, nowPaymentsInvoiceError(err))
		return
	}
	order := &model.SubscriptionOrder{
		Ip:              c.ClientIP(),
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodNowPayments,
		PaymentProvider: model.PaymentProviderNowPayments,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		logger.LogError(ctx, common.LogText("NOWPayments failed to create subscription order user_id=%d trade_no=%s error=%q", userId, tradeNo, err.Error()))
		common.ApiErrorT(c, "Failed to create order")
		return
	}
	logger.LogInfo(ctx, common.LogText("NOWPayments subscription order created user_id=%d plan_id=%d trade_no=%s money=%.2f price_usd=%s pay_currency=%s", userId, plan.Id, tradeNo, plan.PriceAmount, priceUSD.StringFixed(2), payCurrency))
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"pay_link": invoiceURL}})
}

// handleNowPaymentsSubscriptionNotification applies a signed IPN to a plan
// order. It returns false when it has already answered the request with an
// error NOWPayments should retry.
func handleNowPaymentsSubscriptionNotification(c *gin.Context, ctx context.Context, tradeNo string, body []byte, notification nowPaymentsNotification, summary string, callerIp string) bool {
	order := model.GetSubscriptionOrderByTradeNo(tradeNo)
	wasPending := order != nil && order.Status == common.TopUpStatusPending
	switch notification.PaymentStatus {
	case "finished":
		err := model.CompleteSubscriptionOrder(tradeNo, string(body), model.PaymentProviderNowPayments, "")
		switch {
		case err == nil && order != nil && order.Status == common.TopUpStatusSuccess:
			logger.LogInfo(ctx, common.LogText("NOWPayments duplicate subscription callback ignored %s client_ip=%s", summary, callerIp))
		case err == nil:
			logger.LogInfo(ctx, common.LogText("NOWPayments subscription purchase succeeded %s client_ip=%s", summary, callerIp))
			notifyNowPaymentsFeishu("✅ USDT/USDC 套餐购买成功", tradeNo, notification)
		case errors.Is(err, model.ErrSubscriptionOrderNotFound), errors.Is(err, model.ErrPaymentMethodMismatch),
			errors.Is(err, model.ErrSubscriptionOrderStatusInvalid), errors.Is(err, model.ErrSubscriptionPurchaseLimit),
			errors.Is(err, model.ErrSubscriptionGifted), errors.Is(err, model.ErrSubscriptionNotEligible):
			// Paid, but the plan cannot be granted: a person refunds the
			// customer or grants it by hand.
			logger.LogWarn(ctx, common.LogText("NOWPayments subscription callback not applied %s client_ip=%s error=%q", summary, callerIp, err.Error()))
			notifyNowPaymentsFeishu("⚠️ USDT/USDC 已付款但套餐未开通，需人工核对", tradeNo, notification)
		default:
			logger.LogError(ctx, common.LogText("NOWPayments subscription processing failed %s client_ip=%s error=%q", summary, callerIp, err.Error()))
			c.AbortWithStatus(http.StatusInternalServerError)
			return false
		}
	case "failed", "refunded", "expired":
		if !wasPending {
			logger.LogInfo(ctx, common.LogText("NOWPayments subscription order not pending, status left as is %s client_ip=%s", summary, callerIp))
			break
		}
		if err := model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderNowPayments); err != nil {
			logger.LogWarn(ctx, common.LogText("NOWPayments subscription order not closed %s client_ip=%s error=%q", summary, callerIp, err.Error()))
			break
		}
		logger.LogInfo(ctx, common.LogText("NOWPayments subscription order closed %s client_ip=%s", summary, callerIp))
		if notification.PaymentStatus != "expired" {
			notifyNowPaymentsFeishu("❌ USDT/USDC 套餐付款失败或已退款", tradeNo, notification)
		}
	case "partially_paid":
		logger.LogWarn(ctx, common.LogText("NOWPayments subscription order partially paid, left pending for manual review %s client_ip=%s", summary, callerIp))
		notifyNowPaymentsFeishu("⚠️ USDT/USDC 套餐少付，需人工核对", tradeNo, notification)
	default:
		logger.LogInfo(ctx, common.LogText("NOWPayments payment status changed %s client_ip=%s", summary, callerIp))
	}
	return true
}

// nowPaymentsSubscriptionFeishuLines describes a plan order for the Feishu
// group, or says there is none.
func nowPaymentsSubscriptionFeishuLines(tradeNo string) []string {
	order := model.GetSubscriptionOrderByTradeNo(tradeNo)
	if order == nil {
		return []string{"系统里没有这笔套餐订单"}
	}
	plan := fmt.Sprintf("#%d", order.PlanId)
	if p, err := model.GetSubscriptionPlanById(order.PlanId); err == nil && p.Title != "" {
		plan = p.Title + " " + plan
	}
	return []string{
		"用户：" + nowPaymentsFeishuUser(order.UserId),
		fmt.Sprintf("套餐：%s，应付 ¥%.2f", plan, order.Money),
	}
}
