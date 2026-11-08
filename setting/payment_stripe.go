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
// its own slightly lower rate, charges no more than the CNY price. WeChat
// Pay charged a ¥100 order as ¥100.30 with no discount; 0.005 makes it
// about ¥99.80, leaving room for the two rates to drift.
var StripeHKDDiscount = 0.005
