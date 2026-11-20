package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// CoreCode addition: top-ups through a per-user on-chain deposit address. A
// separate deposit service derives each user's address, watches it, sweeps it,
// and reports the cumulative amount received per network and token. This file
// asks that service for addresses, reads its feed, and credits the difference
// between a total and what was already credited
// (model.CreditChainDeposit). Any amount of at least one dollar is credited at
// the wallet's rate, with the top-up bonus.

// chainDepositHTTPClient talks to the deposit service. Tests may replace it.
var chainDepositHTTPClient = &http.Client{Timeout: 15 * time.Second}

const (
	chainDepositMaxResponse = 8 << 20
	chainDepositFeedLimit   = 500
	// chainDepositMaxPages bounds one pass, so a long backlog is read over
	// several passes rather than in one run.
	chainDepositMaxPages = 20
)

// chainDepositTokens are the symbols the service reports and the app credits,
// each counted as one dollar. USDC.e is credited but never listed.
var chainDepositTokens = map[string]bool{"USDT": true, "USDC": true, "USDT0": true, "USDC.e": true}

var chainDepositNetworkNames = map[string]string{"bsc": "BNB Smart Chain", "arbitrum": "Arbitrum One"}

// chainDepositStatusError is a refusal from the deposit service.
type chainDepositStatusError struct {
	Status int
	Body   string
}

func (e *chainDepositStatusError) Error() string {
	return fmt.Sprintf("deposit service answered status %d: %s", e.Status, e.Body)
}

// chainDepositSign is the lowercase hex HMAC-SHA256 of the request.
func chainDepositSign(secret string, method string, requestURI string, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(method + "\n" + requestURI + "\n" + timestamp + "\n"))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// chainDepositResponseValid checks X-Deposit-Signature on a 200 response: an
// HMAC over "response\n", the request's signature and the raw body.
func chainDepositResponseValid(secret string, requestSignature string, body []byte, signature string) bool {
	expected, err := hex.DecodeString(strings.TrimSpace(signature))
	if err != nil || len(expected) == 0 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("response\n" + requestSignature + "\n"))
	mac.Write(body)
	return hmac.Equal(mac.Sum(nil), expected)
}

// chainDepositCall sends one signed request and returns the verified body of
// a 200 answer. An answer without a good signature is an error, and so is any
// other status.
func chainDepositCall(ctx context.Context, method string, requestURI string, body []byte) ([]byte, error) {
	secret := setting.ChainDepositHmacSecret
	baseURL := strings.TrimRight(strings.TrimSpace(setting.ChainDepositApiUrl), "/")
	if baseURL == "" || secret == "" {
		return nil, errors.New("deposit service is not configured")
	}
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	signature := chainDepositSign(secret, method, requestURI, timestamp, body)
	request, err := http.NewRequestWithContext(ctx, method, baseURL+requestURI, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("X-Deposit-Timestamp", timestamp)
	request.Header.Set("X-Deposit-Signature", signature)
	if len(body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := chainDepositHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, chainDepositMaxResponse))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, &chainDepositStatusError{Status: response.StatusCode, Body: truncateChainDepositText(string(responseBody))}
	}
	if !chainDepositResponseValid(secret, signature, responseBody, response.Header.Get("X-Deposit-Signature")) {
		return nil, errors.New("deposit service response signature is missing or wrong")
	}
	return responseBody, nil
}

func truncateChainDepositText(text string) string {
	if len(text) > 200 {
		return text[:200]
	}
	return text
}

type chainDepositToken struct {
	Symbol   string `json:"symbol"`
	Contract string `json:"contract"`
	Decimals int    `json:"decimals"`
}

type chainDepositNetwork struct {
	Network string              `json:"network"`
	Name    string              `json:"name"`
	ChainID int64               `json:"chain_id"`
	Tokens  []chainDepositToken `json:"tokens"`
}

// ChainDepositAddress is what the console shows: the user's address and the
// networks and tokens it accepts.
type ChainDepositAddress struct {
	UserID   int                   `json:"user_id"`
	Address  string                `json:"address"`
	Networks []chainDepositNetwork `json:"networks"`
}

