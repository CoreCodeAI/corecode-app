package controller

import (
	"bytes"
	"io"
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

func TestNowPaymentsSubscriptionPurchase(t *testing.T) {
	const secret = "ipn-secret"
	paymentSetting := operation_setting.GetPaymentSetting()
	previous := struct {
		apiKey, ipnSecret, currencies, feishu, apiBase, terms string
		redis, confirmed                                      bool
		quotaPerUnit, rate                                    float64
		db, logDB                                             *gorm.DB
		send                                                  func(string, string, string) error
	}{setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret, setting.NowPaymentsPayCurrencies, setting.NowPaymentsFeishuWebhook,
		nowPaymentsAPIBase, paymentSetting.ComplianceTermsVersion, common.RedisEnabled, paymentSetting.ComplianceConfirmed,
		common.QuotaPerUnit, operation_setting.USDExchangeRate, model.DB, model.LOG_DB, sendNowPaymentsFeishu}

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	operation_setting.USDExchangeRate = 6.8
	setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret = "api-key", secret
	setting.NowPaymentsPayCurrencies = "usdtbsc,usdcarb"
	setting.NowPaymentsFeishuWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test"
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	notices := make(chan string, 16)
	sendNowPaymentsFeishu = func(_ string, _ string, text string) error {
		notices <- text
		return nil
	}
	var invoiceBody []byte
	invoiceAnswer := `{"invoice_url":"https://nowpayments.io/payment/?iid=42"}`
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoiceBody, _ = io.ReadAll(r.Body)
		if strings.Contains(invoiceAnswer, "AMOUNT_MINIMAL_ERROR") {
			w.WriteHeader(http.StatusBadRequest)
		}
		_, _ = w.Write([]byte(invoiceAnswer))
	}))
	nowPaymentsAPIBase = stub.URL
	t.Cleanup(func() {
		stub.Close()
		setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret = previous.apiKey, previous.ipnSecret
		setting.NowPaymentsPayCurrencies, setting.NowPaymentsFeishuWebhook = previous.currencies, previous.feishu
		nowPaymentsAPIBase, sendNowPaymentsFeishu = previous.apiBase, previous.send
		paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion = previous.confirmed, previous.terms
		common.RedisEnabled, common.QuotaPerUnit = previous.redis, previous.quotaPerUnit
		operation_setting.USDExchangeRate = previous.rate
		model.DB, model.LOG_DB = previous.db, previous.logDB
		require.NoError(t, sqlDB.Close())
	})

	user := &model.User{Username: "plan_customer", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	plan := &model.SubscriptionPlan{Id: 7301, Title: "新人福利包", PriceAmount: 29.9, TotalAmount: 50 * 500000,
		DurationUnit: "day", DurationValue: 7, QuotaResetPeriod: "never", Enabled: true, MaxPurchasePerUser: 1}
	require.NoError(t, db.Create(plan).Error)

	gin.SetMode(gin.TestMode)
	pay := func(body string) (int, string) {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/nowpayments/pay", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		SubscriptionRequestNowPaymentsPay(ctx)
		return recorder.Code, recorder.Body.String()
	}
	notify := func(body string) int {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/nowpayments/webhook", bytes.NewReader([]byte(body)))
		ctx.Request.Header.Set("x-nowpayments-sig", signNowPayments(secret, body))
		NowPaymentsWebhook(ctx)
		return recorder.Code
	}
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
	orders := func() []model.SubscriptionOrder {
		var rows []model.SubscriptionOrder
		require.NoError(t, db.Order("id").Find(&rows).Error)
		return rows
	}
	subscriptions := func() int64 {
		var n int64
		require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&n).Error)
		return n
	}

	// A ticker the wallet does not offer is refused before NOWPayments is asked.
	_, body := pay(`{"plan_id":7301,"pay_currency":"usdttrc20"}`)
	assert.Contains(t, body, "Payment method does not exist")
	assert.Nil(t, invoiceBody)

	// A refused invoice creates no order.
	invoiceAnswer = `{"status":false,"statusCode":400,"code":"AMOUNT_MINIMAL_ERROR","message":"amountTo is too small"}`
	_, body = pay(`{"plan_id":7301,"pay_currency":"usdtbsc"}`)
	assert.Contains(t, body, "below this network's minimum")
	assert.Empty(t, orders())

	// ¥29.9 at 6.8 is invoiced as $4.40 in the chosen coin; the order keeps ¥.
	invoiceAnswer = `{"invoice_url":"https://nowpayments.io/payment/?iid=42"}`
	for range 2 { // two open invoices for a plan limited to one purchase
		code, body := pay(`{"plan_id":7301,"pay_currency":"USDCARB"}`)
		require.Equal(t, http.StatusOK, code)
		assert.Contains(t, body, `"pay_link":"https://nowpayments.io/payment/?iid=42"`)
	}
	var invoice map[string]any
	require.NoError(t, common.Unmarshal(invoiceBody, &invoice))
	assert.Equal(t, 4.4, invoice["price_amount"])
	assert.Equal(t, "usd", invoice["price_currency"])
	assert.Equal(t, "usdcarb", invoice["pay_currency"])
	assert.True(t, strings.HasSuffix(invoice["success_url"].(string), "/wallet"))
	rows := orders()
	require.Len(t, rows, 2)
	first, second := rows[0], rows[1]
	assert.True(t, isNowPaymentsSubscriptionTradeNo(first.TradeNo))
	assert.Equal(t, 29.9, first.Money)
	assert.Equal(t, model.PaymentProviderNowPayments, first.PaymentProvider)
	assert.Equal(t, common.TopUpStatusPending, first.Status)

	// Bodies are written with sorted keys, so each is its own signed form.
	ipn := func(tradeNo, status string) string {
		return `{"actually_paid":4.4,"order_id":"` + tradeNo + `","parent_payment_id":null,"pay_amount":4.4,"pay_currency":"usdcarb","payment_id":77,"payment_status":"` + status + `","price_amount":4.4,"price_currency":"usd"}`
	}
	assert.Equal(t, http.StatusOK, notify(ipn(first.TradeNo, "partially_paid")))
	assert.Contains(t, nextNotice(), "套餐少付")
	assert.Equal(t, int64(0), subscriptions())

	assert.Equal(t, http.StatusOK, notify(ipn(first.TradeNo, "finished")))
	notice := nextNotice()
	for _, want := range []string{"套餐购买成功", "订单：" + first.TradeNo, "用户：plan_customer #", "套餐：新人福利包 #7301，应付 ¥29.90", "账单：4.4 USD", "实付：4.4 / 4.4 USDCARB"} {
		assert.Contains(t, notice, want)
	}
	assert.Equal(t, int64(1), subscriptions())
	assert.Equal(t, common.TopUpStatusSuccess, model.GetSubscriptionOrderByTradeNo(first.TradeNo).Status)
	assert.Equal(t, http.StatusOK, notify(ipn(first.TradeNo, "finished")))
	noNotice("a repeated callback is not announced twice")
	assert.Equal(t, int64(1), subscriptions())

	// The second invoice is paid too, but the plan allows one purchase: the
	// order stays pending and a person is told.
	assert.Equal(t, http.StatusOK, notify(ipn(second.TradeNo, "finished")))
	assert.Contains(t, nextNotice(), "已付款但套餐未开通")
	assert.Equal(t, int64(1), subscriptions())
	assert.Equal(t, common.TopUpStatusPending, model.GetSubscriptionOrderByTradeNo(second.TradeNo).Status)

	// The limit is now reached, so a new invoice is refused.
	_, body = pay(`{"plan_id":7301,"pay_currency":"usdtbsc"}`)
	assert.Contains(t, body, "Purchase limit")
	assert.Len(t, orders(), 2)

	// A refund closes a pending order and is announced; an expiry is not.
	assert.Equal(t, http.StatusOK, notify(ipn(second.TradeNo, "refunded")))
	assert.Contains(t, nextNotice(), "套餐付款失败或已退款")
	assert.Equal(t, common.TopUpStatusExpired, model.GetSubscriptionOrderByTradeNo(second.TradeNo).Status)
	require.NoError(t, db.Create(&model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, Money: 29.9, TradeNo: "NPSUB-LATE",
		PaymentMethod: model.PaymentMethodNowPayments, PaymentProvider: model.PaymentProviderNowPayments, Status: common.TopUpStatusPending}).Error)
	assert.Equal(t, http.StatusOK, notify(ipn("NPSUB-LATE", "expired")))
	noNotice("an abandoned invoice is not announced")
	assert.Equal(t, common.TopUpStatusExpired, model.GetSubscriptionOrderByTradeNo("NPSUB-LATE").Status)

	// A plan trade number the system does not have is announced for review.
	assert.Equal(t, http.StatusOK, notify(ipn("NPSUB-UNKNOWN", "finished")))
	assert.Contains(t, nextNotice(), "系统里没有这笔套餐订单")
}
