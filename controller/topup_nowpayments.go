package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// CoreCode addition: crypto top-ups through NOWPayments hosted invoices.
// An order is priced like an epay order, in CNY, and the invoice asks for
// that amount in US dollars at the USDExchangeRate option. USDT and USDC are
// both taken as one dollar.

// nowPaymentsAPIBase is NOWPayments' API. Tests point it at a stub.
var nowPaymentsAPIBase = "https://api.nowpayments.io/v1"

var nowPaymentsHTTPClient = &http.Client{Timeout: 20 * time.Second}

type NowPaymentsPayRequest struct {
	Amount      int64  `json:"amount"`
	PayCurrency string `json:"pay_currency"`
}

func getNowPaymentsMinTopup() int64 {
	minTopup := int64(setting.NowPaymentsMinTopUp)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		minTopup *= int64(common.QuotaPerUnit)
	}
	return max(minTopup, getMinTopup())
}

// nowPaymentsPriceUSD converts an order's CNY price to the dollars the invoice
// asks for, rounded to the cent.
func nowPaymentsPriceUSD(payMoney float64) (decimal.Decimal, error) {
	rate := operation_setting.USDExchangeRate
	if rate <= 0 {
		return decimal.Zero, errors.New("USDExchangeRate is not positive")
	}
	return decimal.NewFromFloat(payMoney).Div(decimal.NewFromFloat(rate)).Round(2), nil
}

// nowPaymentsQuote validates a top-up amount and prices it: the CNY money the
// order records and the USD the invoice asks for. It answers the client
// itself and returns ok=false when the amount is refused.
func nowPaymentsQuote(c *gin.Context, amount int64) (payMoney float64, priceUSD decimal.Decimal, ok bool) {
	if !isNowPaymentsTopUpEnabled() {
		paymentError(c, common.NewMessage("Payment information has not been configured by administrator"))
		return 0, decimal.Zero, false
	}
	if amount < getNowPaymentsMinTopup() {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": getNowPaymentsMinTopup()}))
		return 0, decimal.Zero, false
	}
	id := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, id, amount) {
		return 0, decimal.Zero, false
	}
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return 0, decimal.Zero, false
	}
	payMoney = getPayMoney(amount, group)
	priceUSD, err = nowPaymentsPriceUSD(payMoney)
	if err != nil || priceUSD.LessThan(decimal.NewFromFloat(0.01)) {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return 0, decimal.Zero, false
	}
	return payMoney, priceUSD, true
}

func RequestNowPaymentsAmount(c *gin.Context) {
	var req NowPaymentsPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	_, priceUSD, ok := nowPaymentsQuote(c, req.Amount)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": priceUSD.StringFixed(2)})
}

func RequestNowPaymentsPay(c *gin.Context) {
	var req NowPaymentsPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	payCurrency := strings.ToLower(strings.TrimSpace(req.PayCurrency))
	if !isNowPaymentsPayCurrency(payCurrency) {
		paymentError(c, common.NewMessage("Payment method does not exist"))
		return
	}
	payMoney, priceUSD, ok := nowPaymentsQuote(c, req.Amount)
	if !ok {
		return
	}
	id := c.GetInt("id")
	bonusQuota, err := topUpBonusQuota(req.Amount)
	if err == nil && bonusQuota > 0 {
		quota, _ := getTopUpQuota(req.Amount)
		err = model.ValidateTopUpQuotaCapacity(id, quota+bonusQuota)
	}
	if err != nil {
		paymentError(c, err)
		return
	}

	tradeNo := fmt.Sprintf("NPUSR%dNO%s%d", id, common.GetRandomString(6), time.Now().Unix())
	invoiceURL, err := createNowPaymentsInvoice(c.Request.Context(), tradeNo, priceUSD, payCurrency, "CoreCode top-up "+tradeNo, "/usage-logs")
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("NOWPayments failed to create invoice user_id=%d trade_no=%s pay_currency=%s price_usd=%s error=%q", id, tradeNo, payCurrency, priceUSD.StringFixed(2), err.Error()))
		paymentError(c, nowPaymentsInvoiceError(err))
		return
	}

	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amount = decimal.NewFromInt(amount).Div(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
	}
	topUp := &model.TopUp{
		UserId:          id,
		Amount:          amount,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodNowPayments,
		PaymentProvider: model.PaymentProviderNowPayments,
		BonusQuota:      int64(bonusQuota),
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("NOWPayments failed to create top-up order user_id=%d trade_no=%s error=%q", id, tradeNo, err.Error()))
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("NOWPayments top-up order created user_id=%d trade_no=%s amount=%d money=%.2f price_usd=%s pay_currency=%s", id, tradeNo, req.Amount, payMoney, priceUSD.StringFixed(2), payCurrency))
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"pay_link": invoiceURL}})
}

