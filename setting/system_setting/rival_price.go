package system_setting

import "github.com/QuantumNous/new-api/setting/config"

// RivalPriceSetting controls the rival price monitor (service/rival_price.go).
// It is off until an admin turns it on: every probe is a request from this
// host to another relay, so Proxy should name an egress that is not the
// origin's own address.
type RivalPriceSetting struct {
	Enabled bool `json:"enabled"`
	// Proxy is an http(s):// or socks5:// URL the probes go through; empty
	// sends them directly.
	Proxy string `json:"proxy"`
	// FeishuWebhook is a Feishu custom bot that hears when a rival of our
	// kind undercuts us; empty sends nothing. FeishuSecret signs it when the
	// bot asks for a signature.
	FeishuWebhook string `json:"feishu_webhook"`
	FeishuSecret  string `json:"feishu_secret"`
}

var defaultRivalPriceSetting = RivalPriceSetting{}

func init() {
	config.GlobalConfig.Register("rival_price_setting", &defaultRivalPriceSetting)
}

func GetRivalPriceSetting() *RivalPriceSetting {
	return &defaultRivalPriceSetting
}
