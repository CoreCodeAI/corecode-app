package controller

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func signNowPayments(secret string, signed string) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write([]byte(signed))
	return hex.EncodeToString(mac.Sum(nil))
}

func TestNowPaymentsSignature(t *testing.T) {
	const secret = "ipn-secret"
	body := []byte(`{"payment_status":"finished", "price_amount":14.71,"fee":{"serviceFee":0,"currency":"usdttrc20"},"payment_extra_ids":[5,3],"order_id":"NP1"}`)
	// What Python's json.dumps(sort_keys=True, separators=(',', ':')) signs,
	// and what the Node example in NOWPayments' docs signs.
	python := `{"fee":{"currency":"usdttrc20","serviceFee":0},"order_id":"NP1","payment_extra_ids":[5,3],"payment_status":"finished","price_amount":14.71}`
	node := `{"fee":{"currency":"usdttrc20","serviceFee":0},"order_id":"NP1","payment_extra_ids":{"0":5,"1":3},"payment_status":"finished","price_amount":14.71}`

	assert.True(t, verifyNowPaymentsSignature(body, signNowPayments(secret, python), secret))
	assert.True(t, verifyNowPaymentsSignature(body, strings.ToUpper(signNowPayments(secret, node)), secret))
	assert.False(t, verifyNowPaymentsSignature(body, signNowPayments("other", python), secret))
	assert.False(t, verifyNowPaymentsSignature([]byte(strings.Replace(string(body), "14.71", "1471", 1)), signNowPayments(secret, python), secret))
	assert.False(t, verifyNowPaymentsSignature(body, "", secret))
	assert.False(t, verifyNowPaymentsSignature(body, signNowPayments("", python), ""))
}

func TestNowPaymentsPriceAndCurrencies(t *testing.T) {
	previousRate := operation_setting.USDExchangeRate
	t.Cleanup(func() { operation_setting.USDExchangeRate = previousRate })

	// ¥100 at 6.8 yuan to the dollar asks for 14.71 USDT or USDC.
	operation_setting.USDExchangeRate = 6.8
	for payMoney, want := range map[float64]string{100: "14.71", 1000: "147.06", 9.9: "1.46"} {
		price, err := nowPaymentsPriceUSD(payMoney)
		require.NoError(t, err)
		assert.Equal(t, want, price.StringFixed(2), "¥%v", payMoney)
	}
	operation_setting.USDExchangeRate = 0
	_, err := nowPaymentsPriceUSD(100)
	require.Error(t, err)

	currencies, err := setting.ParseNowPaymentsPayCurrencies(" USDC, usdttrc20,,")
	require.NoError(t, err)
	assert.Equal(t, []setting.NowPaymentsCurrency{
		{Code: "usdttrc20", Coin: "USDT", Network: "TRC20"},
		{Code: "usdc", Coin: "USDC", Network: "ERC20"},
	}, currencies, "catalog order, whatever order the option lists")
	_, err = setting.ParseNowPaymentsPayCurrencies("usdttrc20,btc")
	require.Error(t, err, "only USDT and USDC are accepted")
	defaults, err := setting.ParseNowPaymentsPayCurrencies(setting.NowPaymentsPayCurrencies)
	require.NoError(t, err)
	assert.NotEmpty(t, defaults)
}

