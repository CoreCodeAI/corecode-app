package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/setting/config"
)

const (
	// ViolationGuardModeObserve records upstream refusals and what the policy
	// would have done, without restricting anyone.
	ViolationGuardModeObserve = "observe"
	// ViolationGuardModeEnforce suspends, bans and blocks as the policy says.
	ViolationGuardModeEnforce = "enforce"
)

// ViolationGuardSetting turns an upstream usage-policy refusal into a strike
// against the customer who sent the request. The first strike suspends the
// customer's relay access; BanStrikes strikes within StrikeWindowDays disable
// the account. A refused conversation stays blocked for the strike window,
// except as LenientCategories says.
type ViolationGuardSetting struct {
	Enabled bool   `json:"enabled"`
	Mode    string `json:"mode"`
	// SuspendHours is how long one strike suspends relay access. Refusals
	// inside this period, or within ten minutes when it is 0, belong to the
	// same strike.
	SuspendHours int `json:"suspend_hours"`
	// BanStrikes disables the account when its strikes within the window
	// reach this number; 0 never disables.
	BanStrikes       int `json:"ban_strikes"`
	StrikeWindowDays int `json:"strike_window_days"`
	// LenientCategories lists upstream refusal categories, separated by commas
	// or whitespace, whose refusals are first only warnings that restrict
	// nothing; see LenientWarnings. A refusal of these categories only holds
	// its conversation; the conversation is blocked when it is refused again.
	LenientCategories string `json:"lenient_categories"`
	// LenientWarnings is how many incidents of one lenient category a customer
	// is only warned about within LenientWarningWindowSeconds; the next
	// incident of that category is a strike. 0 strikes the first.
	LenientWarnings int `json:"lenient_warnings"`
	// ClientCheckLimit stops forwarding a customer's client checks once the
	// upstream has refused this many of them within ClientCheckWindowSeconds;
	// 0 always forwards them. See clientCheckRefusal in the service package.
	ClientCheckLimit int `json:"client_check_limit"`
}

// ClientCheckWindowSeconds is how long a refused client check counts toward
// ClientCheckLimit.
const ClientCheckWindowSeconds = 24 * 3600

// LenientWarningWindowSeconds is how long a lenient incident counts toward
// LenientWarnings.
const LenientWarningWindowSeconds = 24 * 3600

// LenientCategory reports whether a refusal of this category is warned about
// before it counts as a strike.
func (s ViolationGuardSetting) LenientCategory(category string) bool {
	if category == "" {
		return false
	}
	separator := func(r rune) bool { return r == ',' || r == '，' || unicode.IsSpace(r) }
	for _, lenient := range strings.FieldsFunc(s.LenientCategories, separator) {
		if strings.EqualFold(lenient, category) {
			return true
		}
	}
	return false
}

var violationGuardSetting = ViolationGuardSetting{
	Mode:             ViolationGuardModeObserve,
	SuspendHours:     24,
	BanStrikes:       2,
	StrikeWindowDays: 30,
	// Anthropic's classifier refuses many ordinary agent sessions with this
	// category, so its refusals warn before they count.
	LenientCategories: "reasoning_extraction",
	// Two incidents of a category in a day are warnings; a customer who keeps
	// being refused is struck at the third.
	LenientWarnings: 2,
	// A client that keeps sending checks the upstream refuses costs the pool
	// account a refusal each time, and the customer gains nothing from them.
	ClientCheckLimit: 5,
}

func init() {
	config.GlobalConfig.Register("violation_guard_setting", &violationGuardSetting)
}

func GetViolationGuardSetting() *ViolationGuardSetting {
	return &violationGuardSetting
}

// ValidateViolationGuardOption checks one violation_guard_setting field value
// before it is saved.
func ValidateViolationGuardOption(field string, value string) error {
	switch field {
	case "mode":
		if value != ViolationGuardModeObserve && value != ViolationGuardModeEnforce {
			return fmt.Errorf("Violation guard mode must be observe or enforce")
		}
	case "suspend_hours", "ban_strikes", "client_check_limit", "lenient_warnings":
		if number, err := strconv.Atoi(value); err != nil || number < 0 {
			return fmt.Errorf("Violation guard %s must be a non-negative whole number", field)
		}
	case "strike_window_days":
		if number, err := strconv.Atoi(value); err != nil || number < 1 {
			return fmt.Errorf("Violation guard strike window must be at least 1 day")
		}
	}
	return nil
}
