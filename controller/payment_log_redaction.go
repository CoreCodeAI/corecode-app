package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// CoreCode: payment webhooks used to log the signature header and the raw body.
// A signature with its body can be replayed against the endpoint, and bodies carry
// customer emails and order details, so logs now hold a fingerprint instead: the
// length and a short SHA-256 identify a delivery when it has to be matched with the
// provider's dashboard, without making it replayable.

// payloadFingerprint describes a request or response body without its content.
func payloadFingerprint(body []byte) string {
	sum := sha256.Sum256(body)
	return fmt.Sprintf("%dB/sha256:%s", len(body), hex.EncodeToString(sum[:])[:16])
}

// signaturePresent reports whether a signature header arrived, never its value.
func signaturePresent(signature string) bool {
	return strings.TrimSpace(signature) != ""
}

// redactedPaymentParams returns form or query parameters as JSON with every
// signature field masked.
func redactedPaymentParams(params map[string]string) string {
	redacted := make(map[string]string, len(params))
	for key, value := range params {
		lower := strings.ToLower(key)
		if lower == "sign" || strings.Contains(lower, "signature") || strings.HasSuffix(lower, "_sign") {
			value = "[redacted]"
		}
		redacted[key] = value
	}
	return common.GetJsonString(redacted)
}
