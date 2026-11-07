package system_setting

import "github.com/QuantumNous/new-api/setting/config"

type LegalSettings struct {
	UserAgreement string `json:"user_agreement"`
	PrivacyPolicy string `json:"privacy_policy"`
	// TermsVersion names the terms customers must accept before signing in,
	// usually the terms page's last-updated date. Empty turns the gate off.
	TermsVersion string `json:"terms_version"`
}

var defaultLegalSettings = LegalSettings{
	UserAgreement: "",
	PrivacyPolicy: "",
	TermsVersion:  "",
}

func init() {
	config.GlobalConfig.Register("legal", &defaultLegalSettings)
}

func GetLegalSettings() *LegalSettings {
	return &defaultLegalSettings
}
