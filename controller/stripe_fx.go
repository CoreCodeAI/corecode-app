package controller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"

	"github.com/shopspring/decimal"
)

// CoreCode: Stripe Checkout charges in HKD, the account's settlement
// currency, so Stripe adds no 2% conversion fee. An order keeps its CNY price
// as Money; the HKD amount is that price at the market rate, which the
// customer's wallet or card converts back to about the CNY price.

// stripeCheckoutCurrency is the currency Checkout charges in.
const stripeCheckoutCurrency = "hkd"

// hkdPerCNYSource is one public FX feed quoting HKD per CNY.
type hkdPerCNYSource struct {
	name  string
	url   string
	parse func(body []byte) (float64, error)
}

// hkdPerCNYSources are tried in order. Frankfurter publishes the European
// Central Bank's reference rates on working days; ExchangeRate-API's open
// feed updates daily. Neither needs a key.
var hkdPerCNYSources = []hkdPerCNYSource{
	{
		name: "frankfurter",
		url:  "https://api.frankfurter.dev/v1/latest?base=CNY&symbols=HKD",
		parse: func(body []byte) (float64, error) {
			var quote struct {
				Rates struct {
					HKD float64 `json:"HKD"`
				} `json:"rates"`
			}
			err := common.Unmarshal(body, &quote)
			return quote.Rates.HKD, err
		},
	},
	{
		name: "exchangerate-api",
		url:  "https://open.er-api.com/v6/latest/CNY",
		parse: func(body []byte) (float64, error) {
			var quote struct {
				Result string `json:"result"`
				Rates  struct {
					HKD float64 `json:"HKD"`
				} `json:"rates"`
			}
			if err := common.Unmarshal(body, &quote); err != nil {
				return 0, err
			}
			if quote.Result != "success" {
				return 0, fmt.Errorf("result %q", quote.Result)
			}
			return quote.Rates.HKD, nil
		},
	},
}

const (
	// hkdPerCNYRefresh is how long a fetched rate is used before the next
	// fetch, and how long a failed fetch waits before another try.
	hkdPerCNYRefresh = time.Hour
	// hkdPerCNYMaxAge is how long the last fetched rate may still price an
	// order while every source fails. CNY/HKD moves well under 1% a day.
	hkdPerCNYMaxAge = 24 * time.Hour
	// hkdPerCNYMin and hkdPerCNYMax bound a plausible rate (1.05 to 1.27
	// since 2010), so a malformed feed cannot set a price.
	hkdPerCNYMin = 0.8
	hkdPerCNYMax = 1.6
)

var hkdPerCNYClient = &http.Client{Timeout: 5 * time.Second}

// hkdPerCNY is the process's cached rate. Each server process fetches its
// own; two processes during a release may differ by one refresh.
var hkdPerCNY struct {
	sync.Mutex
	rate      decimal.Decimal
	fetchedAt time.Time
	nextFetch time.Time
}

var errNoHKDRate = errors.New("no CNY/HKD exchange rate available")

// stripeHKDPerCNY returns HKD per CNY: the cached rate while it is fresh,
// otherwise a fetched one, otherwise the last fetched rate while it is no
// older than hkdPerCNYMaxAge.
func stripeHKDPerCNY(ctx context.Context) (decimal.Decimal, error) {
	hkdPerCNY.Lock()
	defer hkdPerCNY.Unlock()
	now := time.Now()
	if now.Before(hkdPerCNY.nextFetch) && !hkdPerCNY.rate.IsZero() {
		return hkdPerCNY.rate, nil
	}
	if now.Before(hkdPerCNY.nextFetch) {
		return decimal.Zero, errNoHKDRate
	}

	rate, err := fetchHKDPerCNY(ctx)
	if err == nil {
		hkdPerCNY.rate, hkdPerCNY.fetchedAt, hkdPerCNY.nextFetch = rate, now, now.Add(hkdPerCNYRefresh)
		hkdPerCNYLatest.Store(&hkdPerCNYQuote{rate: rate, fetchedAt: now})
		return rate, nil
	}
	hkdPerCNY.nextFetch = now.Add(time.Minute)
	if !hkdPerCNY.rate.IsZero() && now.Sub(hkdPerCNY.fetchedAt) <= hkdPerCNYMaxAge {
		logger.LogWarn(ctx, common.LogText("Stripe FX rate refresh failed, using the rate fetched at %s error=%q", hkdPerCNY.fetchedAt.Format(time.RFC3339), err.Error()))
		return hkdPerCNY.rate, nil
	}
	logger.LogError(ctx, common.LogText("Stripe FX rate unavailable error=%q", err.Error()))
	return decimal.Zero, errNoHKDRate
}

