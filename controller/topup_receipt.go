package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/charge"
	"github.com/stripe/stripe-go/v81/checkout/session"
)

// stripeReceiptSessionWindow bounds the Checkout Sessions searched for an
// order, in seconds around the order's create time. RequestPay opens the
// session, then stores the order, so the session is a few seconds older.
const (
	stripeReceiptSessionBefore = 600
	stripeReceiptSessionAfter  = 60
)

// GetTopUpReceipt answers the Stripe receipt page of a paid Stripe top-up,
// for its owner or an administrator. A receipt link expires after 30 days,
// so it is read from Stripe on every request and never stored. Another
// user's order gets the same answer as an order without a receipt, so the
// endpoint does not tell which order numbers exist.
func GetTopUpReceipt(c *gin.Context) {
	topUp := model.GetTopUpByTradeNo(c.Query("trade_no"))
	if topUp == nil || (topUp.UserId != c.GetInt("id") && c.GetInt("role") < common.RoleAdminUser) ||
		topUp.PaymentProvider != model.PaymentProviderStripe ||
		(topUp.Status != common.TopUpStatusSuccess && topUp.Status != common.TopUpStatusRefunded) {
		common.ApiErrorT(c, "This order has no Stripe receipt")
		return
	}
	if !strings.HasPrefix(setting.StripeApiSecret, "sk_") && !strings.HasPrefix(setting.StripeApiSecret, "rk_") {
		common.ApiErrorT(c, "Payment information has not been configured by administrator")
		return
	}
	url, err := stripeReceiptURL(topUp)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Stripe failed to read the receipt trade_no=%s error=%q", topUp.TradeNo, err.Error()))
		common.ApiErrorT(c, "Failed to load the receipt")
		return
	}
	if url == "" {
		common.ApiErrorT(c, "This order has no Stripe receipt")
		return
	}
	common.ApiSuccess(c, gin.H{"url": url})
}

// stripeReceiptURL finds the receipt of a Stripe top-up. The order keeps
// only its reference, which Stripe holds as the Checkout Session's
// client_reference_id and cannot filter by; so it lists the complete
// sessions created around the order, takes the one with that reference,
// and reads the receipt from its PaymentIntent's charge. It returns "" when
// Stripe holds no paid charge for the order, such as one an administrator
// completed by hand. Reading charges needs the key's Charges read permission.
func stripeReceiptURL(topUp *model.TopUp) (string, error) {
	stripe.Key = setting.StripeApiSecret
	sessions := session.List(&stripe.CheckoutSessionListParams{
		Status: stripe.String(string(stripe.CheckoutSessionStatusComplete)),
		CreatedRange: &stripe.RangeQueryParams{
			GreaterThanOrEqual: topUp.CreateTime - stripeReceiptSessionBefore,
			LesserThanOrEqual:  topUp.CreateTime + stripeReceiptSessionAfter,
		},
	})
	paymentIntent := ""
	for sessions.Next() {
		found := sessions.CheckoutSession()
		if found.ClientReferenceID == topUp.TradeNo && found.PaymentIntent != nil {
			paymentIntent = found.PaymentIntent.ID
			break
		}
	}
	if err := sessions.Err(); err != nil || paymentIntent == "" {
		return "", err
	}
	charges := charge.List(&stripe.ChargeListParams{PaymentIntent: stripe.String(paymentIntent)})
	for charges.Next() {
		if paid := charges.Charge(); paid.Paid && paid.ReceiptURL != "" {
			return paid.ReceiptURL, nil
		}
	}
	return "", charges.Err()
}
