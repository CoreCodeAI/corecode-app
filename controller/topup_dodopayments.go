package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// CoreCode addition: top-ups through Dodo Payments Checkout. An order is
// priced like an epay order, in CNY, and the checkout charges that price on
// a pay-what-you-want product. The order's trade_no is built from the
// checkout session id, so a webhook credits only a payment made in a session
// this server opened for that order.

// dodoPaymentsAPIBase overrides the mode's host. Tests point it at a stub.
var dodoPaymentsAPIBase = ""

var dodoPaymentsHTTPClient = &http.Client{Timeout: 20 * time.Second}

// dodoPaymentsWebhookTolerance is how far a webhook's timestamp may be from
// now, the window the Standard Webhooks libraries allow.
const dodoPaymentsWebhookTolerance = 5 * time.Minute

type DodoPaymentsPayRequest struct {
	Amount int64 `json:"amount"`
}

func dodoPaymentsBaseURL() string {
	if dodoPaymentsAPIBase != "" {
		return dodoPaymentsAPIBase
	}
	if setting.DodoPaymentsTestMode {
		return setting.DodoPaymentsTestAPIBase
	}
	return setting.DodoPaymentsLiveAPIBase
}

// dodoPaymentsTradeNo names the order a checkout session pays. Test-mode
// orders carry their own prefix so they stand apart in the top-up records.
func dodoPaymentsTradeNo(sessionID string) string {
	if setting.DodoPaymentsTestMode {
		return "DODOTEST_" + sessionID
	}
	return "DODO_" + sessionID
}

// dodoPaymentsCNYFen converts an order's CNY price to the fen Dodo charges.
func dodoPaymentsCNYFen(payMoney float64) int64 {
	return decimal.NewFromFloat(payMoney).Mul(decimal.NewFromInt(100)).Round(0).IntPart()
}

func RequestDodoPaymentsPay(c *gin.Context) {
	var req DodoPaymentsPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	if !canUseDodoPayments(c.GetInt("role")) {
		paymentError(c, common.NewMessage("Payment information has not been configured by administrator"))
		return
	}
	if req.Amount < getMinTopup() {
		paymentError(c, common.NewMessage("Top-up amount cannot be less than {{min}}", map[string]any{"min": getMinTopup()}))
		return
	}
	id := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, id, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to get the user group"))
		return
	}
	payMoney := getPayMoney(req.Amount, group)
	fen := dodoPaymentsCNYFen(payMoney)
	if fen < 1 {
		paymentError(c, common.NewMessage("Payment amount is too low"))
		return
	}
	bonusQuota, err := topUpBonusQuota(req.Amount)
	if err == nil && bonusQuota > 0 {
		quota, _ := getTopUpQuota(req.Amount)
		err = model.ValidateTopUpQuotaCapacity(id, quota+bonusQuota)
	}
	if err != nil {
		paymentError(c, err)
		return
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}

	sessionID, checkoutURL, err := createDodoPaymentsCheckout(c.Request.Context(), fen, user.Email, id)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Dodo Payments failed to create checkout user_id=%d money=%.2f error=%q", id, payMoney, err.Error()))
		paymentError(c, common.NewMessage("Failed to start payment"))
		return
	}

	amount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		amount = decimal.NewFromInt(amount).Div(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
	}
	tradeNo := dodoPaymentsTradeNo(sessionID)
	topUp := &model.TopUp{
		UserId:          id,
		Amount:          amount,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodDodoPayments,
		PaymentProvider: model.PaymentProviderDodoPayments,
		BonusQuota:      int64(bonusQuota),
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Dodo Payments failed to create top-up order user_id=%d trade_no=%s error=%q", id, tradeNo, err.Error()))
		paymentError(c, common.NewMessage("Failed to create order"))
		return
	}
	logger.LogInfo(c.Request.Context(), common.LogText("Dodo Payments top-up order created user_id=%d trade_no=%s amount=%d money=%.2f test_mode=%t", id, tradeNo, req.Amount, payMoney, setting.DodoPaymentsTestMode))
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": gin.H{"pay_link": checkoutURL}})
}

// createDodoPaymentsCheckout opens a checkout charging fen in CNY on the
// configured product and returns its session id and page. A discount code
// or another currency would change what is charged, so both are turned off.
func createDodoPaymentsCheckout(ctx context.Context, fen int64, email string, userID int) (sessionID string, checkoutURL string, err error) {
	payload := map[string]any{
		"product_cart": []map[string]any{{
			"product_id": strings.TrimSpace(setting.DodoPaymentsProductId),
			"quantity":   1,
			"amount":     fen,
		}},
		"billing_currency": "CNY",
		"feature_flags": map[string]any{
			"allow_discount_code":      false,
			"allow_currency_selection": false,
		},
		"metadata":   map[string]string{"user_id": strconv.Itoa(userID)},
		"return_url": paymentReturnPath("/wallet"),
		"cancel_url": paymentReturnPath("/wallet"),
	}
	if email = strings.TrimSpace(email); email != "" {
		payload["customer"] = map[string]string{"email": email}
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, dodoPaymentsBaseURL()+"/checkouts", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(setting.DodoPaymentsApiKey))
	request.Header.Set("Content-Type", "application/json")
	response, err := dodoPaymentsHTTPClient.Do(request)
	if err != nil {
		return "", "", err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", "", err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", fmt.Errorf("status %d: %s", response.StatusCode, string(responseBody))
	}
	var session struct {
		SessionID   string `json:"session_id"`
		CheckoutURL string `json:"checkout_url"`
	}
	if err := common.Unmarshal(responseBody, &session); err != nil {
		return "", "", err
	}
	if session.SessionID == "" || !strings.HasPrefix(session.CheckoutURL, "https://") {
		return "", "", fmt.Errorf("checkout has no session or https checkout_url: %s", string(responseBody))
	}
	return session.SessionID, session.CheckoutURL, nil
}

