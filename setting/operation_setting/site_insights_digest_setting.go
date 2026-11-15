package operation_setting

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// CoreCode addition: the daily Feishu digest of the root dashboard
// (service/site_insights_digest.go). Once a day, at Hour in Beijing time, it
// posts the previous day's headline figures and what needs attention to a
// Feishu bot. It is off until an admin turns it on.

// SiteInsightsDigestSetting is the digest's switch, hour and Feishu bot.
type SiteInsightsDigestSetting struct {
	Enabled bool `json:"enabled"`
	// Hour is the Beijing hour, 0 to 23, from which the digest is sent.
	Hour int `json:"hour"`
	// FeishuWebhook is the custom bot the digest goes to; empty sends nothing.
	// FeishuSecret signs the message when the bot asks for a signature.
	FeishuWebhook string `json:"feishu_webhook"`
	FeishuSecret  string `json:"feishu_secret"`
}

var siteInsightsDigestSetting = SiteInsightsDigestSetting{Hour: 9}

func init() {
	config.GlobalConfig.Register("site_insights_digest_setting", &siteInsightsDigestSetting)
}

func GetSiteInsightsDigestSetting() *SiteInsightsDigestSetting {
	return &siteInsightsDigestSetting
}

// Ready reports whether the digest runs at all: it is on and has a bot.
func (s SiteInsightsDigestSetting) Ready() bool {
	return s.Enabled && strings.TrimSpace(s.FeishuWebhook) != ""
}

// ValidateSiteInsightsDigestOption checks one site_insights_digest_setting
// field value before it is saved.
func ValidateSiteInsightsDigestOption(field string, value string) error {
	if field != "hour" {
		return nil
	}
	if hour, err := strconv.Atoi(value); err != nil || hour < 0 || hour > 23 {
		return fmt.Errorf("Site insights digest hour must be a whole number from 0 to 23")
	}
	return nil
}
