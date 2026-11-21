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
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81/webhook"
)

// refundTestOrders creates the managed user's orders: two paid top-ups, a paid
// plan (a top-up row and a plan order sharing its number) and a pending one.
func refundTestOrders(t *testing.T, userId int) {
	t.Helper()
	require.NoError(t, model.DB.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{},
		&model.InvoiceItem{}, &model.InvoiceOrderAmount{}))
	now := time.Now().Unix()
	for _, order := range []model.TopUp{
		{TradeNo: "ref_paid_a", Money: 100, Status: common.TopUpStatusSuccess, PaymentProvider: model.PaymentProviderStripe},
		{TradeNo: "ref_paid_b", Money: 50, Status: common.TopUpStatusSuccess, PaymentProvider: model.PaymentProviderStripe},
		{TradeNo: "ref_plan", Money: 29.9, Status: common.TopUpStatusSuccess},
		{TradeNo: "ref_open", Money: 10, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderStripe},
	} {
		order.UserId, order.Amount, order.PaymentMethod, order.CreateTime = userId, int64(order.Money), model.PaymentMethodStripeCard, now
		require.NoError(t, model.DB.Create(&order).Error)
	}
	require.NoError(t, model.DB.Create(&model.SubscriptionOrder{UserId: userId, PlanId: 1, Money: 29.9, TradeNo: "ref_plan",
		PaymentMethod: model.PaymentMethodStripeCard, PaymentProvider: model.PaymentProviderStripe,
		Status: common.TopUpStatusSuccess, CreateTime: now}).Error)
}

func refundStatuses(t *testing.T) map[string]string {
	t.Helper()
	statuses := map[string]string{}
	for _, tradeNo := range []string{"ref_paid_a", "ref_paid_b", "ref_plan", "ref_open"} {
		statuses[tradeNo] = model.GetTopUpByTradeNo(tradeNo).Status
	}
	var plan model.SubscriptionOrder
	require.NoError(t, model.DB.Where("trade_no = ?", "ref_plan").First(&plan).Error)
	statuses["plan order"] = plan.Status
	return statuses
}

func TestAdminRefundTopUpsDropsOrdersFromPaidTotals(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	refundTestOrders(t, target.Id)
	paid := map[string]string{"ref_paid_a": "success", "ref_paid_b": "success", "ref_plan": "success", "ref_open": "pending", "plan order": "success"}
	refund := func(body string, proof string) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
		response := adminUserRequest(http.MethodPost, "/api/user/topup/refund", body, proof, identity, common.RoleRootUser, nil, AdminRefundTopUps)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		return response, result
	}
	proofFor := func(context string) string {
		return issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAdminTopUpRefund, Context: []byte(context)}, service.VerificationMethodPassword)
	}
	const selection = `{"trade_nos":["ref_plan","ref_paid_a","ref_paid_b"]}`

	paidMoney, err := model.AffiliatePaidMoney(model.DB, target.Id)
	require.NoError(t, err)
	assert.InDelta(t, 179.9, paidMoney, 0.001)
	invoiceable, err := model.ListInvoiceableOrders(target.Id)
	require.NoError(t, err)
	assert.Len(t, invoiceable, 3, "both top-ups and the plan order")

	t.Run("needs a proof", func(t *testing.T) {
		response, result := refund(selection, "")
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_PROOF_REQUIRED", result.Code)
		assert.Equal(t, paid, refundStatuses(t))
	})
	t.Run("the proof covers exactly its orders", func(t *testing.T) {
		response, result := refund(`{"trade_nos":["ref_paid_a"]}`, proofFor(selection))
		assert.Equal(t, http.StatusForbidden, response.Code)
		assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code)
		assert.Equal(t, paid, refundStatuses(t))
	})
	t.Run("an unpaid order fails the whole batch", func(t *testing.T) {
		const withPending = `{"trade_nos":["ref_paid_a","ref_open"]}`
		_, result := refund(withPending, proofFor(withPending))
		assert.False(t, result.Success)
		assert.Equal(t, paid, refundStatuses(t))
	})

	// The proof was issued for one order of the list; the request names the
	// same orders in another order, with a duplicate.
	_, result := refund(`{"trade_nos":["ref_paid_b","ref_paid_a","ref_plan","ref_paid_a"]}`, proofFor(selection))
	require.True(t, result.Success, result.Message)
	var outcome model.TopUpRefundResult
	require.NoError(t, common.Unmarshal(result.Data, &outcome))
	assert.Len(t, outcome.Refunded, 3)
	assert.Zero(t, outcome.AlreadyRefunded)
	assert.Equal(t, map[string]string{"ref_paid_a": "refunded", "ref_paid_b": "refunded", "ref_plan": "refunded", "ref_open": "pending", "plan order": "refunded"}, refundStatuses(t))

	paidMoney, err = model.AffiliatePaidMoney(model.DB, target.Id)
	require.NoError(t, err)
	assert.Zero(t, paidMoney)
	invoiceable, err = model.ListInvoiceableOrders(target.Id)
	require.NoError(t, err)
	assert.Empty(t, invoiceable)
	stats, err := model.GetTopUpStats(model.TopUpFilter{StartTime: time.Now().Unix() - 3600, EndTime: time.Now().Unix() + 3600}, 0)
	require.NoError(t, err)
	assert.Zero(t, stats.Money)
	assert.Zero(t, stats.Count)
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, target.Quota, stored.Quota, "marking a refund never touches the balance")

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.topup_refund").Find(&audits).Error)
	require.Len(t, audits, 1)
	params, err := common.Marshal(audits[0].Other.Op.Params)
	require.NoError(t, err)
	assert.JSONEq(t, fmt.Sprintf(`{"count":3,"money":"179.9","trade_nos":["ref_paid_a","ref_paid_b","ref_plan"],"verification_method":"password","target_user_id":%d}`, target.Id), string(params))

	// Marking again changes nothing and records nothing.
	_, result = refund(selection, proofFor(selection))
	require.True(t, result.Success, result.Message)
	require.NoError(t, common.Unmarshal(result.Data, &outcome))
	assert.Empty(t, outcome.Refunded)
	assert.Equal(t, 3, outcome.AlreadyRefunded)
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.topup_refund").Find(&audits).Error)
	assert.Len(t, audits, 1)
}