// verifyDodoPaymentsSignature checks a Standard Webhooks signature: an
// HMAC-SHA256 of "id.timestamp.body" under the base64 secret after its
// whsec_ prefix, matched against any "v1,<base64>" in the header, with the
// timestamp within the tolerance of now.
func verifyDodoPaymentsSignature(body []byte, id string, timestamp string, signatures string, secret string, now time.Time) bool {
	if id == "" || timestamp == "" || signatures == "" || secret == "" {
		return false
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := now.Sub(time.Unix(seconds, 0)); age > dodoPaymentsWebhookTolerance || age < -dodoPaymentsWebhookTolerance {
		return false
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil || len(key) == 0 {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + timestamp + "."))
	mac.Write(body)
	expected := mac.Sum(nil)
	for _, signature := range strings.Fields(signatures) {
		version, encoded, found := strings.Cut(signature, ",")
		if !found || version != "v1" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil && hmac.Equal(decoded, expected) {
			return true
		}
	}
	return false
}

type dodoPaymentsEvent struct {
	Type string `json:"type"`
	Data struct {
		PayloadType       string `json:"payload_type"`
		PaymentID         string `json:"payment_id"`
		CheckoutSessionID string `json:"checkout_session_id"`
		Status            string `json:"status"`
		TotalAmount       int64  `json:"total_amount"`
		Currency          string `json:"currency"`
	} `json:"data"`
}

func DodoPaymentsWebhook(c *gin.Context) {
	ctx := c.Request.Context()
	callerIp := c.ClientIP()
	if !isDodoPaymentsTopUpEnabled() {
		logger.LogWarn(ctx, common.LogText("Dodo Payments webhook rejected reason=webhook_disabled client_ip=%s", callerIp))
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		logger.LogError(ctx, common.LogText("Dodo Payments webhook failed to read request body client_ip=%s error=%q", callerIp, err.Error()))
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	webhookID := c.GetHeader("webhook-id")
	if !verifyDodoPaymentsSignature(body, webhookID, c.GetHeader("webhook-timestamp"), c.GetHeader("webhook-signature"), strings.TrimSpace(setting.DodoPaymentsWebhookSecret), time.Now()) {
		logger.LogWarn(ctx, common.LogText("Dodo Payments webhook signature verification failed webhook_id=%s client_ip=%s", webhookID, callerIp))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	var event dodoPaymentsEvent
	if err := common.Unmarshal(body, &event); err != nil {
		logger.LogWarn(ctx, common.LogText("Dodo Payments webhook body is not an event webhook_id=%s client_ip=%s error=%q", webhookID, callerIp, err.Error()))
		c.Status(http.StatusOK)
		return
	}
	data := event.Data
	summary := fmt.Sprintf("webhook_id=%s type=%s payment_id=%s session=%s status=%s total=%d %s",
		webhookID, event.Type, data.PaymentID, data.CheckoutSessionID, data.Status, data.TotalAmount, data.Currency)
	if event.Type != "payment.succeeded" {
		// A failed attempt leaves the session open for another, so the order
		// stays pending; refunds and disputes are an administrator's.
		logger.LogInfo(ctx, common.LogText("Dodo Payments webhook event not applied %s client_ip=%s", summary, callerIp))
		c.Status(http.StatusOK)
		return
	}
	if data.CheckoutSessionID == "" || data.Status != "succeeded" {
		logger.LogWarn(ctx, common.LogText("Dodo Payments payment has no checkout session or did not succeed %s client_ip=%s", summary, callerIp))
		c.Status(http.StatusOK)
		return
	}

	tradeNo := dodoPaymentsTradeNo(data.CheckoutSessionID)
	LockOrder(tradeNo)
	defer UnlockOrder(tradeNo)
	// The checkout charges the order's price in CNY with discount codes and
	// currency selection off. A payment for less, or in another currency,
	// means the dashboard changed something; it is left for an administrator.
	if topUp := model.GetTopUpByTradeNo(tradeNo); topUp != nil && topUp.Status == common.TopUpStatusPending {
		if !strings.EqualFold(data.Currency, "CNY") || data.TotalAmount < dodoPaymentsCNYFen(topUp.Money) {
			logger.LogWarn(ctx, common.LogText("Dodo Payments payment does not cover the order, left pending for manual review trade_no=%s money=%.2f %s client_ip=%s", tradeNo, topUp.Money, summary, callerIp))
			c.Status(http.StatusOK)
			return
		}
	}
	alreadyDone, err := model.RechargeDodoPayments(tradeNo, callerIp)
	switch {
	case err == nil && alreadyDone:
		logger.LogInfo(ctx, common.LogText("Dodo Payments duplicate callback ignored trade_no=%s %s client_ip=%s", tradeNo, summary, callerIp))
	case err == nil:
		logger.LogInfo(ctx, common.LogText("Dodo Payments top-up succeeded trade_no=%s %s client_ip=%s", tradeNo, summary, callerIp))
	case errors.Is(err, model.ErrTopUpNotFound), errors.Is(err, model.ErrPaymentMethodMismatch), errors.Is(err, model.ErrTopUpStatusInvalid):
		logger.LogWarn(ctx, common.LogText("Dodo Payments callback not applied trade_no=%s %s client_ip=%s error=%q", tradeNo, summary, callerIp, err.Error()))
	default:
		logger.LogError(ctx, common.LogText("Dodo Payments top-up processing failed trade_no=%s %s client_ip=%s error=%q", tradeNo, summary, callerIp, err.Error()))
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	c.Status(http.StatusOK)
}
