package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// LimitedPlanAddressSetting limits a plan with a per-user purchase limit per
// network: a farm of accounts, each allowed one purchase, is one buyer. The
// options are limited_plan_address_setting.enabled, .farm_enabled and
// .threshold.
type LimitedPlanAddressSetting struct {
	// Enabled turns on the one-buyer-per-address check in
	// model.CheckSubscriptionPurchaseFrom: a purchase is refused when another
	// holder of the plan used the purchasing address. It is the strict check,
	// and refuses a second person in one household or office. Off, it does not
	// run; FarmEnabled is separate.
	Enabled bool `json:"enabled"`
	// FarmEnabled turns on the per-network check: a purchase is refused when
	// the addresses the buyer's own requests came from already carry Threshold
	// other holders. It reads only addresses the buyer used before buying, so
	// it spares a customer who merely shares an order address. With both
	// switches off a plan is limited per account only.
	FarmEnabled bool `json:"farm_enabled"`
	// Threshold is how many other accounts that already hold the plan may
	// share the buyer's addresses before FarmEnabled refuses a purchase. Two
	// lets one household or office through; a value below 1 counts as 1.
	Threshold int `json:"threshold"`
}

var limitedPlanAddressSetting = LimitedPlanAddressSetting{Enabled: true, FarmEnabled: true, Threshold: 2}

func init() {
	config.GlobalConfig.Register("limited_plan_address_setting", &limitedPlanAddressSetting)
}

func GetLimitedPlanAddressSetting() *LimitedPlanAddressSetting {
	return &limitedPlanAddressSetting
}