func TestStripeChargeRefundedMarksOnlyFullRefunds(t *testing.T) {
	_, _, target := setupAdminUserTest(t)
	refundTestOrders(t, target.Id)
	const secret = "whsec_test"
	payment := operation_setting.GetPaymentSetting()
	previous := struct {
		apiSecret, webhookSecret, termsVersion string
		confirmed                              bool
	}{setting.StripeApiSecret, setting.StripeWebhookSecret, payment.ComplianceTermsVersion, payment.ComplianceConfirmed}
	previousLookup := stripeTradeNoForPaymentIntent
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", secret
	payment.ComplianceConfirmed, payment.ComplianceTermsVersion = true, operation_setting.CurrentComplianceTermsVersion
	orders := map[string]string{"pi_a": "ref_paid_a", "pi_plan": "ref_plan"}
	stripeTradeNoForPaymentIntent = func(paymentIntent string) (string, error) { return orders[paymentIntent], nil }
	t.Cleanup(func() {
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.apiSecret, previous.webhookSecret
		payment.ComplianceConfirmed, payment.ComplianceTermsVersion = previous.confirmed, previous.termsVersion
		stripeTradeNoForPaymentIntent = previousLookup
	})
	deliver := func(paymentIntent string, refunded bool) {
		payload := fmt.Sprintf(`{"id":"evt_r","object":"event","api_version":"2026-10-28","type":"charge.refunded","data":{"object":{"object":"charge","id":"ch_1","payment_intent":%q,"refunded":%t,"amount_refunded":500}}}`, paymentIntent, refunded)
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(payload), Secret: secret, Timestamp: time.Now()})
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/stripe/webhook", strings.NewReader(payload))
		c.Request.Header.Set("Stripe-Signature", signed.Header)
		StripeWebhook(c)
		require.Equal(t, http.StatusOK, recorder.Code)
	}

	deliver("pi_a", false)
	deliver("pi_unknown", true)
	assert.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo("ref_paid_a").Status, "a partial refund leaves the order paid")

	deliver("pi_a", true)
	deliver("pi_plan", true)
	deliver("pi_plan", true)
	assert.Equal(t, map[string]string{"ref_paid_a": "refunded", "ref_paid_b": "success", "ref_plan": "refunded", "ref_open": "pending", "plan order": "refunded"}, refundStatuses(t))
}

