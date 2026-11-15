package setting

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

const (
	DodoPaymentsTestAPIBase = "https://test.dodopayments.com"
	DodoPaymentsLiveAPIBase = "https://live.dodopayments.com"
)