type chainDepositTotalItem struct {
	UserID    int    `json:"user_id"`
	Address   string `json:"address"`
	Network   string `json:"network"`
	Token     string `json:"token"`
	Contract  string `json:"contract"`
	Decimals  int    `json:"decimals"`
	Received  string `json:"received"`
	Block     int64  `json:"block"`
	BlockHash string `json:"block_hash"`
	Time      int64  `json:"time"`
}

type chainDepositAlert struct {
	Level string `json:"level"`
	Text  string `json:"text"`
	Time  int64  `json:"time"`
}

type chainDepositFeedItem struct {
	Seq   int64                  `json:"seq"`
	Kind  string                 `json:"kind"`
	Total *chainDepositTotalItem `json:"total"`
	Alert *chainDepositAlert     `json:"alert"`
}

type chainDepositFeed struct {
	Items []chainDepositFeedItem `json:"items"`
	Next  int64                  `json:"next"`
}

func chainDepositUserBody(userId int) []byte {
	return []byte(`{"user_id":` + strconv.Itoa(userId) + `}`)
}

func chainDepositFetchAddress(ctx context.Context, userId int) (*ChainDepositAddress, error) {
	body, err := chainDepositCall(ctx, http.MethodPost, "/v1/addresses", chainDepositUserBody(userId))
	if err != nil {
		return nil, err
	}
	address := &ChainDepositAddress{}
	if err := common.Unmarshal(body, address); err != nil {
		return nil, err
	}
	if address.UserID != userId || address.Address == "" {
		return nil, errors.New("deposit service answered an address for another user")
	}
	return address, nil
}

func chainDepositFetchFeed(ctx context.Context, after int64) (*chainDepositFeed, error) {
	body, err := chainDepositCall(ctx, http.MethodGet, fmt.Sprintf("/v1/feed?after=%d&limit=%d", after, chainDepositFeedLimit), nil)
	if err != nil {
		return nil, err
	}
	feed := &chainDepositFeed{}
	if err := common.Unmarshal(body, feed); err != nil {
		return nil, err
	}
	return feed, nil
}

// RequestChainDepositAddress answers the caller's deposit address, creating
// it on the first request.
func RequestChainDepositAddress(c *gin.Context) {
	if !canUseChainDeposit(c.GetInt("role")) {
		paymentError(c, common.NewMessage("Payment method does not exist"))
		return
	}
	id := c.GetInt("id")
	address, err := chainDepositFetchAddress(c.Request.Context(), id)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("chain deposit failed to get address user_id=%d error=%q", id, err.Error()))
		paymentError(c, common.NewMessage("Failed to get the deposit address"))
		return
	}
	common.ApiSuccess(c, address)
}

// chainDepositPassAfterCheck runs one feed pass in the background once the
// service has read the caller's address. Tests run it in line.
var chainDepositPassAfterCheck = func() {
	gopool.Go(func() {
		if err := RunChainDepositPass(context.Background()); err != nil {
			common.SysError(common.LogText("chain deposit pass after check failed: %s", err.Error()))
		}
	})
}

// RequestChainDepositCheck is the "I have sent it" button: the deposit service
// reads the caller's address now, and one feed pass follows to credit what it
// found.
func RequestChainDepositCheck(c *gin.Context) {
	if !canUseChainDeposit(c.GetInt("role")) {
		paymentError(c, common.NewMessage("Payment method does not exist"))
		return
	}
	id := c.GetInt("id")
	if _, err := chainDepositCall(c.Request.Context(), http.MethodPost, "/v1/check", chainDepositUserBody(id)); err != nil {
		var status *chainDepositStatusError
		switch {
		case errors.As(err, &status) && status.Status == http.StatusNotFound:
			paymentError(c, common.NewMessage("No deposit address yet. Open the deposit address first."))
		case errors.As(err, &status) && status.Status == http.StatusTooManyRequests:
			paymentError(c, common.NewMessage("Checked a moment ago. Try again in a few seconds."))
		default:
			logger.LogError(c.Request.Context(), common.LogText("chain deposit check failed user_id=%d error=%q", id, err.Error()))
			paymentError(c, common.NewMessage("Failed to check the deposit"))
		}
		return
	}
	chainDepositPassAfterCheck()
	common.ApiSuccess(c, gin.H{"checked": true})
}