func TestAdminRecordOfflineTopUpNeedsAProofForTheExactPayment(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TopUp{}))
	record := func(body string, proof string) (*httptest.ResponseRecorder, securityEnrollmentResponse) {
		response := adminUserRequest(http.MethodPost, "/api/user/topup/offline", body, proof, identity, common.RoleRootUser, nil, AdminRecordOfflineTopUp)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		return response, result
	}
	paidAt := time.Now().Unix() - 3600
	payment := fmt.Sprintf(`{"user_id":%d,"money":700,"amount":1000,"paid_at":%d,"backfill":false}`, target.Id, paidAt)
	proof := func() string {
		return issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAdminTopUpOffline, Context: []byte(payment)}, service.VerificationMethodPassword)
	}
	offlineOrders := func() int64 {
		var count int64
		require.NoError(t, model.DB.Model(&model.TopUp{}).Where("payment_method = ?", model.PaymentMethodOffline).Count(&count).Error)
		return count
	}

	response, result := record(payment, "")
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_REQUIRED", result.Code)
	response, result = record(fmt.Sprintf(`{"user_id":%d,"money":7000,"amount":1000,"paid_at":%d}`, target.Id, paidAt), proof())
	assert.Equal(t, http.StatusForbidden, response.Code)
	assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code, "the proof binds the amount of money")
	assert.Zero(t, offlineOrders())

	// The request may omit backfill and send more digits than the cent.
	_, result = record(fmt.Sprintf(`{"user_id":%d,"money":700.001,"amount":1000,"paid_at":%d}`, target.Id, paidAt), proof())
	require.True(t, result.Success, result.Message)
	assert.EqualValues(t, 1, offlineOrders())
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, target.Quota+1000*int(common.QuotaPerUnit), stored.Quota)
	assert.Equal(t, 700.0, model.CachedUserPaidMoney(target.Id), "the paid total is refreshed")

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.topup_offline").Find(&audits).Error)
	require.Len(t, audits, 1)
	params, err := common.Marshal(audits[0].Other.Op.Params)
	require.NoError(t, err)
	assert.Contains(t, string(params), `"money":"700.00"`)
	assert.Contains(t, string(params), `"backfill":false`)
}

func TestAdminRecordOfflineTopUpBindsTheBonusToTheProof(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.TopUp{}))
	record := func(body string, proof string) securityEnrollmentResponse {
		response := adminUserRequest(http.MethodPost, "/api/user/topup/offline", body, proof, identity, common.RoleRootUser, nil, AdminRecordOfflineTopUp)
		var result securityEnrollmentResponse
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		return result
	}
	proofFor := func(payment string) string {
		return issueSecurityEnrollmentProof(t, identity, service.VerificationOperation{Scope: service.VerificationScopeAdminTopUpOffline, Context: []byte(payment)}, service.VerificationMethodPassword)
	}
	paidAt := time.Now().Unix() - 3600
	plain := fmt.Sprintf(`{"user_id":%d,"money":5000,"amount":5000,"paid_at":%d,"backfill":false}`, target.Id, paidAt)
	withBonus := fmt.Sprintf(`{"user_id":%d,"money":5000,"amount":5000,"bonus":500,"paid_at":%d,"backfill":false}`, target.Id, paidAt)

	result := record(withBonus, proofFor(plain))
	assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code, "a proof for the payment without a bonus cannot buy one")
	result = record(plain, proofFor(withBonus))
	assert.Equal(t, "SECURITY_PROOF_CONTEXT_MISMATCH", result.Code, "nor the other way round")
	result = record(fmt.Sprintf(`{"user_id":%d,"money":5000,"amount":5000,"bonus":-1,"paid_at":%d}`, target.Id, paidAt), proofFor(withBonus))
	assert.False(t, result.Success)
	var count int64
	require.NoError(t, model.DB.Model(&model.TopUp{}).Where("payment_method = ?", model.PaymentMethodOffline).Count(&count).Error)
	assert.Zero(t, count)

	result = record(withBonus, proofFor(withBonus))
	require.True(t, result.Success, result.Message)
	stored, err := model.GetUserById(target.Id, false)
	require.NoError(t, err)
	assert.Equal(t, target.Quota+5500*int(common.QuotaPerUnit), stored.Quota, "the wallet gets the amount and the bonus")
	var order model.TopUp
	require.NoError(t, model.DB.Where("payment_method = ?", model.PaymentMethodOffline).First(&order).Error)
	assert.Equal(t, int64(500*common.QuotaPerUnit), order.BonusQuota)

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.topup_offline").Find(&audits).Error)
	require.Len(t, audits, 1)
	params, err := common.Marshal(audits[0].Other.Op.Params)
	require.NoError(t, err)
	assert.Contains(t, string(params), `"bonus":500`)
}
