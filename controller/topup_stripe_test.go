package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/webhook"
	"gorm.io/gorm"
)

func TestStripeCheckoutChargesThePriceInHKD(t *testing.T) {
	previousDiscount := setting.StripeHKDDiscount
	t.Cleanup(func() { setting.StripeHKDDiscount = previousDiscount })
	rate := decimal.RequireFromString("1.1748")
	setting.StripeHKDDiscount = 0
	for payMoney, cents := range map[float64]int64{100: 11748, 9.9: 1163, 1234.565: 145036, 50.01: 5875} {
		assert.Equal(t, cents, stripeHKDCents(payMoney, rate), "¥%v at the market rate, rounded down", payMoney)
	}
	// The discount keeps a wallet's conversion at or under the CNY price:
	// ¥100 is HK$116.89, which WeChat Pay's 1.1713 on 2026-11-08 makes ¥99.80.
	setting.StripeHKDDiscount = 0.005
	assert.Equal(t, int64(11689), stripeHKDCents(100, rate))
	setting.StripeHKDDiscount = 0.5
	assert.Equal(t, int64(11160), stripeHKDCents(100, rate), "capped at 5%")
	setting.StripeHKDDiscount = -1
	assert.Equal(t, int64(11748), stripeHKDCents(100, rate), "never a surcharge")

	params := stripeCheckoutParams("ref_1", "", "a@example.com", 100, 11689, "CoreCode 余额充值", nil, "", "")
	require.Len(t, params.LineItems, 1)
	item := params.LineItems[0]
	assert.Nil(t, item.Price, "no dashboard Price: the order sets the amount")
	assert.Equal(t, "hkd", *item.PriceData.Currency, "the settlement currency: no Stripe conversion fee")
	assert.Equal(t, int64(11689), *item.PriceData.UnitAmount)
	assert.Equal(t, "人民币价 ¥100.00", *item.PriceData.ProductData.Description)
	assert.Equal(t, int64(1), *item.Quantity)
	assert.False(t, *params.AdaptivePricing.Enabled, "HKD only: no local currency at Stripe's rate")

	first := stripeCheckoutParams("ref_1", "", "a@example.com", 100, 11689, "CoreCode 余额充值", nil, "", "")
	assert.Equal(t, paymentReturnPath("/wallet"), *first.SuccessURL, "a paid customer returns to the wallet")
	assert.Equal(t, paymentReturnPath("/wallet"), *first.CancelURL)
	assert.Nil(t, first.PaymentMethodTypes, "plain stripe offers every enabled method")
	assert.Nil(t, first.Customer)
	assert.Equal(t, "a@example.com", *first.CustomerEmail)
	again := stripeCheckoutParams("ref_2", "cus_1", "a@example.com", 100, 11689, "CoreCode 余额充值", nil, "", "")
	assert.Equal(t, "cus_1", *again.Customer)
	assert.Nil(t, again.CustomerEmail)
}