// chainDepositPrice prices a credited difference like a NOWPayments order:
// dollars become CNY money at USDExchangeRate, money becomes top-up units
// through the epay price, and the bonus is the rate of that amount's tier. It
// keeps the fraction of a unit, so a difference of 1.5 dollars credits 1.5.
func chainDepositPrice(dollars decimal.Decimal) (model.ChainDepositPrice, error) {
	exchangeRate := operation_setting.USDExchangeRate
	price := operation_setting.Price
	if exchangeRate <= 0 || price <= 0 || common.QuotaPerUnit <= 0 {
		return model.ChainDepositPrice{}, errors.New("USDExchangeRate, Price and QuotaPerUnit must be positive")
	}
	money := dollars.Mul(decimal.NewFromFloat(exchangeRate))
	units := money.Div(decimal.NewFromFloat(price))
	quotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	quota, err := common.WalletQuotaFromDecimalStrict(units.Mul(quotaPerUnit).Floor())
	if err != nil || quota <= 0 {
		return model.ChainDepositPrice{}, model.ErrInvalidTopUpQuota
	}
	tierAmount := chainDepositTierAmount(units)
	bonus := 0
	if rate := operation_setting.TopUpBonusRate(tierAmount.Floor().IntPart()); rate > 0 {
		bonus, err = common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(int64(quota)).Mul(decimal.NewFromFloat(rate)).Floor())
		if err != nil {
			return model.ChainDepositPrice{}, err
		}
	}
	return model.ChainDepositPrice{
		Amount:     units.Round(0).IntPart(),
		Money:      money.Round(2).InexactFloat64(),
		Quota:      quota,
		BonusQuota: int64(bonus),
	}, nil
}

// chainDepositTierAmount is a credit of units in the amount a customer types,
// which bonus tiers are read in: tokens in token display, units otherwise.
func chainDepositTierAmount(units decimal.Decimal) decimal.Decimal {
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		return units.Mul(decimal.NewFromFloat(common.QuotaPerUnit))
	}
	return units
}

// chainDepositUnitsFor is a typed amount in top-up units: tokens divided by
// QuotaPerUnit in token display, the amount itself otherwise.
func chainDepositUnitsFor(amount int64) decimal.Decimal {
	units := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		return units.Div(decimal.NewFromFloat(common.QuotaPerUnit))
	}
	return units
}

// chainDepositDollarsFor is the least whole-cent dollar amount chainDepositPrice
// reads as at least amount, in the amount a customer types: a transfer of it
// credits the amount and reaches the amount's bonus tier, and one cent less
// may not.
func chainDepositDollarsFor(amount int64) (decimal.Decimal, error) {
	exchangeRate := decimal.NewFromFloat(operation_setting.USDExchangeRate)
	price := decimal.NewFromFloat(operation_setting.Price)
	quotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	if !exchangeRate.IsPositive() || !price.IsPositive() || !quotaPerUnit.IsPositive() {
		return decimal.Zero, errors.New("USDExchangeRate, Price and QuotaPerUnit must be positive")
	}
	target := chainDepositUnitsFor(amount)
	cent := decimal.New(1, -2)
	dollars := target.Mul(price).Div(exchangeRate).Div(cent).Ceil().Mul(cent)
	// Division rounds; step up a cent at a time until the credit reads it.
	for range 3 {
		units := dollars.Mul(exchangeRate).Div(price)
		if chainDepositTierAmount(units).Floor().IntPart() >= amount {
			return dollars, nil
		}
		dollars = dollars.Add(cent)
	}
	return decimal.Zero, fmt.Errorf("no cent amount reaches %d", amount)
}

// chainDepositMaxQuoteAmount bounds a quote's amount far above any top-up.
const chainDepositMaxQuoteAmount = 1_000_000_000

