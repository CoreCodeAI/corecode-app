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
// place, so the purchase checks never see the address that matters. A bigger
// studio rotates through a block of addresses, one account on each at a
// time, so the check also counts holders per network, and an account that
// used a gated network stays gated from any address for a while. The options
// are limited_plan_use_setting.enabled, .threshold, .exclude_free_plans,
// .network_enabled, .network_threshold, .sticky_days and .shared_exit_networks.
type LimitedPlanUseSetting struct {
	// Enabled turns on the check at billing time: a request whose client
	// address, or network, already carries other accounts that used it and
	// hold a plan limited per user is not charged to that plan. It is charged
	// to the wallet, or refused when the wallet cannot pay.
	Enabled bool `json:"enabled"`
	// Threshold is how many other holders may use the request's address
	// before the plan stops serving it. A value below 1 counts as 1.
	Threshold int `json:"threshold"`
	// ExcludeFreePlans leaves free plans out: a plan that costs nothing, and
	// a plan an inviter gave away, neither counts its holder nor is gated.
	// The check guards what is bought at a discount, and a gift costs nothing
	// to farm.
	ExcludeFreePlans bool `json:"exclude_free_plans"`
	// NetworkEnabled counts holders per network as well as per address: an
	// IPv4 /24 or an IPv6 /64. The address or the network may trigger.
	NetworkEnabled bool `json:"network_enabled"`
	// NetworkThreshold is how many other holders may use the request's
	// network before the plan stops serving it. A value below 1 counts as 1.
	// It is higher than Threshold: a /24 holds more than one household.
	NetworkThreshold int `json:"network_threshold"`
	// StickyDays is how long an account that used a gated address or network
	// stays gated from every address, so that moving to a new address does
	// not end the gate. Zero turns the memory off.
	StickyDays int `json:"sticky_days"`
	// SharedExitNetworks lists address blocks of commercial proxies, VPN
	// airports and data centres, one CIDR per entry, separated by commas,
	// spaces or newlines. Many unrelated customers leave through such a block,
	// so a request from it is not counted per network: the plan is gated only
	// when its own address carries enough holders. An invalid entry is
	// ignored. A listed block does not exempt a customer; an exemption does.
	SharedExitNetworks string `json:"shared_exit_networks"`
}

var limitedPlanUseSetting = LimitedPlanUseSetting{
	Enabled: true, Threshold: 3, ExcludeFreePlans: true, NetworkEnabled: true, NetworkThreshold: 4, StickyDays: 7,
	SharedExitNetworks: "185.220.236.0/24",
}

func init() {
	config.GlobalConfig.Register("limited_plan_use_setting", &limitedPlanUseSetting)
}

func GetLimitedPlanUseSetting() *LimitedPlanUseSetting {
	return &limitedPlanUseSetting
}
