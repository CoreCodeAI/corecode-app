package operation_setting

import (
	"fmt"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/setting/config"
)

// CoreCode addition: the top-up watch (service/topup_watch.go) looks for
// card top-ups that look like stolen or farmed cards, tells a Feishu group,
// and in enforce mode disables the account on the strongest signal.

const (
	// TopupWatchModeObserve alerts only.
	TopupWatchModeObserve = "observe"
	// TopupWatchModeEnforce also disables an account that meets the freeze
	// condition.
	TopupWatchModeEnforce = "enforce"
)

// TopupWatchSetting holds the watch's thresholds. Card top-ups are wallet
// top-ups paid through Stripe Checkout with a card; amounts are the CNY the
// customer paid.
type TopupWatchSetting struct {
	Enabled bool   `json:"enabled"`
	Mode    string `json:"mode"`
	// BurstCount alerts when a customer completes this many card top-ups
	// within two hours.
	BurstCount int `json:"burst_count"`
	// DailyAmount alerts when a customer's card top-ups within 24 hours reach
	// this many CNY.
	DailyAmount float64 `json:"daily_amount"`
	// NewAccountAmount alerts when an account younger than NewAccountHours
	// tops up this many CNY by card within 24 hours.
	NewAccountHours  int     `json:"new_account_hours"`
	NewAccountAmount float64 `json:"new_account_amount"`
	// FailedCharges alerts when Stripe declines or blocks this many of one
	// customer's charges within an hour.
	FailedCharges int `json:"failed_charges"`
	// DistinctCards alerts when one customer pays with this many different
	// cards within 24 hours. Together with FreezeAmount it is the freeze
	// condition: a customer who used DistinctCards cards and paid at least
	// FreezeAmount CNY within 24 hours is disabled in enforce mode.
	DistinctCards int     `json:"distinct_cards"`
	FreezeAmount  float64 `json:"freeze_amount"`
	// Allowlist lists user IDs, separated by commas or whitespace, that are
	// never disabled. They are still reported.
	Allowlist string `json:"allowlist"`
	// FeishuWebhook is the Feishu custom bot the alerts go to; empty sends
	// nothing. FeishuSecret signs them when the bot asks for a signature.
	FeishuWebhook string `json:"feishu_webhook"`
	FeishuSecret  string `json:"feishu_secret"`
	// StripeApiKey is a read-only restricted key (charges, disputes, early
	// fraud warnings). Without it only the top-up rules run, and nobody is
	// disabled, because the freeze condition needs the card count.
	StripeApiKey string `json:"stripe_api_key"`
}

// Allowlisted reports whether the account must never be disabled by the watch.
func (s TopupWatchSetting) Allowlisted(userId int) bool {
	separator := func(r rune) bool { return r == ',' || r == '，' || unicode.IsSpace(r) }
	for _, field := range strings.FieldsFunc(s.Allowlist, separator) {
		if id, err := strconv.Atoi(field); err == nil && id == userId {
			return true
		}
	}
	return false
}

// The defaults sit well above what paying customers did between 2026-11-08
// and 2026-11-13 (at most 2 card top-ups in two hours, 5 and ¥2,000 in a day)
// and far below the farmed-card account of 2026-11-13 (20 in two hours, ¥8,492.90
// and about 30 cards in a day).
var topupWatchSetting = TopupWatchSetting{
	Mode:             TopupWatchModeEnforce,
	BurstCount:       4,
	DailyAmount:      3000,
	NewAccountHours:  24,
	NewAccountAmount: 1500,
	FailedCharges:    4,
	DistinctCards:    3,
	FreezeAmount:     1000,
}

func init() {
	config.GlobalConfig.Register("topup_watch_setting", &topupWatchSetting)
}

func GetTopupWatchSetting() *TopupWatchSetting {
	return &topupWatchSetting
}

// ValidateTopupWatchOption checks one topup_watch_setting field value before
// it is saved.
func ValidateTopupWatchOption(field string, value string) error {
	switch field {
	case "mode":
		if value != TopupWatchModeObserve && value != TopupWatchModeEnforce {
			return fmt.Errorf("Top-up watch mode must be observe or enforce")
		}
	case "burst_count", "new_account_hours", "failed_charges", "distinct_cards":
		if number, err := strconv.Atoi(value); err != nil || number < 1 {
			return fmt.Errorf("Top-up watch %s must be a whole number of at least 1", field)
		}
	case "daily_amount", "new_account_amount", "freeze_amount":
		if number, err := strconv.ParseFloat(value, 64); err != nil || number <= 0 {
			return fmt.Errorf("Top-up watch %s must be a positive amount", field)
		}
	}
	return nil
}
