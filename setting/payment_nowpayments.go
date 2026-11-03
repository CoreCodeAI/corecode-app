package setting

import (
	"fmt"
	"slices"
	"strings"
)

var NowPaymentsApiKey = ""
var NowPaymentsIpnSecret = ""

// NowPaymentsFeishuWebhook is a Feishu custom bot that hears about crypto
// top-ups: each credited order, and each deposit an administrator must
// review. Empty sends nothing. NowPaymentsFeishuSecret is the bot's signing
// secret, empty when the bot does not verify signatures.
var NowPaymentsFeishuWebhook = ""
var NowPaymentsFeishuSecret = ""

// NowPaymentsMinTopUp is the smallest top-up, in the same unit as MinTopUp,
// that the wallet offers through NOWPayments. Each network has its own
// minimum on NOWPayments' side; USDT on Tron needed about $11.9 on
// 2026-11-03, and 100 is $14.71 at 6.8 yuan to the dollar.
var NowPaymentsMinTopUp = 100

// NowPaymentsPayCurrencies lists, comma-separated, the NOWPayments tickers the
// wallet offers. Only tickers in NowPaymentsCurrencyCatalog are accepted.
var NowPaymentsPayCurrencies = "usdttrc20,usdtbsc,usdtsol,usdtmatic,usdtton,usdterc20,usdcbsc,usdcsol,usdcbase,usdcmatic,usdcarb,usdc"

// NowPaymentsCurrency is one stablecoin on one network, named by its
// NOWPayments ticker.
type NowPaymentsCurrency struct {
	Code    string `json:"code"`
	Coin    string `json:"coin"`
	Network string `json:"network"`
}

// NowPaymentsCurrencyCatalog is every currency the wallet may offer. CoreCode
// accepts USDT and USDC only, both valued at one US dollar.
var NowPaymentsCurrencyCatalog = []NowPaymentsCurrency{
	{Code: "usdttrc20", Coin: "USDT", Network: "TRC20"},
	{Code: "usdtbsc", Coin: "USDT", Network: "BEP20"},
	{Code: "usdtsol", Coin: "USDT", Network: "Solana"},
	{Code: "usdtmatic", Coin: "USDT", Network: "Polygon"},
	{Code: "usdtton", Coin: "USDT", Network: "TON"},
	{Code: "usdterc20", Coin: "USDT", Network: "ERC20"},
	{Code: "usdcbsc", Coin: "USDC", Network: "BEP20"},
	{Code: "usdcsol", Coin: "USDC", Network: "Solana"},
	{Code: "usdcbase", Coin: "USDC", Network: "Base"},
	{Code: "usdcmatic", Coin: "USDC", Network: "Polygon"},
	{Code: "usdcarb", Coin: "USDC", Network: "Arbitrum"},
	{Code: "usdc", Coin: "USDC", Network: "ERC20"},
}

// ParseNowPaymentsPayCurrencies reads a NowPaymentsPayCurrencies value into
// catalog entries, in catalog order. It rejects a ticker outside the catalog
// so a typo cannot offer a coin CoreCode does not accept.
func ParseNowPaymentsPayCurrencies(value string) ([]NowPaymentsCurrency, error) {
	var codes []string
	for code := range strings.SplitSeq(value, ",") {
		code = strings.ToLower(strings.TrimSpace(code))
		if code == "" {
			continue
		}
		if !slices.ContainsFunc(NowPaymentsCurrencyCatalog, func(c NowPaymentsCurrency) bool { return c.Code == code }) {
			return nil, fmt.Errorf("unsupported NOWPayments currency %q", code)
		}
		codes = append(codes, code)
	}
	currencies := make([]NowPaymentsCurrency, 0, len(codes))
	for _, currency := range NowPaymentsCurrencyCatalog {
		if slices.Contains(codes, currency.Code) {
			currencies = append(currencies, currency)
		}
	}
	return currencies, nil
}

// GetNowPaymentsPayCurrencies is the currencies the wallet offers now.
func GetNowPaymentsPayCurrencies() []NowPaymentsCurrency {
	currencies, err := ParseNowPaymentsPayCurrencies(NowPaymentsPayCurrencies)
	if err != nil {
		return nil
	}
	return currencies
}
