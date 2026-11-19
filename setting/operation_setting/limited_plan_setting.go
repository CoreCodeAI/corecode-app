package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// LimitedPlanAddressSetting limits a plan with a per-user purchase limit per
// network: a farm of accounts, each allowed one purchase, is one buyer. The
// options are limited_plan_address_setting.enabled and .threshold.
type LimitedPlanAddressSetting struct {
	Enabled bool `json:"enabled"`
	// Threshold is how many other accounts that already hold the plan may
	// share the buyer's addresses before a purchase is refused. Two lets one
	// household or office through; a value below 1 counts as 1.
	Threshold int `json:"threshold"`
}

var limitedPlanAddressSetting = LimitedPlanAddressSetting{Enabled: true, Threshold: 2}

func init() {
	config.GlobalConfig.Register("limited_plan_address_setting", &limitedPlanAddressSetting)
}

func GetLimitedPlanAddressSetting() *LimitedPlanAddressSetting {
	return &limitedPlanAddressSetting
}
