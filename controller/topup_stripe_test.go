package controller

import (
	"fmt"
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
	"github.com/stripe/stripe-go/v81/webhook"
	"gorm.io/gorm"
)

func TestStripeTopUpCheckoutChargesTheOrderPriceInCNY(t *testing.T) {
	for payMoney, fen := range map[float64]int64{100: 10000, 9.9: 990, 1234.565: 123457} {
		params := stripeTopUpCheckoutParams("ref_1", "", "a@example.com", payMoney, "", "")
		require.Len(t, params.LineItems, 1)
		item := params.LineItems[0]
		assert.Nil(t, item.Price, "no dashboard Price: the order sets the amount")
		assert.Equal(t, "cny", *item.PriceData.Currency)
		assert.Equal(t, fen, *item.PriceData.UnitAmount, "¥%v", payMoney)
		assert.Equal(t, int64(1), *item.Quantity)
	}

	first := stripeTopUpCheckoutParams("ref_1", "", "a@example.com", 100, "", "")
	assert.Equal(t, paymentReturnPath("/wallet"), *first.SuccessURL, "a paid customer returns to the wallet")
	assert.Equal(t, paymentReturnPath("/wallet"), *first.CancelURL)
	assert.Nil(t, first.Customer)
	assert.Equal(t, "a@example.com", *first.CustomerEmail)
	again := stripeTopUpCheckoutParams("ref_2", "cus_1", "a@example.com", 100, "", "")
	assert.Equal(t, "cus_1", *again.Customer)
	assert.Nil(t, again.CustomerEmail)
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
		payload := fmt.Sprintf(`{"id":"evt_1","object":"event","api_version":"2026-10-28","type":%q,"data":{"object":{"object":"checkout.session","client_reference_id":%q,"customer":"cus_1","status":%q,"payment_status":%q,"amount_total":10000,"currency":"cny"}}}`,
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
