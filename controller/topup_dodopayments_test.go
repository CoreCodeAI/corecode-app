package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// The Standard Webhooks reference vector, also used by Svix's libraries.
func TestDodoPaymentsSignatureMatchesStandardWebhooks(t *testing.T) {
	const (
		secret    = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
		id        = "msg_p5jXN8AQM9LWM0D4loKWxJek"
		timestamp = "1614265330"
		signature = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
	)
	body := []byte(`{"test": 2432232314}`)
	sent := time.Unix(1614265330, 0)

	assert.True(t, verifyDodoPaymentsSignature(body, id, timestamp, signature, secret, sent))
	assert.True(t, verifyDodoPaymentsSignature(body, id, timestamp, "v1,bm90IGl0 "+signature, secret, sent.Add(4*time.Minute)),
		"any listed v1 signature may match")
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, signature, secret, sent.Add(6*time.Minute)), "a stale delivery is refused")
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, signature, secret, sent.Add(-6*time.Minute)), "a future timestamp is refused")
	assert.False(t, verifyDodoPaymentsSignature([]byte(`{"test": 2432232315}`), id, timestamp, signature, secret, sent))
	assert.False(t, verifyDodoPaymentsSignature(body, "msg_other", timestamp, signature, secret, sent))
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, "v2,"+strings.TrimPrefix(signature, "v1,"), secret, sent))
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, signature, "whsec_b3RoZXI=", sent))
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, "", secret, sent))
	assert.False(t, verifyDodoPaymentsSignature(body, id, timestamp, signature, "", sent))
}

func TestCanUseDodoPayments(t *testing.T) {
	previous := struct {
		apiKey, secret, product string
		adminOnly, confirmed    bool
		termsVersion            string
	}{setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId, setting.DodoPaymentsAdminOnly,
		operation_setting.GetPaymentSetting().ComplianceConfirmed, operation_setting.GetPaymentSetting().ComplianceTermsVersion}
	t.Cleanup(func() {
		setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId = previous.apiKey, previous.secret, previous.product
		setting.DodoPaymentsAdminOnly = previous.adminOnly
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.termsVersion
	})
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId = "key", "whsec_c2VjcmV0", ""
	assert.False(t, canUseDodoPayments(common.RoleRootUser), "no product, no method")

	setting.DodoPaymentsProductId = "pdt_1"
	setting.DodoPaymentsAdminOnly = true
	assert.False(t, canUseDodoPayments(common.RoleCommonUser))
	assert.True(t, canUseDodoPayments(common.RoleAdminUser))
	assert.True(t, canUseDodoPayments(common.RoleRootUser))

	setting.DodoPaymentsAdminOnly = false
	assert.True(t, canUseDodoPayments(common.RoleCommonUser))
}

