package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setHKDPerCNYForTest primes the rate cache so a test opens Checkout without
// reaching an FX feed.
func setHKDPerCNYForTest(t *testing.T, rate string) {
	t.Helper()
	resetHKDPerCNYForTest(t)
	hkdPerCNY.rate = decimal.RequireFromString(rate)
	hkdPerCNY.fetchedAt = time.Now()
	hkdPerCNY.nextFetch = time.Now().Add(hkdPerCNYRefresh)
}

func resetHKDPerCNYForTest(t *testing.T) {
	t.Helper()
	hkdPerCNY.rate, hkdPerCNY.fetchedAt, hkdPerCNY.nextFetch = decimal.Zero, time.Time{}, time.Time{}
	t.Cleanup(func() {
		hkdPerCNY.rate, hkdPerCNY.fetchedAt, hkdPerCNY.nextFetch = decimal.Zero, time.Time{}, time.Time{}
	})
}

func TestStripeHKDPerCNYFallsBackAndCaches(t *testing.T) {
	resetHKDPerCNYForTest(t)
	var primaryBody, secondaryBody atomic.Value
	var primaryHits, secondaryHits atomic.Int32
	primaryBody.Store(`{"amount":1.0,"base":"CNY","date":"2026-11-06","rates":{"HKD":1.1748}}`)
	secondaryBody.Store(`{"result":"success","base_code":"CNY","rates":{"HKD":1.171391}}`)
	primaryStatus := atomic.Int32{}
	primaryStatus.Store(http.StatusOK)
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryHits.Add(1)
		w.WriteHeader(int(primaryStatus.Load()))
		_, _ = w.Write([]byte(primaryBody.Load().(string)))
	}))
	secondary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondaryHits.Add(1)
		_, _ = w.Write([]byte(secondaryBody.Load().(string)))
	}))
	previous := hkdPerCNYSources
	hkdPerCNYSources = []hkdPerCNYSource{
		{name: previous[0].name, url: primary.URL, parse: previous[0].parse},
		{name: previous[1].name, url: secondary.URL, parse: previous[1].parse},
	}
	t.Cleanup(func() {
		hkdPerCNYSources = previous
		primary.Close()
		secondary.Close()
	})
	ctx := context.Background()

	rate, err := stripeHKDPerCNY(ctx)
	require.NoError(t, err)
	assert.Equal(t, "1.1748", rate.String(), "the first source")
	_, err = stripeHKDPerCNY(ctx)
	require.NoError(t, err)
	assert.Equal(t, int32(1), primaryHits.Load(), "a fresh rate is reused for an hour")

	// The first source fails: the second one answers.
	primaryStatus.Store(http.StatusBadGateway)
	hkdPerCNY.nextFetch = time.Time{}
	rate, err = stripeHKDPerCNY(ctx)
	require.NoError(t, err)
	assert.Equal(t, "1.171391", rate.String())

	// Both fail or quote nonsense: the last rate serves while under a day old.
	primaryStatus.Store(http.StatusOK)
	primaryBody.Store(`{"rates":{"HKD":11.748}}`)
	secondaryBody.Store(`{"result":"error","error-type":"quota-reached"}`)
	hkdPerCNY.nextFetch = time.Time{}
	rate, err = stripeHKDPerCNY(ctx)
	require.NoError(t, err)
	assert.Equal(t, "1.171391", rate.String())
	hits := secondaryHits.Load()
	_, err = stripeHKDPerCNY(ctx)
	require.NoError(t, err)
	assert.Equal(t, hits, secondaryHits.Load(), "a failed refresh waits before the next try")

	// Past a day without a rate, no order is priced.
	hkdPerCNY.fetchedAt = time.Now().Add(-hkdPerCNYMaxAge - time.Minute)
	hkdPerCNY.nextFetch = time.Time{}
	_, err = stripeHKDPerCNY(ctx)
	assert.ErrorIs(t, err, errNoHKDRate)
}

