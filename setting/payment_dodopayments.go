package setting

import (
	"slices"
	"strings"
)

// CoreCode addition: top-ups through Dodo Payments Checkout.

// DodoPaymentsApiKey and DodoPaymentsWebhookSecret belong to one Dodo mode:
// a test key and the test endpoint's secret while DodoPaymentsTestMode is on,
// live ones once it is off.
var DodoPaymentsApiKey = ""
var DodoPaymentsWebhookSecret = ""

// DodoPaymentsProductId is a one-time, pay-what-you-want product priced in
// CNY with tax included. Each checkout sets the order's price on it.
var DodoPaymentsProductId = ""

// DodoPaymentsTestMode sends requests to Dodo's test host, where no money
// moves. A test order still credits the account that paid it.
var DodoPaymentsTestMode = true

// DodoPaymentsAdminOnly shows the wallet method to administrators only and
// refuses anyone else's order, so a mode can be tried before customers see it.
var DodoPaymentsAdminOnly = true

// DodoPaymentsMethodTypes lists the Dodo payment method types a checkout
// offers, comma-separated, such as "we_chat_pay". Empty offers whatever the
// account and the order allow.
var DodoPaymentsMethodTypes = ""

// DodoPaymentsMaxMoney caps one order's CNY price; zero sets no cap. WeChat
// Pay takes at most 1000 CNY a payment, so a WeChat-only checkout above it
// would offer no way to pay.
var DodoPaymentsMaxMoney = 0.0

// GetDodoPaymentsMethodTypes splits DodoPaymentsMethodTypes into its types.
func GetDodoPaymentsMethodTypes() []string {
	return ParseDodoPaymentsMethodTypes(DodoPaymentsMethodTypes)
}

// ParseDodoPaymentsMethodTypes reads a comma-separated list, trimmed and
// lower-cased, without empty entries or repeats.
func ParseDodoPaymentsMethodTypes(value string) []string {
	var types []string
	for _, part := range strings.Split(value, ",") {
		part = strings.ToLower(strings.TrimSpace(part))
		if part != "" && !slices.Contains(types, part) {
			types = append(types, part)
		}
	}
	return types
}

// ValidDodoPaymentsMethodType reports whether a type has the shape of Dodo's
// method types: lower-case letters and underscores.
func ValidDodoPaymentsMethodType(methodType string) bool {
	if methodType == "" {
		return false
	}
	for _, r := range methodType {
		if (r < 'a' || r > 'z') && r != '_' {
			return false
		}
	}
	return true
}

const (
	DodoPaymentsTestAPIBase = "https://test.dodopayments.com"
	DodoPaymentsLiveAPIBase = "https://live.dodopayments.com"
)
