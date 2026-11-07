package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

type termsConsentRequest struct {
	Version string `json:"version"`
}

// currentTermsVersion is the terms version customers must accept; empty
// means the console does not ask.
func currentTermsVersion() string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(system_setting.GetLegalSettings().TermsVersion)
}

// acceptedTermsVersion returns the current terms version when the customer
// has accepted it, and "" otherwise, so the console compares it with
// /api/status's terms_version to decide whether to ask.
func acceptedTermsVersion(userId int) string {
	current := currentTermsVersion()
	if current == "" {
		return ""
	}
	accepted, err := model.HasAcceptedTerms(userId, current)
	if err != nil {
		common.SysError(common.LogText("terms consent lookup failed: %v", err))
		return ""
	}
	if !accepted {
		return ""
	}
	return current
}

// AcceptTermsConsent records that the signed-in customer accepted the current
// terms. The console calls it after the customer agrees; it is a consent
// record, not an authentication step, so no sign-in path waits on it.
func AcceptTermsConsent(c *gin.Context) {
	var request termsConsentRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	current := currentTermsVersion()
	if current == "" || strings.TrimSpace(request.Version) != current {
		common.ApiErrorT(c, "The terms have been updated, please reload the page")
		return
	}
	userId := c.GetInt("id")
	if err := model.RecordTermsConsent(userId, current, c.ClientIP(), c.Request.UserAgent()); err != nil {
		common.SysError(common.LogText("terms consent write failed: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	common.ApiSuccess(c, gin.H{"terms_version": current})
}