// nowPaymentsInvoiceError is what the customer reads when NOWPayments
// refuses an invoice.
func nowPaymentsInvoiceError(err error) *common.Message {
	if strings.Contains(err.Error(), "AMOUNT_MINIMAL_ERROR") {
		return common.NewMessage("The amount is below this network's minimum. Choose a larger amount or another network.")
	}
	return common.NewMessage("Failed to start payment")
}

// isNowPaymentsPayCurrency reports whether the wallet offers this ticker now.
func isNowPaymentsPayCurrency(payCurrency string) bool {
	return slices.ContainsFunc(setting.GetNowPaymentsPayCurrencies(), func(currency setting.NowPaymentsCurrency) bool {
		return currency.Code == payCurrency
	})
}

// createNowPaymentsInvoice opens a hosted invoice for priceUSD, paid in
// payCurrency, and returns the page the customer pays on. successPath is the
// console page the customer returns to once paid.
func createNowPaymentsInvoice(ctx context.Context, tradeNo string, priceUSD decimal.Decimal, payCurrency string, description string, successPath string) (string, error) {
	body, err := common.Marshal(map[string]any{
		"price_amount":      priceUSD.InexactFloat64(),
		"price_currency":    "usd",
		"pay_currency":      payCurrency,
		"order_id":          tradeNo,
		"order_description": description,
		"ipn_callback_url":  strings.TrimRight(service.GetCallbackAddress(), "/") + "/api/nowpayments/webhook",
		"success_url":       paymentReturnPath(successPath),
		"cancel_url":        paymentReturnPath("/wallet"),
	})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, nowPaymentsAPIBase+"/invoice", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("x-api-key", strings.TrimSpace(setting.NowPaymentsApiKey))
	request.Header.Set("Content-Type", "application/json")
	response, err := nowPaymentsHTTPClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("status %d: %s", response.StatusCode, string(responseBody))
	}
	var invoice struct {
		InvoiceURL string `json:"invoice_url"`
	}
	if err := common.Unmarshal(responseBody, &invoice); err != nil {
		return "", err
	}
	if !strings.HasPrefix(invoice.InvoiceURL, "https://") {
		return "", fmt.Errorf("invoice has no https invoice_url: %s", string(responseBody))
	}
	return invoice.InvoiceURL, nil
}

// nowPaymentsSignedForms are the strings NOWPayments may have signed for one
// IPN body: its keys sorted at every level, with arrays kept, as Python's
// json.dumps(sort_keys=True) writes them, and with arrays turned into
// index-keyed objects, as the Node example in their docs does. Values keep
// their original JSON text, so numbers are not reformatted.
func nowPaymentsSignedForms(body []byte) ([][]byte, error) {
	var forms [][]byte
	for _, arraysAsObjects := range []bool{false, true} {
		var buffer bytes.Buffer
		if err := writeSortedJSON(&buffer, bytes.TrimSpace(body), arraysAsObjects); err != nil {
			return nil, err
		}
		forms = append(forms, buffer.Bytes())
	}
	return forms, nil
}