func TestDodoPaymentsCheckoutAndWebhookCreditOnce(t *testing.T) {
	secretKey := []byte("dodo-webhook-key")
	secret := "whsec_" + base64.StdEncoding.EncodeToString(secretKey)
	previous := struct {
		apiKey, webhookSecret, product string
		testMode, adminOnly            bool
		apiBase                        string
		redis, confirmed               bool
		termsVersion                   string
		quotaPerUnit, price            float64
		minTopUp                       int
		db, logDB                      *gorm.DB
		dbType, logDBType              common.DatabaseType
		master, memoryCache            bool
		sqlitePath                     string
		methodTypes                    string
		maxMoney                       float64
		payMethods                     []map[string]string
	}{
		setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId,
		setting.DodoPaymentsTestMode, setting.DodoPaymentsAdminOnly, dodoPaymentsAPIBase,
		common.RedisEnabled, operation_setting.GetPaymentSetting().ComplianceConfirmed,
		operation_setting.GetPaymentSetting().ComplianceTermsVersion,
		common.QuotaPerUnit, operation_setting.Price, operation_setting.MinTopUp, model.DB, model.LOG_DB,
		common.MainDatabaseType(), common.LogDatabaseType(), common.IsMasterNode, common.MemoryCacheEnabled, common.SQLitePath,
		setting.DodoPaymentsMethodTypes, setting.DodoPaymentsMaxMoney, operation_setting.PayMethods,
	}
	// InitDB sets the quoted column names GetUserGroup reads with.
	t.Setenv("SQL_DSN", "")
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "dodo.db")
	require.NoError(t, model.InitDB())
	db := model.DB
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}, &model.UserContractBonus{}))
	model.LOG_DB = db
	common.SetLogDatabaseType(common.MainDatabaseType())

	// A stub Dodo API that answers one checkout per call and keeps each body.
	var checkouts []map[string]any
	var authorizations []string
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/checkouts", r.URL.Path)
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		require.NoError(t, common.Unmarshal(raw, &body))
		checkouts = append(checkouts, body)
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		id := "cks_" + strconv.Itoa(len(checkouts))
		_, _ = w.Write([]byte(`{"session_id":"` + id + `","checkout_url":"https://test.checkout.dodopayments.com/session/` + id + `"}`))
	}))

	common.RedisEnabled = false
	common.QuotaPerUnit = 500000
	operation_setting.Price = 1
	operation_setting.MinTopUp = 1
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId = "dodo_test_key", secret, "pdt_topup"
	setting.DodoPaymentsTestMode, setting.DodoPaymentsAdminOnly = true, true
	dodoPaymentsAPIBase = stub.URL
	t.Cleanup(func() {
		stub.Close()
		setting.DodoPaymentsApiKey, setting.DodoPaymentsWebhookSecret, setting.DodoPaymentsProductId = previous.apiKey, previous.webhookSecret, previous.product
		setting.DodoPaymentsTestMode, setting.DodoPaymentsAdminOnly = previous.testMode, previous.adminOnly
		setting.DodoPaymentsMethodTypes, setting.DodoPaymentsMaxMoney = previous.methodTypes, previous.maxMoney
		operation_setting.PayMethods = previous.payMethods
		dodoPaymentsAPIBase = previous.apiBase
		common.RedisEnabled = previous.redis
		common.QuotaPerUnit = previous.quotaPerUnit
		operation_setting.Price, operation_setting.MinTopUp = previous.price, previous.minTopUp
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.termsVersion
		model.DB, model.LOG_DB = previous.db, previous.logDB
		common.SetDatabaseTypes(previous.dbType, previous.logDBType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.SQLitePath = previous.master, previous.memoryCache, previous.sqlitePath
		require.NoError(t, sqlDB.Close())
	})

	admin := &model.User{Username: "dodo_admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Email: "admin@example.com", AffCode: "dodo-a"}
	customer := &model.User{Username: "dodo_customer", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AffCode: "dodo-c"}
	require.NoError(t, db.Create(admin).Error)
	require.NoError(t, db.Create(customer).Error)

	gin.SetMode(gin.TestMode)
	pay := func(user *model.User, amount int64) map[string]any {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/dodopayments/pay", strings.NewReader(`{"amount":`+strconv.FormatInt(amount, 10)+`}`))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		ctx.Set("role", user.Role)
		RequestDodoPaymentsPay(ctx)
		var response map[string]any
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		return response
	}

	refused := pay(customer, 10)
	assert.Equal(t, "error", refused["message"], "a customer cannot pay while the method is admin-only")
	assert.Empty(t, checkouts, "and no checkout is opened for them")

	opened := pay(admin, 10)
	require.Equal(t, "success", opened["message"], opened)
	assert.Equal(t, "https://test.checkout.dodopayments.com/session/cks_1", opened["data"].(map[string]any)["pay_link"])
	require.Len(t, checkouts, 1)
	assert.Equal(t, "Bearer dodo_test_key", authorizations[0])
	checkout := checkouts[0]
	assert.Equal(t, []any{map[string]any{"product_id": "pdt_topup", "quantity": float64(1), "amount": float64(1000)}}, checkout["product_cart"], "¥10 is 1000 fen")
	assert.Equal(t, "CNY", checkout["billing_currency"])
	assert.Equal(t, map[string]any{"allow_discount_code": false, "allow_currency_selection": false}, checkout["feature_flags"])
	assert.Equal(t, map[string]any{"email": "admin@example.com"}, checkout["customer"])
	assert.True(t, strings.HasSuffix(checkout["return_url"].(string), "/wallet"))

	order := model.GetTopUpByTradeNo("DODOTEST_cks_1")
	require.NotNil(t, order, "a test-mode order is named after its session")
	assert.Equal(t, common.TopUpStatusPending, order.Status)
	assert.Equal(t, 10.0, order.Money)

	notify := func(body string, signingKey []byte) int {
		id := "msg_" + common.GetRandomString(8)
		timestamp := strconv.FormatInt(time.Now().Unix(), 10)
		mac := hmac.New(sha256.New, signingKey)
		mac.Write([]byte(id + "." + timestamp + "." + body))
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/dodopayments/webhook", strings.NewReader(body))
		ctx.Request.Header.Set("webhook-id", id)
		ctx.Request.Header.Set("webhook-timestamp", timestamp)
		ctx.Request.Header.Set("webhook-signature", "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
		DodoPaymentsWebhook(ctx)
		return recorder.Code
	}
	event := func(eventType string, session string, status string, total int, currency string) string {
		return `{"business_id":"bus_1","type":"` + eventType + `","timestamp":"2026-11-15T13:00:00Z","data":{"payload_type":"Payment","payment_id":"pay_1","checkout_session_id":"` + session +
			`","status":"` + status + `","total_amount":` + strconv.Itoa(total) + `,"currency":"` + currency + `","metadata":{"user_id":"1"}}}`
	}
	adminQuota := func() int {
		var row model.User
		require.NoError(t, db.Select("quota").First(&row, admin.Id).Error)
		return row.Quota
	}

	succeeded := event("payment.succeeded", "cks_1", "succeeded", 1000, "CNY")
	assert.Equal(t, http.StatusBadRequest, notify(succeeded, []byte("forged")))
	assert.Equal(t, 0, adminQuota())

	assert.Equal(t, http.StatusOK, notify(event("payment.failed", "cks_1", "failed", 1000, "CNY"), secretKey))
	assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo("DODOTEST_cks_1").Status, "a failed attempt leaves the session payable")

	assert.Equal(t, http.StatusOK, notify(event("payment.succeeded", "cks_1", "succeeded", 999, "CNY"), secretKey))
	assert.Equal(t, http.StatusOK, notify(event("payment.succeeded", "cks_1", "succeeded", 1000, "USD"), secretKey))
	assert.Equal(t, 0, adminQuota(), "a payment short of the order or in another currency waits for an administrator")
	assert.Equal(t, common.TopUpStatusPending, model.GetTopUpByTradeNo("DODOTEST_cks_1").Status)

	// A payment from a session this server did not open, such as the
	// product's public link, names no order.
	assert.Equal(t, http.StatusOK, notify(event("payment.succeeded", "cks_public", "succeeded", 100, "CNY"), secretKey))
	assert.Equal(t, 0, adminQuota())

	assert.Equal(t, http.StatusOK, notify(succeeded, secretKey))
	assert.Equal(t, http.StatusOK, notify(succeeded, secretKey))
	want := 10*500000 + int(order.BonusQuota)
	assert.Equal(t, want, adminQuota(), "the order and its bonus, once")
	assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo("DODOTEST_cks_1").Status)

	// Live mode names its orders apart and talks to the same configured host.
	setting.DodoPaymentsTestMode = false
	require.Equal(t, "success", pay(admin, 10)["message"])
	assert.NotNil(t, model.GetTopUpByTradeNo("DODO_cks_2"))
	dodoPaymentsAPIBase = ""
	assert.Equal(t, setting.DodoPaymentsLiveAPIBase, dodoPaymentsBaseURL())
	setting.DodoPaymentsTestMode = true
	assert.Equal(t, setting.DodoPaymentsTestAPIBase, dodoPaymentsBaseURL())

	// A WeChat-only checkout lists only WeChat Pay and refuses an order above
	// WeChat's 1000 CNY limit before opening a session.
	dodoPaymentsAPIBase = stub.URL
	setting.DodoPaymentsMethodTypes, setting.DodoPaymentsMaxMoney = " We_Chat_Pay ,", 1000
	before := len(checkouts)
	tooLarge := pay(admin, 1001)
	assert.Equal(t, "error", tooLarge["message"])
	assert.Contains(t, tooLarge["data"], "1000")
	assert.Len(t, checkouts, before, "no checkout is opened above the cap")
	require.Equal(t, "success", pay(admin, 1000)["message"])
	require.Len(t, checkouts, before+1)
	assert.Equal(t, []any{"we_chat_pay"}, checkouts[before]["allowed_payment_method_types"])
	assert.Equal(t, []any{map[string]any{"product_id": "pdt_topup", "quantity": float64(1), "amount": float64(100000)}}, checkouts[before]["product_cart"])

	// A listed entry names the button for an administrator, is marked in test
	// mode, and stays hidden from a customer while the method is admin-only.
	operation_setting.PayMethods = []map[string]string{
		{"name": "支付宝", "type": "alipay"},
		{"name": "微信支付 (Dodo)", "type": model.PaymentMethodDodoPayments, "icon": "SiWechat"},
	}
	topUpMethods := func(user *model.User) []map[string]any {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/info", nil)
		ctx.Set("id", user.Id)
		ctx.Set("role", user.Role)
		GetTopUpInfo(ctx)
		var response struct {
			Data struct {
				PayMethods []map[string]any `json:"pay_methods"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		return response.Data.PayMethods
	}
	dodoEntries := func(methods []map[string]any) []map[string]any {
		var found []map[string]any
		for _, method := range methods {
			if method["type"] == model.PaymentMethodDodoPayments {
				found = append(found, method)
			}
		}
		return found
	}
	adminDodo := dodoEntries(topUpMethods(admin))
	require.Len(t, adminDodo, 1, "the listed entry replaces the default one")
	assert.Equal(t, "微信支付 (Dodo) (Test)", adminDodo[0]["name"])
	assert.Equal(t, "SiWechat", adminDodo[0]["icon"])
	assert.Equal(t, "1", adminDodo[0]["min_topup"])
	assert.Empty(t, dodoEntries(topUpMethods(customer)))
	assert.Equal(t, "微信支付 (Dodo)", operation_setting.PayMethods[1]["name"], "the shared option is not changed")
}

func TestDodoPaymentsMethodTypes(t *testing.T) {
	assert.Equal(t, []string{"we_chat_pay", "credit"}, setting.ParseDodoPaymentsMethodTypes(" WE_CHAT_PAY, credit,,we_chat_pay "))
	assert.Empty(t, setting.ParseDodoPaymentsMethodTypes(" , "))
	assert.True(t, setting.ValidDodoPaymentsMethodType("ali_pay_hk"))
	assert.False(t, setting.ValidDodoPaymentsMethodType("we-chat"))
	assert.False(t, setting.ValidDodoPaymentsMethodType("card1"))
	assert.False(t, setting.ValidDodoPaymentsMethodType(""))
}