// TestStripeCheckoutOffersTheChosenMethod drives the plan endpoint against a
// stub Stripe API and reads the form it sends. Top-ups build the session
// with the same stripeCheckoutParams.
func TestStripeCheckoutOffersTheChosenMethod(t *testing.T) {
	paymentSetting := operation_setting.GetPaymentSetting()
	previous := struct {
		apiSecret, webhookSecret, terms string
		redis, confirmed                bool
		quotaPerUnit                    float64
		db, logDB                       *gorm.DB
	}{setting.StripeApiSecret, setting.StripeWebhookSecret, paymentSetting.ComplianceTermsVersion, common.RedisEnabled,
		paymentSetting.ComplianceConfirmed, common.QuotaPerUnit, model.DB, model.LOG_DB}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", "whsec_test"
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	setHKDPerCNYForTest(t, "1.1748")
	previousDiscount := setting.StripeHKDDiscount
	setting.StripeHKDDiscount = 0.005
	t.Cleanup(func() { setting.StripeHKDDiscount = previousDiscount })

	var form url.Values
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		form, _ = url.ParseQuery(string(body))
		_, _ = w.Write([]byte(`{"id":"cs_test_1","object":"checkout.session","url":"https://checkout.stripe.com/c/pay/cs_test_1"}`))
	}))
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(stub.URL)}))
	t.Cleanup(func() {
		stripe.SetBackend(stripe.APIBackend, nil)
		stub.Close()
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.apiSecret, previous.webhookSecret
		paymentSetting.ComplianceConfirmed, paymentSetting.ComplianceTermsVersion = previous.confirmed, previous.terms
		common.RedisEnabled, common.QuotaPerUnit = previous.redis, previous.quotaPerUnit
		model.DB, model.LOG_DB = previous.db, previous.logDB
		require.NoError(t, sqlDB.Close())
	})

	user := &model.User{Username: "stripe_buyer", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	plan := &model.SubscriptionPlan{Id: 7401, Title: "新人福利包", PriceAmount: 29.9, TotalAmount: 50 * 500000,
		DurationUnit: "day", DurationValue: 7, QuotaResetPeriod: "never", Enabled: true}
	require.NoError(t, db.Create(plan).Error)

	gin.SetMode(gin.TestMode)
	post := func(handler gin.HandlerFunc, body string) string {
		form = nil
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		handler(ctx)
		return recorder.Body.String()
	}

	// WeChat Pay: Checkout offers only WeChat Pay, as a web client, charges
	// the plan's CNY price once in HKD, and the order records the wallet
	// method and the CNY price.
	assert.Contains(t, post(SubscriptionRequestStripePay, `{"plan_id":7401,"payment_method":"stripe_wechat_pay"}`), "cs_test_1")
	assert.Equal(t, "payment", form.Get("mode"))
	assert.Equal(t, []string{"wechat_pay"}, form["payment_method_types[0]"])
	assert.Empty(t, form.Get("payment_method_types[1]"))
	assert.Equal(t, "web", form.Get("payment_method_options[wechat_pay][client]"))
	assert.Equal(t, "3495", form.Get("line_items[0][price_data][unit_amount]"), "¥29.9 × 1.1748 × 0.995 = HK$34.95")
	assert.Equal(t, "hkd", form.Get("line_items[0][price_data][currency]"))
	assert.Equal(t, "false", form.Get("adaptive_pricing[enabled]"))
	assert.Equal(t, "人民币价 ¥29.90", form.Get("line_items[0][price_data][product_data][description]"))
	assert.Equal(t, "新人福利包", form.Get("line_items[0][price_data][product_data][name]"))
	assert.Equal(t, paymentReturnPath("/wallet"), form.Get("success_url"))
	var orders []model.SubscriptionOrder
	require.NoError(t, db.Where("plan_id = ?", plan.Id).Order("id").Find(&orders).Error)
	require.Len(t, orders, 1)
	assert.Equal(t, model.PaymentMethodStripeWeChatPay, orders[0].PaymentMethod)
	assert.Equal(t, model.PaymentProviderStripe, orders[0].PaymentProvider)
	assert.InDelta(t, 29.9, orders[0].Money, 1e-9)

	// Card: cards only, no WeChat client.
	assert.Contains(t, post(SubscriptionRequestStripePay, `{"plan_id":7401,"payment_method":"stripe_card"}`), "cs_test_1")
	assert.Equal(t, []string{"card"}, form["payment_method_types[0]"])
	assert.Empty(t, form.Get("payment_method_options[wechat_pay][client]"))
	require.NoError(t, db.Where("plan_id = ?", plan.Id).Order("id").Find(&orders).Error)
	require.Len(t, orders, 2)
	assert.Equal(t, model.PaymentMethodStripeCard, orders[1].PaymentMethod)

	// No method: every method the dashboard enables.
	assert.Contains(t, post(SubscriptionRequestStripePay, `{"plan_id":7401}`), "cs_test_1")
	assert.Empty(t, form.Get("payment_method_types[0]"))

	// An unknown method opens no checkout.
	post(RequestStripePay, `{"amount":100,"payment_method":"stripe_paypal"}`)
	post(SubscriptionRequestStripePay, `{"plan_id":7401,"payment_method":"wxpay"}`)
	assert.Nil(t, form)
}