func TestEpayTypeForSendsSmallStripeOrdersToEpay(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	previousMethods := operation_setting.PayMethods
	previousAddress, previousID, previousKey := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	previousMax := setting.StripeSmallOrderEpayMax
	t.Cleanup(func() {
		operation_setting.PayMethods = previousMethods
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previousAddress, previousID, previousKey
		setting.StripeSmallOrderEpayMax = previousMax
	})
	operation_setting.PayMethods = []map[string]string{
		{"name": "支付宝", "type": "alipay"},
		{"name": "微信", "type": model.PaymentMethodStripeWeChatPay},
		{"name": "银行卡", "type": model.PaymentMethodStripeCard},
	}
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "https://pay.example.com", "1000", "key"
	setting.StripeSmallOrderEpayMax = 50

	cases := []struct {
		method   string
		payMoney float64
		want     string
	}{
		{"alipay", 500, "alipay"},
		{model.PaymentMethodStripeWeChatPay, 10, "wxpay"},
		{model.PaymentMethodStripeWeChatPay, 50, "wxpay"},
		{model.PaymentMethodStripeWeChatPay, 50.01, ""},
		{model.PaymentMethodStripeCard, 10, ""},
		{model.PaymentMethodStripeAlipay, 10, ""}, // not listed
		{"wxpay", 10, ""},                         // not listed
	}
	for _, tc := range cases {
		got, ok := epayTypeFor(tc.method, tc.payMoney)
		assert.Equal(t, tc.want, got, "%s ¥%v", tc.method, tc.payMoney)
		assert.Equal(t, tc.want != "", ok, "%s ¥%v", tc.method, tc.payMoney)
	}

	setting.StripeSmallOrderEpayMax = 0
	_, ok := epayTypeFor(model.PaymentMethodStripeWeChatPay, 10)
	assert.False(t, ok, "off at zero")
	setting.StripeSmallOrderEpayMax = 50
	operation_setting.EpayKey = ""
	_, ok = epayTypeFor(model.PaymentMethodStripeWeChatPay, 10)
	assert.False(t, ok, "off while epay is not configured")
}