// ChainDepositQuote is what a top-up amount costs on chain. Money is its
// price in CNY, as the wallet's other methods name it before any group ratio
// or discount; USD is the least transfer that credits Amount. When the amount earns a bonus, BonusUSD is
// the least transfer that still earns BonusRate, the rate of the tier the
// amount is in, and LowerRate is what a smaller transfer earns. A tier is
// read per credited transfer.
type ChainDepositQuote struct {
	Amount    int64   `json:"amount"`
	Money     float64 `json:"money"`
	USD       string  `json:"usd"`
	BonusRate float64 `json:"bonus_rate"`
	BonusUSD  string  `json:"bonus_usd,omitempty"`
	LowerRate float64 `json:"lower_rate"`
}

func chainDepositQuote(amount int64) (*ChainDepositQuote, error) {
	dollars, err := chainDepositDollarsFor(amount)
	if err != nil {
		return nil, err
	}
	money := chainDepositUnitsFor(amount).Mul(decimal.NewFromFloat(operation_setting.Price)).Round(2)
	quote := &ChainDepositQuote{Amount: amount, Money: money.InexactFloat64(), USD: dollars.StringFixed(2)}
	tierMin, rate := operation_setting.TopUpBonusTier(amount)
	if rate > 0 {
		tierDollars, err := chainDepositDollarsFor(tierMin)
		if err != nil {
			return nil, err
		}
		quote.BonusRate = rate
		quote.BonusUSD = tierDollars.StringFixed(2)
		quote.LowerRate = operation_setting.TopUpBonusRate(tierMin - 1)
	}
	return quote, nil
}