func fetchHKDPerCNY(ctx context.Context) (decimal.Decimal, error) {
	var errs []error
	for _, source := range hkdPerCNYSources {
		rate, err := fetchHKDPerCNYFrom(ctx, source)
		if err == nil {
			return decimal.NewFromFloat(rate), nil
		}
		errs = append(errs, fmt.Errorf("%s: %w", source.name, err))
	}
	return decimal.Zero, errors.Join(errs...)
}

func fetchHKDPerCNYFrom(ctx context.Context, source hkdPerCNYSource) (float64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source.url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := hkdPerCNYClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return 0, err
	}
	rate, err := source.parse(body)
	if err != nil {
		return 0, err
	}
	if rate < hkdPerCNYMin || rate > hkdPerCNYMax {
		return 0, fmt.Errorf("implausible rate %v", rate)
	}
	return rate, nil
}

// stripeHKDDiscountMax caps StripeHKDDiscount, so a mistyped setting cannot
// give orders away.
const stripeHKDDiscountMax = 0.05

// stripeHKDCents is the amount Checkout charges for payMoney (CNY), in HK
// cents: payMoney at the market rate, less StripeHKDDiscount, rounded down.
// Wallets and card issuers convert HKD back at a rate a little below the
// market's, so without the discount the customer pays slightly more than
// the CNY price.
func stripeHKDCents(payMoney float64, hkdPerCNY decimal.Decimal) int64 {
	return decimal.NewFromFloat(payMoney).Mul(stripeChargedHKDPerCNY(hkdPerCNY)).
		Mul(decimal.NewFromInt(100)).Floor().IntPart()
}

// stripeChargedHKDPerCNY is what Checkout charges in HKD for one CNY: the
// market rate less StripeHKDDiscount.
func stripeChargedHKDPerCNY(hkdPerCNY decimal.Decimal) decimal.Decimal {
	discount := decimal.NewFromFloat(min(max(setting.StripeHKDDiscount, 0), stripeHKDDiscountMax))
	return hkdPerCNY.Mul(decimal.NewFromInt(1).Sub(discount))
}

// hkdPerCNYQuote is one successfully fetched rate.
type hkdPerCNYQuote struct {
	rate      decimal.Decimal
	fetchedAt time.Time
}

// hkdPerCNYLatest is the last fetched rate, readable without the lock that
// stripeHKDPerCNY holds while it fetches.
var hkdPerCNYLatest atomic.Pointer[hkdPerCNYQuote]

// hkdPerCNYRefreshing keeps pricing requests to one background fetch at a time.
var hkdPerCNYRefreshing atomic.Bool

// pricingHKDPerCNY is the HKD the pricing page shows for one CNY of price:
// what Checkout would charge for it, rounded to four decimals, or 0 when no
// rate younger than hkdPerCNYMaxAge is known. It never waits on a fetch, so
// GET /api/pricing stays fast; when the rate is older than hkdPerCNYRefresh,
// or missing, it starts one in the background for later requests.
func pricingHKDPerCNY() float64 {
	quote := hkdPerCNYLatest.Load()
	if (quote == nil || time.Since(quote.fetchedAt) >= hkdPerCNYRefresh) && hkdPerCNYRefreshing.CompareAndSwap(false, true) {
		go func() {
			defer hkdPerCNYRefreshing.Store(false)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			_, _ = stripeHKDPerCNY(ctx)
		}()
	}
	if quote == nil || time.Since(quote.fetchedAt) > hkdPerCNYMaxAge {
		return 0
	}
	return stripeChargedHKDPerCNY(quote.rate).Round(4).InexactFloat64()
}