// TestSmallStripeWeChatTopUpGoesThroughEpay posts the wallet's WeChat button
// to the epay endpoint, as the console does at or below the threshold, and
// reads the order and the method the console is told.
func TestSmallStripeWeChatTopUpGoesThroughEpay(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	previous := struct {
		methods             []map[string]string
		address, id, key    string
		price               float64
		minTopUp            int
		epayMax             float64
		apiSecret, whSecret string
		redis               bool
		db, logDB           *gorm.DB
	}{operation_setting.PayMethods, operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey,
		operation_setting.Price, operation_setting.MinTopUp, setting.StripeSmallOrderEpayMax,
		setting.StripeApiSecret, setting.StripeWebhookSecret, common.RedisEnabled, model.DB, model.LOG_DB}
	// InitDB, not a bare gorm.Open: RequestEpay reads the user's group
	// through the column names InitDB sets.
	previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
	t.Setenv("SQL_DSN", "")
	common.SQLitePath, common.IsMasterNode, common.RedisEnabled = t.TempDir()+"/epay.db", true, false
	require.NoError(t, model.InitDB())
	db := model.DB
	model.LOG_DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		common.SQLitePath, common.IsMasterNode = previousPath, previousMaster
		operation_setting.PayMethods = previous.methods
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = previous.address, previous.id, previous.key
		operation_setting.Price, operation_setting.MinTopUp = previous.price, previous.minTopUp
		setting.StripeSmallOrderEpayMax = previous.epayMax
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.apiSecret, previous.whSecret
		model.DB, model.LOG_DB, common.RedisEnabled = previous.db, previous.logDB, previous.redis
		require.NoError(t, sqlDB.Close())
	})
	operation_setting.PayMethods = []map[string]string{
		{"name": "支付宝", "type": "alipay"},
		{"name": "微信", "type": model.PaymentMethodStripeWeChatPay},
		{"name": "银行卡", "type": model.PaymentMethodStripeCard},
	}
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "https://pay.example.com", "1000", "key"
	operation_setting.Price, operation_setting.MinTopUp = 1, 10
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", "whsec_test"
	setting.StripeSmallOrderEpayMax = 50

	user := &model.User{Username: "small_buyer", Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)
	plan := &model.SubscriptionPlan{Id: 7402, Title: "新人福利包", PriceAmount: 29.9, TotalAmount: 50 * 500000,
		DurationUnit: "day", DurationValue: 7, QuotaResetPeriod: "never", Enabled: true}
	require.NoError(t, db.Create(plan).Error)

	gin.SetMode(gin.TestMode)
	send := func(handler gin.HandlerFunc, method, path, body string) string {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(method, path, strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		handler(ctx)
		return recorder.Body.String()
	}

	// The console learns the threshold on the WeChat button only.
	info := send(GetTopUpInfo, http.MethodGet, "/api/user/topup/info", "")
	var response struct {
		Data struct {
			PayMethods []map[string]string `json:"pay_methods"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal([]byte(info), &response))
	epayMax := map[string]string{}
	for _, method := range response.Data.PayMethods {
		epayMax[method["type"]] = method["epay_max_money"]
	}
	assert.Equal(t, map[string]string{"alipay": "", "stripe_wechat_pay": "50", "stripe_card": ""}, epayMax)
	assert.NotContains(t, operation_setting.PayMethods[1], "epay_max_money", "the option is not changed")

	// ¥50 by WeChat: an epay wxpay order.
	body := send(RequestEpay, http.MethodPost, "/api/user/pay", `{"amount":50,"payment_method":"stripe_wechat_pay"}`)
	assert.Contains(t, body, `"type":"wxpay"`)
	var orders []model.TopUp
	require.NoError(t, db.Order("id").Find(&orders).Error)
	require.Len(t, orders, 1)
	assert.Equal(t, "wxpay", orders[0].PaymentMethod)
	assert.Equal(t, model.PaymentProviderEpay, orders[0].PaymentProvider)
	assert.InDelta(t, 50, orders[0].Money, 1e-9)

	// ¥51 by WeChat, or any card order, is Stripe's: epay refuses it.
	send(RequestEpay, http.MethodPost, "/api/user/pay", `{"amount":51,"payment_method":"stripe_wechat_pay"}`)
	send(RequestEpay, http.MethodPost, "/api/user/pay", `{"amount":20,"payment_method":"stripe_card"}`)
	require.NoError(t, db.Order("id").Find(&orders).Error)
	assert.Len(t, orders, 1)

	// A ¥29.9 plan by WeChat: an epay wxpay plan order.
	body = send(SubscriptionRequestEpay, http.MethodPost, "/api/subscription/epay/pay", `{"plan_id":7402,"payment_method":"stripe_wechat_pay"}`)
	assert.Contains(t, body, `"type":"wxpay"`)
	var planOrders []model.SubscriptionOrder
	require.NoError(t, db.Where("plan_id = ?", plan.Id).Find(&planOrders).Error)
	require.Len(t, planOrders, 1)
	assert.Equal(t, "wxpay", planOrders[0].PaymentMethod)
	assert.Equal(t, model.PaymentProviderEpay, planOrders[0].PaymentProvider)
}

// TestStripeAmountQuoteCarriesTheHKDCharge reads the amount the console
// quotes before its confirm dialog: the CNY price as before, plus the HKD
// Checkout will charge while a rate is available, and no HKD field, with the
// CNY quote intact, while none is.
func TestStripeAmountQuoteCarriesTheHKDCharge(t *testing.T) {
	confirmPaymentComplianceForTest(t)
	previous := struct {
		price               float64
		minTopUp            int
		discount            float64
		apiSecret, whSecret string
		redis               bool
		db, logDB           *gorm.DB
	}{operation_setting.Price, operation_setting.MinTopUp, setting.StripeHKDDiscount,
		setting.StripeApiSecret, setting.StripeWebhookSecret, common.RedisEnabled, model.DB, model.LOG_DB}
	previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
	t.Setenv("SQL_DSN", "")
	common.SQLitePath, common.IsMasterNode, common.RedisEnabled = t.TempDir()+"/quote.db", true, false
	require.NoError(t, model.InitDB())
	db := model.DB
	model.LOG_DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	previousSources := hkdPerCNYSources
	t.Cleanup(func() {
		common.SQLitePath, common.IsMasterNode = previousPath, previousMaster
		operation_setting.Price, operation_setting.MinTopUp = previous.price, previous.minTopUp
		setting.StripeHKDDiscount = previous.discount
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.apiSecret, previous.whSecret
		model.DB, model.LOG_DB, common.RedisEnabled = previous.db, previous.logDB, previous.redis
		hkdPerCNYSources = previousSources
		require.NoError(t, sqlDB.Close())
	})
	operation_setting.Price, operation_setting.MinTopUp = 1, 10
	setting.StripeHKDDiscount = 0
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", "whsec_test"
	user := &model.User{Username: "quote_buyer", Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)

	gin.SetMode(gin.TestMode)
	quote := func() map[string]any {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/stripe/amount", strings.NewReader(`{"amount":100}`))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		RequestStripeAmount(ctx)
		var body map[string]any
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &body))
		return body
	}

	setHKDPerCNYForTest(t, "1.1748")
	body := quote()
	assert.Equal(t, "success", body["message"])
	assert.Equal(t, "100.00", body["data"], "the CNY quote is unchanged")
	assert.Equal(t, "117.48", body["hkd_amount"], "the HKD Checkout charges for it")

	// Every source is down and nothing is cached: still a CNY quote.
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(down.Close)
	resetHKDPerCNYForTest(t)
	hkdPerCNYSources = []hkdPerCNYSource{{name: "down", url: down.URL, parse: previousSources[0].parse}}
	body = quote()
	assert.Equal(t, "success", body["message"])
	assert.Equal(t, "100.00", body["data"])
	assert.NotContains(t, body, "hkd_amount", "no rate: the console explains instead of guessing")
}
