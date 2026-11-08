package setting

var StripeApiSecret = ""
var StripeWebhookSecret = ""
var StripePriceId = ""
var StripeUnitPrice = 8.0
var StripeMinTopUp = 1
var StripePromotionCodesEnabled = false

// StripeSmallOrderEpayMax is a CoreCode setting: an order whose CNY price is
// at most this, paid by a Stripe method that has an epay twin (WeChat Pay,
// Alipay), goes through epay instead, because Stripe's fixed fee is a large
// share of a small order. Zero sends every order to Stripe.
var StripeSmallOrderEpayMax = 0.0

// StripeHKDDiscount is a CoreCode setting: the fraction taken off the HKD
// amount Checkout charges, so the customer's wallet, converting HKD back at
// its own slightly lower rate, charges no more than the CNY price. 0.006
// turned a ¥100 order that WeChat Pay charged as ¥100.30 into about ¥99.70.
var StripeHKDDiscount = 0.006
