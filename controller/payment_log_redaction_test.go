package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyCreemSignatureRejectsEmptySecretInTestMode(t *testing.T) {
	previous := setting.CreemTestMode
	t.Cleanup(func() { setting.CreemTestMode = previous })

	setting.CreemTestMode = true
	assert.False(t, verifyCreemSignature(`{"eventType":"checkout.completed"}`, "anything", ""))
	assert.False(t, verifyCreemSignature(`{"eventType":"checkout.completed"}`, "", ""))

	payload := `{"eventType":"checkout.completed"}`
	assert.True(t, verifyCreemSignature(payload, generateCreemSignature(payload, "creem_secret"), "creem_secret"))
}

func TestRedactedPaymentParamsMasksSignatures(t *testing.T) {
	got := redactedPaymentParams(map[string]string{
		"out_trade_no": "USR1NOabc", "sign": "s3cr3t", "sign_type": "RSA", "Signature": "x1", "pay_sign": "x2",
	})
	assert.NotContains(t, got, "s3cr3t")
	assert.NotContains(t, got, "x1")
	assert.NotContains(t, got, "x2")
	assert.Contains(t, got, "USR1NOabc")
	assert.Contains(t, got, `"sign_type":"RSA"`)
}

// captureLogs collects everything the logger writes while fn runs.
func captureLogs(t *testing.T, fn func()) string {
	t.Helper()
	var buf bytes.Buffer
	common.LogWriterMu.Lock()
	previousOut, previousErr := gin.DefaultWriter, gin.DefaultErrorWriter
	gin.DefaultWriter, gin.DefaultErrorWriter = &buf, &buf
	common.LogWriterMu.Unlock()
	defer func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter, gin.DefaultErrorWriter = previousOut, previousErr
		common.LogWriterMu.Unlock()
	}()
	fn()
	return buf.String()
}

func TestPaymentWebhooksDoNotLogSignatureOrBody(t *testing.T) {
	const signature = "sig_value_must_not_be_logged"
	const marker = "customer-secret@example.com"
	payload := `{"id":"evt_1","eventType":"checkout.completed","object":{"customer":{"email":"` + marker + `"}}}`

	previous := struct {
		creemKey, creemProducts, creemSecret, stripeKey, stripeSecret string
		confirmed                                                     bool
		terms                                                         string
	}{
		setting.CreemApiKey, setting.CreemProducts, setting.CreemWebhookSecret, setting.StripeApiSecret, setting.StripeWebhookSecret,
		operation_setting.GetPaymentSetting().ComplianceConfirmed, operation_setting.GetPaymentSetting().ComplianceTermsVersion,
	}
	t.Cleanup(func() {
		setting.CreemApiKey, setting.CreemProducts, setting.CreemWebhookSecret = previous.creemKey, previous.creemProducts, previous.creemSecret
		setting.StripeApiSecret, setting.StripeWebhookSecret = previous.stripeKey, previous.stripeSecret
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.terms
	})
	setting.CreemApiKey, setting.CreemProducts, setting.CreemWebhookSecret = "creem_key", `[{"productId":"p"}]`, "creem_secret"
	setting.StripeApiSecret, setting.StripeWebhookSecret = "sk_test_123", "whsec_test"
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name, path, header string
		handler            gin.HandlerFunc
	}{
		{"creem", "/api/creem/webhook", CreemSignatureHeader, CreemWebhook},
		{"stripe", "/api/stripe/webhook", "Stripe-Signature", StripeWebhook},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var code int
			logs := captureLogs(t, func() {
				recorder := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(recorder)
				ctx.Request = httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(payload))
				ctx.Request.Header.Set(tc.header, signature)
				tc.handler(ctx)
				code = recorder.Code
			})
			require.NotEqual(t, http.StatusOK, code, "a forged signature must be rejected")
			require.NotEmpty(t, logs, "the handler should still log the delivery")
			assert.NotContains(t, logs, signature)
			assert.NotContains(t, logs, marker)
			assert.Contains(t, logs, payloadFingerprint([]byte(payload)))
		})
	}
}