func writeSortedJSON(buffer *bytes.Buffer, raw []byte, arraysAsObjects bool) error {
	switch common.GetJsonType(raw) {
	case "object":
		var fields map[string]common.RawMessage
		if err := common.Unmarshal(raw, &fields); err != nil {
			return err
		}
		keys := make([]string, 0, len(fields))
		for key := range fields {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		buffer.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				buffer.WriteByte(',')
			}
			encodedKey, err := common.Marshal(key)
			if err != nil {
				return err
			}
			buffer.Write(encodedKey)
			buffer.WriteByte(':')
			if err := writeSortedJSON(buffer, bytes.TrimSpace(fields[key]), arraysAsObjects); err != nil {
				return err
			}
		}
		buffer.WriteByte('}')
	case "array":
		var items []common.RawMessage
		if err := common.Unmarshal(raw, &items); err != nil {
			return err
		}
		open, closing := byte('['), byte(']')
		if arraysAsObjects {
			open, closing = '{', '}'
		}
		buffer.WriteByte(open)
		for i, item := range items {
			if i > 0 {
				buffer.WriteByte(',')
			}
			if arraysAsObjects {
				buffer.WriteString(`"` + strconv.Itoa(i) + `":`)
			}
			if err := writeSortedJSON(buffer, bytes.TrimSpace(item), arraysAsObjects); err != nil {
				return err
			}
		}
		buffer.WriteByte(closing)
	default:
		buffer.Write(raw)
	}
	return nil
}

// verifyNowPaymentsSignature checks x-nowpayments-sig, an HMAC-SHA512 of the
// key-sorted body under the IPN secret.
func verifyNowPaymentsSignature(body []byte, signature string, secret string) bool {
	signature = strings.ToLower(strings.TrimSpace(signature))
	if signature == "" || secret == "" {
		return false
	}
	expected, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}
	forms, err := nowPaymentsSignedForms(body)
	if err != nil {
		return false
	}
	for _, form := range forms {
		mac := hmac.New(sha512.New, []byte(secret))
		mac.Write(form)
		if hmac.Equal(mac.Sum(nil), expected) {
			return true
		}
	}
	return false
}

type nowPaymentsNotification struct {
	PaymentID       common.RawMessage `json:"payment_id"`
	ParentPaymentID common.RawMessage `json:"parent_payment_id"`
	PaymentStatus   string            `json:"payment_status"`
	OrderID         string            `json:"order_id"`
	PriceAmount     common.RawMessage `json:"price_amount"`
	PriceCurrency   string            `json:"price_currency"`
	PayAmount       common.RawMessage `json:"pay_amount"`
	ActuallyPaid    common.RawMessage `json:"actually_paid"`
	PayCurrency     string            `json:"pay_currency"`
}

func NowPaymentsWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	callerIp := c.ClientIP()
	if !isNowPaymentsWebhookEnabled() {
		logger.LogWarn(ctx, common.LogText("NOWPayments webhook rejected reason=webhook_disabled client_ip=%s", callerIp))
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.LogError(ctx, common.LogText("NOWPayments webhook failed to read request body client_ip=%s error=%q", callerIp, err.Error()))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	logger.LogInfo(ctx, common.LogText("NOWPayments webhook received request client_ip=%s body=%q", callerIp, string(body)))
	if !verifyNowPaymentsSignature(body, c.GetHeader("x-nowpayments-sig"), strings.TrimSpace(setting.NowPaymentsIpnSecret)) {
		logger.LogWarn(ctx, common.LogText("NOWPayments webhook signature verification failed client_ip=%s", callerIp))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	var notification nowPaymentsNotification
	if err := common.Unmarshal(body, &notification); err != nil {
		logger.LogWarn(ctx, common.LogText("NOWPayments webhook body is not a payment client_ip=%s error=%q", callerIp, err.Error()))
		c.Status(http.StatusOK)
		return
	}
	tradeNo := notification.OrderID
	summary := fmt.Sprintf("trade_no=%s payment_id=%s status=%s price=%s %s paid=%s/%s %s",
		tradeNo, string(notification.PaymentID), notification.PaymentStatus,
		string(notification.PriceAmount), notification.PriceCurrency,
		string(notification.ActuallyPaid), string(notification.PayAmount), notification.PayCurrency)
	if tradeNo == "" {
		logger.LogInfo(ctx, common.LogText("NOWPayments webhook ignored, no order %s client_ip=%s", summary, callerIp))
		c.Status(http.StatusOK)
		return
	}
	// A repeated or wrong-asset deposit carries the original payment as its
	// parent. Its amount need not match the order, so it is left to an
	// administrator, as NOWPayments recommends.
	if parent := strings.TrimSpace(string(notification.ParentPaymentID)); parent != "" && parent != "null" {
		logger.LogWarn(ctx, common.LogText("NOWPayments repeated or wrong-asset deposit needs manual review parent_payment_id=%s %s client_ip=%s", parent, summary, callerIp))
		notifyNowPaymentsFeishu("⚠️ USDT/USDC 重复转账或错币到账，需人工核对", tradeNo, notification)
		c.Status(http.StatusOK)
		return
	}

	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	if isNowPaymentsSubscriptionTradeNo(tradeNo) {
		if handleNowPaymentsSubscriptionNotification(c, ctx, tradeNo, body, notification, summary, callerIp) {
			c.Status(http.StatusOK)
		}
		return
	}
	switch notification.PaymentStatus {
	case "finished":
		alreadyDone, err := model.RechargeNowPayments(tradeNo, callerIp)
		switch {
		case err == nil && alreadyDone:
			logger.LogInfo(ctx, common.LogText("NOWPayments duplicate callback ignored %s client_ip=%s", summary, callerIp))
		case err == nil:
			logger.LogInfo(ctx, common.LogText("NOWPayments top-up succeeded %s client_ip=%s", summary, callerIp))
			notifyNowPaymentsFeishu("✅ USDT/USDC 充值到账", tradeNo, notification)
		case errors.Is(err, model.ErrTopUpNotFound), errors.Is(err, model.ErrPaymentMethodMismatch), errors.Is(err, model.ErrTopUpStatusInvalid):
			logger.LogWarn(ctx, common.LogText("NOWPayments callback not applied %s client_ip=%s error=%q", summary, callerIp, err.Error()))
			notifyNowPaymentsFeishu("⚠️ USDT/USDC 已付款但未入账，需人工核对", tradeNo, notification)
		default:
			logger.LogError(ctx, common.LogText("NOWPayments top-up processing failed %s client_ip=%s error=%q", summary, callerIp, err.Error()))
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	case "failed", "refunded":
		if markNowPaymentsOrder(ctx, tradeNo, common.TopUpStatusFailed, summary, callerIp) {
			notifyNowPaymentsFeishu("❌ USDT/USDC 付款失败或已退款", tradeNo, notification)
		}
	case "expired":
		markNowPaymentsOrder(ctx, tradeNo, common.TopUpStatusExpired, summary, callerIp)
	case "partially_paid":
		logger.LogWarn(ctx, common.LogText("NOWPayments order partially paid, left pending for manual review %s client_ip=%s", summary, callerIp))
		notifyNowPaymentsFeishu("⚠️ USDT/USDC 少付，需人工核对", tradeNo, notification)
	default:
		logger.LogInfo(ctx, common.LogText("NOWPayments payment status changed %s client_ip=%s", summary, callerIp))
	}
	c.Status(http.StatusOK)
}

// markNowPaymentsOrder closes a pending order and reports whether it did.
func markNowPaymentsOrder(ctx context.Context, tradeNo string, status string, summary string, callerIp string) bool {
	err := model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderNowPayments, status)
	if err != nil {
		logger.LogWarn(ctx, common.LogText("NOWPayments order status not changed to %s %s client_ip=%s error=%q", status, summary, callerIp, err.Error()))
		return false
	}
	logger.LogInfo(ctx, common.LogText("NOWPayments order marked %s %s client_ip=%s", status, summary, callerIp))
	return true
}

// sendNowPaymentsFeishu posts to the Feishu bot. Tests replace it.
var sendNowPaymentsFeishu = service.SendFeishuBotText

// notifyNowPaymentsFeishu tells the operators' Feishu group about a deposit,
// in the background, so the IPN is answered without waiting on Feishu.
func notifyNowPaymentsFeishu(title string, tradeNo string, notification nowPaymentsNotification) {
	webhook := strings.TrimSpace(setting.NowPaymentsFeishuWebhook)
	if webhook == "" {
		return
	}
	secret := setting.NowPaymentsFeishuSecret
	text := nowPaymentsFeishuText(title, tradeNo, notification)
	gopool.Go(func() {
		if err := sendNowPaymentsFeishu(webhook, secret, text); err != nil {
			common.SysError(common.LogText("NOWPayments Feishu notice not sent trade_no=%s error=%q", tradeNo, err.Error()))
		}
	})
}

// nowPaymentsFeishuText describes a deposit and the order it names, if any.
func nowPaymentsFeishuText(title string, tradeNo string, notification nowPaymentsNotification) string {
	lines := []string{title, "订单：" + tradeNo}
	if isNowPaymentsSubscriptionTradeNo(tradeNo) {
		lines = append(lines, nowPaymentsSubscriptionFeishuLines(tradeNo)...)
	} else if topUp := model.GetTopUpByTradeNo(tradeNo); topUp != nil {
		lines = append(lines, "用户："+nowPaymentsFeishuUser(topUp.UserId))
		order := fmt.Sprintf("充值：%d，应付 ¥%.2f", topUp.Amount, topUp.Money)
		if topUp.BonusQuota > 0 && common.QuotaPerUnit > 0 {
			order = fmt.Sprintf("充值：%d（赠送 %.2f），应付 ¥%.2f", topUp.Amount, float64(topUp.BonusQuota)/common.QuotaPerUnit, topUp.Money)
		}
		lines = append(lines, order)
	} else {
		lines = append(lines, "系统里没有这笔订单")
	}
	payCurrency := strings.ToUpper(notification.PayCurrency)
	lines = append(lines,
		fmt.Sprintf("账单：%s %s", nowPaymentsJSONText(notification.PriceAmount), strings.ToUpper(notification.PriceCurrency)),
		fmt.Sprintf("实付：%s / %s %s", nowPaymentsJSONText(notification.ActuallyPaid), nowPaymentsJSONText(notification.PayAmount), payCurrency),
		fmt.Sprintf("NOWPayments 状态：%s，payment_id %s", notification.PaymentStatus, nowPaymentsJSONText(notification.PaymentID)),
	)
	if parent := nowPaymentsJSONText(notification.ParentPaymentID); parent != "-" {
		lines = append(lines, "原付款 payment_id："+parent)
	}
	return strings.Join(lines, "\n")
}

// nowPaymentsFeishuUser names a user as "username #id", or "#id" alone.
func nowPaymentsFeishuUser(userId int) string {
	user := fmt.Sprintf("#%d", userId)
	if username, err := model.GetUsernameById(userId, false); err == nil && username != "" {
		user = username + " " + user
	}
	return user
}

// nowPaymentsJSONText shows a raw IPN value, quotes dropped, "-" when absent.
func nowPaymentsJSONText(raw common.RawMessage) string {
	text := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if text == "" || text == "null" {
		return "-"
	}
	return text
}

// TestNowPaymentsFeishu sends a test message to the saved Feishu bot.
func TestNowPaymentsFeishu(c *gin.Context) {
	if strings.TrimSpace(setting.NowPaymentsFeishuWebhook) == "" {
		common.ApiErrorT(c, "Save a Feishu webhook first.")
		return
	}
	text := "🔔 CoreCode NOWPayments 通知测试\n收到这条消息，说明 USDT/USDC 充值的飞书提醒已配置好。"
	if err := sendNowPaymentsFeishu(setting.NowPaymentsFeishuWebhook, setting.NowPaymentsFeishuSecret, text); err != nil {
		common.ApiErrorT(c, "Feishu did not accept the message: {{error}}", map[string]any{"error": err.Error()})
		return
	}
	common.ApiSuccessT(c, "Test message sent.", nil)
}
