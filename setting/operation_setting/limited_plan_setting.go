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

// LimitedPlanUseSetting limits the use of a plan with a per-user purchase
// limit per network. A studio opens many accounts, lets each buy the plan
// from a different order address, and sends every account's requests from one
// place, so the purchase checks never see the address that matters. The
// options are limited_plan_use_setting.enabled and .threshold.
type LimitedPlanUseSetting struct {
	// Enabled turns on the check at billing time: a request whose client
	// address already carries Threshold other accounts that used it and hold
	// a plan limited per user is not charged to that plan. It is charged to
	// the wallet, or refused when the wallet cannot pay.
	Enabled bool `json:"enabled"`
	// Threshold is how many other holders may use the request's address
	// before the plan stops serving it. A value below 1 counts as 1.
	Threshold int `json:"threshold"`
}

var limitedPlanUseSetting = LimitedPlanUseSetting{Enabled: true, Threshold: 3}

func init() {
	config.GlobalConfig.Register("limited_plan_use_setting", &limitedPlanUseSetting)
}

func GetLimitedPlanUseSetting() *LimitedPlanUseSetting {
	return &limitedPlanUseSetting
}