func TestTopUpInfoListsStripeMethodsOnlyWhileConfigured(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	previousMethods := operation_setting.PayMethods
	previousAPISecret, previousWebhookSecret := setting.StripeApiSecret, setting.StripeWebhookSecret
	previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}))
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	t.Cleanup(func() {
		operation_setting.PayMethods = previousMethods
		setting.StripeApiSecret, setting.StripeWebhookSecret = previousAPISecret, previousWebhookSecret
		model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis
		require.NoError(t, sqlDB.Close())
	})
	listed := []map[string]string{
		{"name": "支付宝", "type": "alipay"},
		{"name": "微信", "type": model.PaymentMethodStripeWeChatPay},
		{"name": "银行卡", "type": model.PaymentMethodStripeCard},
	}
	operation_setting.PayMethods = listed[:3:3]

	gin.SetMode(gin.TestMode)
	methodTypes := func() []string {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/info", nil)
		GetTopUpInfo(ctx)
		var response struct {
			Data struct {
				PayMethods []map[string]string `json:"pay_methods"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		types := []string{}
		for _, method := range response.Data.PayMethods {
			types = append(types, method["type"])
		}
		return types
	}

	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", "whsec_test"
	assert.Equal(t, []string{"alipay", "stripe_wechat_pay", "stripe_card"}, methodTypes()[:3],
		"listed Stripe methods, and no extra plain Stripe")
	assert.NotContains(t, methodTypes(), "stripe")

	setting.StripeWebhookSecret = ""
	assert.NotContains(t, methodTypes(), "stripe_wechat_pay", "hidden while Stripe is not configured")
	assert.Equal(t, listed, operation_setting.PayMethods, "the option is not changed")
}

func TestStripeWebhookCreditsAmountAndBonusOnce(t *testing.T) {
	const secret = "whsec_test"
	previous := struct {
		apiSecret, webhookSecret string
		redis, confirmed         bool
		termsVersion             string
		quotaPerUnit             float64
		db, logDB                *gorm.DB
	}{
		apiSecret: setting.StripeApiSecret, webhookSecret: setting.StripeWebhookSecret,
		redis: common.RedisEnabled, confirmed: operation_setting.GetPaymentSetting().ComplianceConfirmed,
		termsVersion: operation_setting.GetPaymentSetting().ComplianceTermsVersion,
		quotaPerUnit: common.QuotaPerUnit, db: model.DB, logDB: model.LOG_DB,
	}
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.SubscriptionOrder{}, &model.Log{}))
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", secret
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.apiSecret, previous.webhookSecret
		common.RedisEnabled = previous.redis
		common.QuotaPerUnit = previous.quotaPerUnit
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.termsVersion
		model.DB, model.LOG_DB = previous.db, previous.logDB
		require.NoError(t, sqlDB.Close())
	})

	user := &model.User{Username: "stripe_customer", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(user).Error)
	for _, tradeNo := range []string{"ref_paid", "ref_late"} {
		require.NoError(t, db.Create(&model.TopUp{UserId: user.Id, Amount: 100, Money: 100, TradeNo: tradeNo,
			PaymentMethod: model.PaymentMethodStripe, PaymentProvider: model.PaymentProviderStripe,
			BonusQuota: 11 * 500000, Status: common.TopUpStatusPending}).Error)
	}

	gin.SetMode(gin.TestMode)
	deliver := func(eventType string, tradeNo string, status string, paymentStatus string, signWith string) int {
		payload := fmt.Sprintf(`{"id":"evt_1","object":"event","api_version":"2026-10-28","type":%q,"data":{"object":{"object":"checkout.session","client_reference_id":%q,"customer":"cus_1","status":%q,"payment_status":%q,"amount_total":11748,"currency":"hkd"}}}`,
			eventType, tradeNo, status, paymentStatus)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(payload), Secret: signWith, Timestamp: time.Now()})
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(payload))
		ctx.Request.Header.Set("Stripe-Signature", signed.Header)
		StripeWebhook(ctx)
		return recorder.Code
	}
	state := func(tradeNo string) (int, string, string) {
		var row model.User
		require.NoError(t, db.Select("quota", "stripe_customer").First(&row, user.Id).Error)
		return row.Quota, row.StripeCustomer, model.GetTopUpByTradeNo(tradeNo).Status
	}

	assert.Equal(t, http.StatusBadRequest, deliver("checkout.session.completed", "ref_paid", "complete", "paid", "whsec_forged"))
	quota, _, status := state("ref_paid")
	assert.Equal(t, 0, quota)
	assert.Equal(t, common.TopUpStatusPending, status)

	assert.Equal(t, http.StatusOK, deliver("checkout.session.completed", "ref_paid", "complete", "unpaid", secret))
	_, _, status = state("ref_paid")
	assert.Equal(t, common.TopUpStatusPending, status, "an unpaid session waits for the async result")

	assert.Equal(t, http.StatusOK, deliver("checkout.session.completed", "ref_paid", "complete", "paid", secret))
	assert.Equal(t, http.StatusOK, deliver("checkout.session.async_payment_succeeded", "ref_paid", "complete", "paid", secret))
	quota, customer, status := state("ref_paid")
	assert.Equal(t, 111*500000, quota, "the amount and its bonus, once")
	assert.Equal(t, "cus_1", customer, "the next checkout reuses the Stripe customer")
	assert.Equal(t, common.TopUpStatusSuccess, status)

	assert.Equal(t, http.StatusOK, deliver("checkout.session.expired", "ref_late", "expired", "unpaid", secret))
	_, _, status = state("ref_late")
	assert.Equal(t, common.TopUpStatusExpired, status)
}