// RequestChainDepositQuote answers what the amount the caller picked costs on
// chain, and the least transfer that keeps its bonus. The deposit itself
// takes any amount.
func RequestChainDepositQuote(c *gin.Context) {
	if !canUseChainDeposit(c.GetInt("role")) {
		paymentError(c, common.NewMessage("Payment method does not exist"))
		return
	}
	var req struct {
		Amount int64 `json:"amount"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Amount <= 0 || req.Amount > chainDepositMaxQuoteAmount {
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	quote, err := chainDepositQuote(req.Amount)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("chain deposit quote failed amount=%d error=%q", req.Amount, err.Error()))
		paymentError(c, common.NewMessage("Invalid parameters"))
		return
	}
	common.ApiSuccess(c, quote)
}

// chainDepositTotalToModel validates a total from the feed.
func chainDepositTotalToModel(item *chainDepositTotalItem) (model.ChainDepositTotal, error) {
	received, ok := new(big.Int).SetString(item.Received, 10)
	if !ok || received.Sign() < 0 || item.UserID <= 0 || item.Network == "" || !chainDepositTokens[item.Token] || item.Decimals < 0 || item.Decimals > 30 {
		return model.ChainDepositTotal{}, model.ErrChainDepositInvalidTotal
	}
	return model.ChainDepositTotal{UserId: item.UserID, Network: item.Network, Token: item.Token, Decimals: item.Decimals, Received: received}, nil
}

// sendChainDepositFeishu posts to the operators' Feishu group, the NOWPayments
// webhook. It sends in the caller's goroutine, which is a background pass.
func sendChainDepositFeishu(text string) {
	webhook := strings.TrimSpace(setting.NowPaymentsFeishuWebhook)
	if webhook == "" {
		return
	}
	if err := sendNowPaymentsFeishu(webhook, setting.NowPaymentsFeishuSecret, text); err != nil {
		common.SysError(common.LogText("chain deposit Feishu notice not sent error=%q", err.Error()))
	}
}

func chainDepositNetworkName(network string) string {
	if name, ok := chainDepositNetworkNames[network]; ok {
		return name
	}
	return network
}

// chainDepositCreditedText describes a credit for the Feishu group.
func chainDepositCreditedText(total model.ChainDepositTotal, result *model.ChainDepositResult) string {
	return strings.Join([]string{
		"✅ 链上充值到账",
		"用户：" + nowPaymentsFeishuUser(total.UserId),
		"网络：" + chainDepositNetworkName(total.Network),
		"币种：" + total.Token,
		"金额：" + result.Dollars.String() + " USD",
		fmt.Sprintf("到账额度：%s（赠送 %s）", logger.FormatQuota(result.Quota), logger.FormatQuota(int(result.TopUp.BonusQuota))),
		"订单：" + result.TopUp.TradeNo,
	}, "\n")
}

// chainDepositAlertText is how an alert from the service reads in Feishu.
func chainDepositAlertText(alert *chainDepositAlert) string {
	if alert.Level == "critical" {
		return "🚨 链上充值严重告警: " + alert.Text
	}
	return "⚠️ 链上充值告警: " + alert.Text
}

// applyChainDepositTotal credits one total and returns the alert, if any, the
// operators should read about it. The credit's own Feishu notice is sent here:
// only the server that wins the credit gets that far.
func applyChainDepositTotal(item *chainDepositTotalItem) (alert string, err error) {
	total, err := chainDepositTotalToModel(item)
	if err != nil {
		return fmt.Sprintf("⚠️ 链上充值告警: 无法处理的累计数据 用户 #%d %s %s received=%q", item.UserID, item.Network, item.Token, item.Received), nil
	}
	result, err := model.CreditChainDeposit(total, chainDepositPrice)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, model.ErrTopUpQuotaLimitExceeded), errors.Is(err, model.ErrInvalidTopUpQuota), errors.Is(err, model.ErrWalletQuotaLimitExceeded):
		// Retrying cannot help: say so, and the next change of the total
		// credits the whole difference once the cause is fixed.
		return fmt.Sprintf("⚠️ 链上充值告警: 未能入账 用户 #%d %s %s 累计 %s: %s", total.UserId, chainDepositNetworkName(total.Network), total.Token, total.Received.String(), err.Error()), nil
	case err != nil:
		return "", err
	}
	switch result.Outcome {
	case model.ChainDepositCredits:
		logger.LogInfo(context.Background(), common.LogText("chain deposit credited user_id=%d network=%s token=%s dollars=%s trade_no=%s quota=%d", total.UserId, total.Network, total.Token, result.Dollars.String(), result.TopUp.TradeNo, result.Quota))
		sendChainDepositFeishu(chainDepositCreditedText(total, result))
	case model.ChainDepositLower:
		return fmt.Sprintf("⚠️ 链上充值告警: 累计到账低于已入账，未入账 用户 %s %s %s 服务累计 %s，已入账 %s（最小单位）",
			nowPaymentsFeishuUser(total.UserId), chainDepositNetworkName(total.Network), total.Token, total.Received.String(), result.Credited.String()), nil
	}
	return "", nil
}

// RunChainDepositPass reads the deposit feed from the saved cursor, credits
// its totals, and moves the cursor forward. Totals are idempotent, so two
// servers may read the same page; only the one that moves the cursor sends
// that page's alerts, which makes each alert go out at most once.
func RunChainDepositPass(ctx context.Context) error {
	if !isChainDepositConfigured() {
		return nil
	}
	for range chainDepositMaxPages {
		cursor, err := model.GetChainDepositCursor()
		if err != nil {
			return err
		}
		feed, err := chainDepositFetchFeed(ctx, cursor)
		if err != nil {
			return err
		}
		if len(feed.Items) == 0 || feed.Next <= cursor {
			return nil
		}
		var alerts []string
		for i := range feed.Items {
			item := &feed.Items[i]
			switch {
			case item.Kind == "total" && item.Total != nil:
				alert, err := applyChainDepositTotal(item.Total)
				if err != nil {
					// Leave the cursor where it is: the page is read again.
					return fmt.Errorf("feed seq %d: %w", item.Seq, err)
				}
				if alert != "" {
					alerts = append(alerts, alert)
				}
			case item.Kind == "alert" && item.Alert != nil:
				alerts = append(alerts, chainDepositAlertText(item.Alert))
			}
		}
		won, err := model.AdvanceChainDepositCursor(cursor, feed.Next)
		if err != nil {
			return err
		}
		if won {
			for _, alert := range alerts {
				sendChainDepositFeishu(alert)
			}
		}
		if len(feed.Items) < chainDepositFeedLimit {
			return nil
		}
	}
	return nil
}