func TestNowPaymentsWebhookCreditsFinishedOrderOnce(t *testing.T) {
	const secret = "ipn-secret"
	previous := struct {
		redis, confirmed         bool
		apiKeyValue, secretValue string
		feishuWebhook            string
		quotaPerUnit             float64
		termsVersion             string
		db, logDB                *gorm.DB
	}{
		apiKeyValue: setting.NowPaymentsApiKey, secretValue: setting.NowPaymentsIpnSecret,
		feishuWebhook: setting.NowPaymentsFeishuWebhook,
		redis:         common.RedisEnabled, quotaPerUnit: common.QuotaPerUnit,
		confirmed:    operation_setting.GetPaymentSetting().ComplianceConfirmed,
		termsVersion: operation_setting.GetPaymentSetting().ComplianceTermsVersion,
		db:           model.DB, logDB: model.LOG_DB,
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret = "api-key", secret
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	setting.NowPaymentsFeishuWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test"
	previousSend := sendNowPaymentsFeishu
	notices := make(chan string, 16)
	sendNowPaymentsFeishu = func(webhook string, secret string, text string) error {
		notices <- text
		return nil
	}
	t.Cleanup(func() {
		sendNowPaymentsFeishu = previousSend
		setting.NowPaymentsFeishuWebhook = previous.feishuWebhook
		setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret = previous.apiKeyValue, previous.secretValue
		common.RedisEnabled = previous.redis
		common.QuotaPerUnit = previous.quotaPerUnit
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.termsVersion
		model.DB, model.LOG_DB = previous.db, previous.logDB
		require.NoError(t, sqlDB.Close())
	})

	user := &model.User{Username: "crypto_customer", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	for _, tradeNo := range []string{"NP-PAID", "NP-LATE"} {
		require.NoError(t, db.Create(&model.TopUp{UserId: user.Id, Amount: 100, Money: 100, TradeNo: tradeNo,
			PaymentMethod: model.PaymentMethodNowPayments, PaymentProvider: model.PaymentProviderNowPayments,
			BonusQuota: 5 * 500000, Status: common.TopUpStatusPending}).Error)
	}
	gin.SetMode(gin.TestMode)
	notify := func(body string, signature string) int {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/nowpayments/webhook", strings.NewReader(body))
		ctx.Request.Header.Set("x-nowpayments-sig", signature)
		NowPaymentsWebhook(ctx)
		return recorder.Code
	}
	signed := func(body string) int { return notify(body, signNowPayments(secret, body)) }
	// nextNotice is the Feishu message the last callback sent, or "" if none.
	nextNotice := func() string {
		select {
		case text := <-notices:
			return text
		case <-time.After(2 * time.Second):
			return ""
		}
	}
	noNotice := func(msg string) {
		select {
		case text := <-notices:
			t.Errorf("%s, but sent %q", msg, text)
		case <-time.After(200 * time.Millisecond):
		}
	}
	state := func(tradeNo string) (int, string) {
		var row model.User
		require.NoError(t, db.Select("quota").First(&row, user.Id).Error)
		return row.Quota, model.GetTopUpByTradeNo(tradeNo).Status
	}

	// Bodies are written with sorted keys, so each is its own signed form.
	finished := `{"actually_paid":14.71,"order_id":"NP-PAID","parent_payment_id":null,"pay_amount":14.71,"pay_currency":"usdttrc20","payment_id":11,"payment_status":"finished","price_amount":14.71,"price_currency":"usd"}`
	assert.Equal(t, http.StatusBadRequest, notify(finished, signNowPayments("forged", finished)))
	noNotice("a forged callback tells no one")
	quota, status := state("NP-PAID")
	assert.Equal(t, 0, quota)
	assert.Equal(t, common.TopUpStatusPending, status)

	assert.Equal(t, http.StatusOK, signed(strings.Replace(finished, `"finished"`, `"partially_paid"`, 1)))
	_, status = state("NP-PAID")
	assert.Equal(t, common.TopUpStatusPending, status, "a partial payment waits for an administrator")
	assert.Contains(t, nextNotice(), "少付")

	assert.Equal(t, http.StatusOK, signed(strings.Replace(finished, `"parent_payment_id":null`, `"parent_payment_id":10`, 1)))
	quota, _ = state("NP-PAID")
	assert.Equal(t, 0, quota, "a repeated or wrong-asset deposit is not credited automatically")
	notice := nextNotice()
	assert.Contains(t, notice, "错币")
	assert.Contains(t, notice, "原付款 payment_id：10")

	assert.Equal(t, http.StatusOK, signed(finished))
	notice = nextNotice()
	for _, want := range []string{"充值到账", "订单：NP-PAID", "用户：crypto_customer #", "充值：100（赠送 5.00），应付 ¥100.00",
		"账单：14.71 USD", "实付：14.71 / 14.71 USDTTRC20", "payment_id 11"} {
		assert.Contains(t, notice, want)
	}
	assert.NotContains(t, notice, "原付款")
	assert.Equal(t, http.StatusOK, signed(finished))
	noNotice("a repeated callback is not announced twice")
	quota, status = state("NP-PAID")
	assert.Equal(t, 105*500000, quota, "the paid amount and its bonus, once")
	assert.Equal(t, common.TopUpStatusSuccess, status)

	assert.Equal(t, http.StatusOK, signed(strings.NewReplacer(`"NP-PAID"`, `"NP-LATE"`, `"finished"`, `"expired"`).Replace(finished)))
	_, status = state("NP-LATE")
	assert.Equal(t, common.TopUpStatusExpired, status)
	noNotice("an abandoned invoice is not announced")

	// A finished payment for an order the system does not have is announced
	// for review.
	assert.Equal(t, http.StatusOK, signed(strings.Replace(finished, `"NP-PAID"`, `"NP-UNKNOWN"`, 1)))
	notice = nextNotice()
	assert.Contains(t, notice, "未入账")
	assert.Contains(t, notice, "系统里没有这笔订单")
}
