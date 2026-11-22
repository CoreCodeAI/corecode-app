package controller

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const chainDepositTestSecret = "deposit-hmac-secret"

// chainDepositStub is a deposit service. It checks each request's signature
// with its own HMAC code, answers addresses, checks and a feed, and signs
// its answers unless told to tamper.
type chainDepositStub struct {
	t      *testing.T
	server *httptest.Server

	mu         sync.Mutex
	items      []map[string]any
	badRequest []string // requests whose signature did not verify
	requests   []string // "METHOD uri" of each request
	checkCode  int
	// transfers and totals are what /v1/activity answers.
	transfers []map[string]any
	totals    []map[string]any
	// responseMode is "", "unsigned", "wrong" or "request-signature".
	responseMode string
}

func (s *chainDepositStub) mac(parts ...string) string {
	mac := hmac.New(sha256.New, []byte(chainDepositTestSecret))
	mac.Write([]byte(strings.Join(parts, "")))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *chainDepositStub) setItems(items ...map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items = items
}

func (s *chainDepositStub) handle(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	s.mu.Lock()
	defer s.mu.Unlock()
	uri := r.URL.RequestURI()
	s.requests = append(s.requests, r.Method+" "+uri)
	timestamp := r.Header.Get("X-Deposit-Timestamp")
	signature := r.Header.Get("X-Deposit-Signature")
	seconds, _ := strconv.ParseInt(timestamp, 10, 64)
	if signature != s.mac(r.Method, "\n", uri, "\n", timestamp, "\n", string(body)) || seconds == 0 {
		s.badRequest = append(s.badRequest, r.Method+" "+uri)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	var answer string
	switch {
	case r.URL.Path == "/v1/addresses":
		var request struct {
			UserID int `json:"user_id"`
		}
		require.NoError(s.t, common.Unmarshal(body, &request))
		answer = `{"user_id":` + strconv.Itoa(request.UserID) + `,"address":"0xAbC0000000000000000000000000000000000001","networks":[{"network":"bsc","name":"BNB Smart Chain","chain_id":56,"tokens":[{"symbol":"USDT","contract":"0x55d398326f99059fF775485246999027B3197955","decimals":18}]}]}`
	case r.URL.Path == "/v1/check":
		if s.checkCode != 0 {
			w.WriteHeader(s.checkCode)
			return
		}
		answer = `{"user_id":1,"address":"0xAbC0000000000000000000000000000000000001","totals":[]}`
	case r.URL.Path == "/v1/activity":
		var request struct {
			UserID int `json:"user_id"`
		}
		require.NoError(s.t, common.Unmarshal(body, &request))
		transfers, totals := s.transfers, s.totals
		if transfers == nil {
			transfers = []map[string]any{}
		}
		if totals == nil {
			totals = []map[string]any{}
		}
		raw, err := common.Marshal(map[string]any{"user_id": request.UserID, "transfers": transfers, "totals": totals})
		require.NoError(s.t, err)
		answer = string(raw)
	case r.URL.Path == "/v1/feed":
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		// A "dropped" item is a total the service cannot describe: it
		// fills its place on the page and moves next, but is not sent.
		var page []map[string]any
		next := after
		read := 0
		for _, item := range s.items {
			seq := int64(item["seq"].(int))
			if seq > after && read < limit {
				read++
				next = seq
				if item["kind"] != "dropped" {
					page = append(page, item)
				}
			}
		}
		if page == nil {
			page = []map[string]any{}
		}
		raw, err := common.Marshal(map[string]any{"items": page, "next": next})
		require.NoError(s.t, err)
		answer = string(raw)
	default:
		w.WriteHeader(http.StatusNotFound)
		return
	}
	switch s.responseMode {
	case "unsigned":
	case "wrong":
		w.Header().Set("X-Deposit-Signature", strings.Repeat("ab", 32))
	case "request-signature":
		// Signed as a request would be, not as a response.
		w.Header().Set("X-Deposit-Signature", signature)
	default:
		w.Header().Set("X-Deposit-Signature", s.mac("response\n", signature, "\n", answer))
	}
	_, _ = w.Write([]byte(answer))
}

func chainTotal(seq int, user int, network string, token string, decimals int, received string) map[string]any {
	return map[string]any{"seq": seq, "kind": "total", "total": map[string]any{
		"user_id": user, "address": "0xAbC0000000000000000000000000000000000001", "network": network, "token": token,
		"contract": "0x55d398326f99059fF775485246999027B3197955", "decimals": decimals, "received": received,
		"block": 1, "block_hash": "0x01", "time": 1,
	}}
}

func chainAlert(seq int, level string, text string) map[string]any {
	return map[string]any{"seq": seq, "kind": "alert", "alert": map[string]any{"level": level, "text": text, "time": 1}}
}

// feishuRecorder replaces the Feishu sender and keeps what it was asked to send.
type feishuRecorder struct {
	mu    sync.Mutex
	texts []string
}

func (f *feishuRecorder) all() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.texts...)
}

func (f *feishuRecorder) count(substring string) int {
	count := 0
	for _, text := range f.all() {
		if strings.Contains(text, substring) {
			count++
		}
	}
	return count
}

func setupChainDeposit(t *testing.T) (*chainDepositStub, *feishuRecorder, *gorm.DB) {
	t.Helper()
	previous := struct {
		enabled, adminOnly, confirmed bool
		url, secret, termsVersion     string
		quotaPerUnit, price, rate     float64
		minTopUp                      int
		db, logDB                     *gorm.DB
		dbType, logDBType             common.DatabaseType
		master, memoryCache, redis    bool
		sqlitePath, feishuHook        string
		bonus                         map[int]float64
		sender                        func(string, string, string) error
		client                        *http.Client
	}{
		setting.ChainDepositEnabled, setting.ChainDepositAdminOnly, operation_setting.GetPaymentSetting().ComplianceConfirmed,
		setting.ChainDepositApiUrl, setting.ChainDepositHmacSecret, operation_setting.GetPaymentSetting().ComplianceTermsVersion,
		common.QuotaPerUnit, operation_setting.Price, operation_setting.USDExchangeRate,
		operation_setting.MinTopUp, model.DB, model.LOG_DB, common.MainDatabaseType(), common.LogDatabaseType(),
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath, setting.NowPaymentsFeishuWebhook,
		operation_setting.GetPaymentSetting().AmountBonus, sendNowPaymentsFeishu, chainDepositHTTPClient,
	}
	t.Setenv("SQL_DSN", "")
	t.Setenv("LOG_SQL_DSN", "")
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	common.SQLitePath = filepath.Join(t.TempDir(), "chain.db")
	require.NoError(t, model.InitDB())
	db := model.DB
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.TopUp{}, &model.Log{}, &model.ChainDepositCredit{}, &model.ChainDepositCursor{}))
	model.LOG_DB = db
	common.SetLogDatabaseType(common.MainDatabaseType())

	// Most tests read the tiers alone; the on-chain bonus has its own tests.
	chainBonus := setting.ChainDepositBonusRate
	setting.ChainDepositBonusRate = 0
	t.Cleanup(func() { setting.ChainDepositBonusRate = chainBonus })
	passAfterCheck := chainDepositPassAfterCheck
	chainDepositPassAfterCheck = func() { _ = RunChainDepositPass(context.Background()) }
	t.Cleanup(func() { chainDepositPassAfterCheck = passAfterCheck })
	stub := &chainDepositStub{t: t}
	stub.server = httptest.NewServer(http.HandlerFunc(stub.handle))
	feishu := &feishuRecorder{}

	common.QuotaPerUnit = 500000
	operation_setting.Price = 7
	operation_setting.USDExchangeRate = 7
	operation_setting.MinTopUp = 1
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	operation_setting.GetPaymentSetting().AmountBonus = map[int]float64{10: 0.2}
	setting.ChainDepositEnabled, setting.ChainDepositAdminOnly = true, true
	setting.ChainDepositApiUrl, setting.ChainDepositHmacSecret = stub.server.URL+"/", chainDepositTestSecret
	setting.NowPaymentsFeishuWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test"
	sendNowPaymentsFeishu = func(_ string, _ string, text string) error {
		feishu.mu.Lock()
		defer feishu.mu.Unlock()
		feishu.texts = append(feishu.texts, text)
		return nil
	}
	t.Cleanup(func() {
		stub.server.Close()
		setting.ChainDepositEnabled, setting.ChainDepositAdminOnly = previous.enabled, previous.adminOnly
		setting.ChainDepositApiUrl, setting.ChainDepositHmacSecret = previous.url, previous.secret
		setting.NowPaymentsFeishuWebhook = previous.feishuHook
		sendNowPaymentsFeishu = previous.sender
		chainDepositHTTPClient = previous.client
		common.QuotaPerUnit = previous.quotaPerUnit
		operation_setting.Price, operation_setting.USDExchangeRate, operation_setting.MinTopUp = previous.price, previous.rate, previous.minTopUp
		operation_setting.GetPaymentSetting().ComplianceConfirmed = previous.confirmed
		operation_setting.GetPaymentSetting().ComplianceTermsVersion = previous.termsVersion
		operation_setting.GetPaymentSetting().AmountBonus = previous.bonus
		model.DB, model.LOG_DB = previous.db, previous.logDB
		common.SetDatabaseTypes(previous.dbType, previous.logDBType)
		common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled, common.SQLitePath = previous.master, previous.memoryCache, previous.redis, previous.sqlitePath
		require.NoError(t, sqlDB.Close())
	})
	return stub, feishu, db
}

func chainDepositTestUser(t *testing.T, db *gorm.DB, name string, role int) *model.User {
	t.Helper()
	user := &model.User{Username: name, Role: role, Status: common.UserStatusEnabled, AffCode: name + "-aff"}
	require.NoError(t, db.Create(user).Error)
	return user
}

func chainDepositQuota(t *testing.T, db *gorm.DB, userId int) int {
	t.Helper()
	var user model.User
	require.NoError(t, db.Select("quota").Where("id = ?", userId).First(&user).Error)
	return user.Quota
}

// chainDepositLogParts returns each top-up log's structured content, oldest
// first.
func chainDepositLogParts(t *testing.T, db *gorm.DB, userId int) []common.Message {
	t.Helper()
	var logs []model.Log
	require.NoError(t, db.Where("user_id = ? AND type = ?", userId, model.LogTypeTopup).Order("id").Find(&logs).Error)
	parts := make([]common.Message, 0, len(logs))
	for _, log := range logs {
		var other struct {
			ContentParts []common.Message `json:"content_parts"`
		}
		require.NoError(t, json.Unmarshal([]byte(log.Other), &other))
		require.Len(t, other.ContentParts, 1)
		parts = append(parts, other.ContentParts[0])
	}
	return parts
}

func chainDepositTopUps(t *testing.T, db *gorm.DB, userId int) []model.TopUp {
	t.Helper()
	var topUps []model.TopUp
	require.NoError(t, db.Where("user_id = ?", userId).Order("id").Find(&topUps).Error)
	return topUps
}

func callChainDeposit(handler gin.HandlerFunc, user *model.User, path string) map[string]any {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, path, nil)
	ctx.Set("id", user.Id)
	ctx.Set("role", user.Role)
	handler(ctx)
	var body map[string]any
	_ = common.Unmarshal(recorder.Body.Bytes(), &body)
	return body
}

func TestChainDepositRequestsAreSignedAndAnswersVerified(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	admin := chainDepositTestUser(t, db, "chain_admin", common.RoleAdminUser)

	body := callChainDeposit(RequestChainDepositAddress, admin, "/api/user/chain-deposit/address")
	require.Equal(t, true, body["success"], "%v", body)
	assert.Equal(t, "0xAbC0000000000000000000000000000000000001", body["data"].(map[string]any)["address"])

	require.NoError(t, RunChainDepositPass(context.Background()))
	body = callChainDeposit(RequestChainDepositCheck, admin, "/api/user/chain-deposit/check")
	require.Equal(t, true, body["success"], "%v", body)

	stub.mu.Lock()
	assert.Empty(t, stub.badRequest, "the stub recomputes every signature itself")
	assert.Contains(t, stub.requests, "POST /v1/addresses")
	assert.Contains(t, stub.requests, "GET /v1/feed?after=0&limit=500", "the query is part of the signed URI")
	stub.mu.Unlock()

	// A signature made with another key is refused by the stub, and the app
	// reports it as a failure.
	setting.ChainDepositHmacSecret = "another-secret"
	_, err := chainDepositFetchFeed(context.Background(), 0)
	var status *chainDepositStatusError
	require.ErrorAs(t, err, &status)
	assert.Equal(t, http.StatusUnauthorized, status.Status)
}

func TestChainDepositRefusesUnsignedAndBadlySignedResponses(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_signed", common.RoleAdminUser)
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "5000000000000000000"), chainAlert(2, "critical", "gas wallet empty"))

	for _, mode := range []string{"unsigned", "wrong", "request-signature"} {
		stub.mu.Lock()
		stub.responseMode = mode
		stub.mu.Unlock()
		require.Error(t, RunChainDepositPass(context.Background()), mode)
		_, err := chainDepositFetchAddress(context.Background(), user.Id)
		require.Error(t, err, mode)
		body := callChainDeposit(RequestChainDepositAddress, user, "/api/user/chain-deposit/address")
		assert.NotEqual(t, true, body["success"], mode)
	}
	assert.Zero(t, chainDepositQuota(t, db, user.Id), "an unverified body credits nothing")
	assert.Empty(t, chainDepositTopUps(t, db, user.Id))
	assert.Empty(t, feishu.all())
	cursor, err := model.GetChainDepositCursor()
	require.NoError(t, err)
	assert.Zero(t, cursor)

	stub.mu.Lock()
	stub.responseMode = ""
	stub.mu.Unlock()
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Positive(t, chainDepositQuota(t, db, user.Id))
}

func TestChainDepositCreditsTheDifferenceWithBonusOnce(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_bonus", common.RoleCommonUser)

	// 12.5 dollars in 18-decimal units, which does not fit an int64.
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "12500000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))

	topUps := chainDepositTopUps(t, db, user.Id)
	require.Len(t, topUps, 1)
	assert.Equal(t, "CHAIN_bsc_USDT_"+strconv.Itoa(user.Id)+"_12500000000000000000", topUps[0].TradeNo)
	assert.Equal(t, common.TopUpStatusSuccess, topUps[0].Status)
	assert.Equal(t, model.PaymentMethodChainDeposit, topUps[0].PaymentMethod)
	assert.Equal(t, model.PaymentProviderChainDeposit, topUps[0].PaymentProvider)
	assert.InDelta(t, 87.5, topUps[0].Money, 0.001, "dollars times USDExchangeRate")
	// 12.5 units earn the tier at 10: 20% of 6,250,000.
	assert.EqualValues(t, 1250000, topUps[0].BonusQuota)
	assert.Equal(t, 6250000+1250000, chainDepositQuota(t, db, user.Id))
	assert.Equal(t, 1, feishu.count("链上充值到账"))

	// The service now reports 20 dollars in total: only the 7.5 added is
	// credited, and below the tier at 10 it earns no bonus.
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "12500000000000000000"), chainTotal(2, user.Id, "bsc", "USDT", 18, "20000000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	topUps = chainDepositTopUps(t, db, user.Id)
	require.Len(t, topUps, 2)
	assert.EqualValues(t, 0, topUps[1].BonusQuota)
	assert.Equal(t, 6250000+1250000+3750000, chainDepositQuota(t, db, user.Id))

	// Each credit's record names the coins that arrived, not the total.
	parts := chainDepositLogParts(t, db, user.Id)
	require.Len(t, parts, 2)
	assert.Equal(t, "Online top-up succeeded, amount added: {{quota}} including a bonus of {{bonus}}, payment amount: {{amount}}", parts[0].Key)
	assert.Equal(t, "12.5 USDT (BNB Smart Chain)", parts[0].Params["amount"])
	assert.Equal(t, "Online top-up succeeded, amount added: {{quota}}, payment amount: {{amount}}", parts[1].Key)
	assert.Equal(t, "7.5 USDT (BNB Smart Chain)", parts[1].Params["amount"])
}

func TestChainDepositRecordNamesArbitrumUSDT0AsUSDT(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_usdt0", common.RoleCommonUser)

	stub.setItems(chainTotal(1, user.Id, "arbitrum", "USDT0", 6, "3250000"))
	require.NoError(t, RunChainDepositPass(context.Background()))

	parts := chainDepositLogParts(t, db, user.Id)
	require.Len(t, parts, 1)
	assert.Equal(t, "3.25 USDT (Arbitrum One)", parts[0].Params["amount"])
}

func TestChainDepositRepeatedTotalCreditsOnce(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_repeat", common.RoleCommonUser)
	stub.setItems(chainTotal(1, user.Id, "arbitrum", "USDC", 6, "3000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	quota := chainDepositQuota(t, db, user.Id)
	assert.Equal(t, 3*500000, quota)

	// The same total again, as after a lost cursor or a replayed page.
	require.NoError(t, db.Model(&model.ChainDepositCursor{}).Where("1 = 1").Update("last_seq", 0).Error)
	require.NoError(t, RunChainDepositPass(context.Background()))
	stub.setItems(chainTotal(5, user.Id, "arbitrum", "USDC", 6, "3000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))

	assert.Len(t, chainDepositTopUps(t, db, user.Id), 1)
	assert.Equal(t, quota, chainDepositQuota(t, db, user.Id))
	assert.Equal(t, 1, feishu.count("链上充值到账"))
}

func TestChainDepositLowerTotalCreditsNothingAndAlerts(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_lower", common.RoleCommonUser)
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDC", 18, "5000000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	quota := chainDepositQuota(t, db, user.Id)

	stub.setItems(chainTotal(1, user.Id, "bsc", "USDC", 18, "5000000000000000000"), chainTotal(2, user.Id, "bsc", "USDC", 18, "4000000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))

	assert.Equal(t, quota, chainDepositQuota(t, db, user.Id))
	assert.Len(t, chainDepositTopUps(t, db, user.Id), 1)
	assert.Equal(t, 1, feishu.count("⚠️ 链上充值告警: 累计到账低于已入账"))

	// A repeat of the same page does not alert again: the cursor moved.
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Equal(t, 1, feishu.count("累计到账低于已入账"))
}

func TestChainDepositUnderOneDollarWaitsThenCredits(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_wait", common.RoleCommonUser)

	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "600000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Empty(t, chainDepositTopUps(t, db, user.Id))
	assert.Zero(t, chainDepositQuota(t, db, user.Id))

	// 0.6 and then 0.5 more: the uncredited 1.1 is credited whole.
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "600000000000000000"), chainTotal(2, user.Id, "bsc", "USDT", 18, "1100000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	topUps := chainDepositTopUps(t, db, user.Id)
	require.Len(t, topUps, 1)
	assert.Equal(t, 550000, chainDepositQuota(t, db, user.Id), "1.1 dollars at 500000 a dollar")
	assert.Equal(t, 1, feishu.count("链上充值到账"))

	// The least that credits is exactly one dollar, with 18 decimals.
	stub.setItems(chainTotal(3, user.Id, "bsc", "USDT", 18, "2099999999999999999"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Len(t, chainDepositTopUps(t, db, user.Id), 1, "0.999999999999999999 more waits")
	stub.setItems(chainTotal(4, user.Id, "bsc", "USDT", 18, "2100000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Len(t, chainDepositTopUps(t, db, user.Id), 2)
	assert.Equal(t, 550000+500000, chainDepositQuota(t, db, user.Id))
}

func TestChainDepositBigAmountsKeepEveryDigit(t *testing.T) {
	_, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_big", common.RoleCommonUser)
	// 20 dollars is 2e19 base units, past int64's 9.2e18.
	total := chainDepositItemFor(user.Id, "bsc", "USDT", 18, "20000000000000000001")
	_, err := applyChainDepositTotal(total)
	require.NoError(t, err)
	var credit model.ChainDepositCredit
	require.NoError(t, db.Where("user_id = ?", user.Id).First(&credit).Error)
	assert.Equal(t, "20000000000000000001", credit.Credited)
	assert.EqualValues(t, 2000000, chainDepositBonusOf(t, db, user.Id))
	assert.Equal(t, 10000000+2000000, chainDepositQuota(t, db, user.Id))
}

func chainDepositBonusOf(t *testing.T, db *gorm.DB, userId int) int {
	t.Helper()
	bonus := 0
	for _, topUp := range chainDepositTopUps(t, db, userId) {
		bonus += int(topUp.BonusQuota)
	}
	return bonus
}

func chainDepositItemFor(userId int, network string, token string, decimals int, received string) *chainDepositTotalItem {
	return &chainDepositTotalItem{UserID: userId, Network: network, Token: token, Decimals: decimals, Received: received}
}

func TestChainDepositConcurrentPassesCreditOnce(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_race", common.RoleCommonUser)
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "30000000000000000000"), chainAlert(2, "warning", "gas wallet low"))

	var wg sync.WaitGroup
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// A busy SQLite may refuse a pass; the next one finishes it.
			_ = RunChainDepositPass(context.Background())
		}()
	}
	wg.Wait()
	require.NoError(t, RunChainDepositPass(context.Background()))

	assert.Len(t, chainDepositTopUps(t, db, user.Id), 1)
	assert.Equal(t, 30*500000+chainDepositBonusOf(t, db, user.Id), chainDepositQuota(t, db, user.Id))
	assert.Equal(t, 1, feishu.count("链上充值到账"))
	assert.Equal(t, 1, feishu.count("gas wallet low"), "only the pass that moved the cursor sends the alert")
	cursor, err := model.GetChainDepositCursor()
	require.NoError(t, err)
	assert.EqualValues(t, 2, cursor)
}

func TestChainDepositCursorMovesOnlyFromItsValue(t *testing.T) {
	_, _, _ = setupChainDeposit(t)
	cursor, err := model.GetChainDepositCursor()
	require.NoError(t, err)
	require.Zero(t, cursor)

	won, err := model.AdvanceChainDepositCursor(0, 5)
	require.NoError(t, err)
	assert.True(t, won)
	won, err = model.AdvanceChainDepositCursor(0, 7)
	require.NoError(t, err)
	assert.False(t, won, "a second reader of the same page loses")
	won, err = model.AdvanceChainDepositCursor(5, 5)
	require.NoError(t, err)
	assert.False(t, won, "no movement")
	cursor, err = model.GetChainDepositCursor()
	require.NoError(t, err)
	assert.EqualValues(t, 5, cursor)
}

func TestChainDepositConcurrentCreditsOfOneTotalInsertOnce(t *testing.T) {
	_, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_credit_race", common.RoleCommonUser)
	item := chainDepositItemFor(user.Id, "arbitrum", "USDT0", 6, "4000000")

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = applyChainDepositTotal(item)
		}()
	}
	wg.Wait()
	_, err := applyChainDepositTotal(item)
	require.NoError(t, err)
	assert.Len(t, chainDepositTopUps(t, db, user.Id), 1)
	assert.Equal(t, 4*500000, chainDepositQuota(t, db, user.Id))
}

func TestChainDepositUnknownTokenAndUnknownUserAlertWithoutBlocking(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_alerts", common.RoleCommonUser)
	stub.setItems(
		chainTotal(1, user.Id, "bsc", "SHIB", 18, "5000000000000000000"),
		chainTotal(2, 987654, "bsc", "USDT", 18, "5000000000000000000"),
		chainTotal(3, user.Id, "arbitrum", "USDC.e", 6, "2000000"),
	)
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Equal(t, 1, feishu.count("无法处理的累计数据"))
	assert.Equal(t, 1, feishu.count("未能入账"))
	assert.Equal(t, 2*500000, chainDepositQuota(t, db, user.Id), "USDC.e is credited like USDC")
}

func TestChainDepositRefusesTotalsOutsideTheMainnetTokens(t *testing.T) {
	stub, feishu, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_allow_list", common.RoleCommonUser)
	stub.setItems(
		// BSC's USDT has 18 decimals: read at 6 it would be a trillion times more.
		chainTotal(1, user.Id, "bsc", "USDT", 6, "5000000"),
		chainTotal(2, user.Id, "bsc-testnet", "USDT", 18, "5000000000000000000"),
		chainTotal(3, user.Id, "arbitrum", "USDT", 6, "5000000"),
		chainTotal(4, user.Id, "bsc", "USDT", 18, "2000000000000000000"),
	)
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Equal(t, 3, feishu.count("无法处理的累计数据"))
	assert.Equal(t, 2*500000, chainDepositQuota(t, db, user.Id), "only the mainnet total is credited")
}

func TestChainDepositPassMovesPastAPageOfDroppedTotals(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_dropped", common.RoleCommonUser)
	items := make([]map[string]any, 0, chainDepositFeedLimit+1)
	for seq := 1; seq <= chainDepositFeedLimit; seq++ {
		items = append(items, map[string]any{"seq": seq, "kind": "dropped"})
	}
	items = append(items, chainTotal(chainDepositFeedLimit+1, user.Id, "bsc", "USDT", 18, "5000000000000000000"))
	stub.setItems(items...)

	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Equal(t, 5*500000, chainDepositQuota(t, db, user.Id), "the total after a full page of dropped ones is credited")
	cursor, err := model.GetChainDepositCursor()
	require.NoError(t, err)
	assert.EqualValues(t, chainDepositFeedLimit+1, cursor)
}

func TestChainDepositRepeatedPassFailuresAlertOnceAndRecover(t *testing.T) {
	_, feishu, _ := setupChainDeposit(t)
	chainDepositPassFailures.Store(0)
	t.Cleanup(func() { chainDepositPassFailures.Store(0) })

	for range chainDepositPassAlertAfter - 1 {
		noteChainDepositPass(errors.New("feed seq 7: database is locked"))
	}
	assert.Zero(t, feishu.count("入账连续"), "a short outage stays quiet")
	for range 5 {
		noteChainDepositPass(errors.New("feed seq 7: database is locked"))
	}
	assert.Equal(t, 1, feishu.count("入账连续"))
	assert.Equal(t, 1, feishu.count("database is locked"))
	noteChainDepositPass(nil)
	noteChainDepositPass(nil)
	assert.Equal(t, 1, feishu.count("已恢复"))

	// A single failure that recovers sends nothing.
	noteChainDepositPass(errors.New("timeout"))
	noteChainDepositPass(nil)
	assert.Equal(t, 1, feishu.count("已恢复"))
}

func TestChainDepositEarnsTheOnChainBonusOnTopOfTheTier(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	setting.ChainDepositBonusRate = 0.01
	user := chainDepositTestUser(t, db, "chain_extra_bonus", common.RoleCommonUser)

	// 5 dollars is under the tier at 10: the on-chain 1% alone, of 2,500,000.
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "5000000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	topUps := chainDepositTopUps(t, db, user.Id)
	require.Len(t, topUps, 1)
	assert.EqualValues(t, 25000, topUps[0].BonusQuota)

	// 12.5 more reaches the tier: 20% and 1%, 21% of 6,250,000.
	stub.setItems(chainTotal(1, user.Id, "bsc", "USDT", 18, "5000000000000000000"), chainTotal(2, user.Id, "bsc", "USDT", 18, "17500000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	topUps = chainDepositTopUps(t, db, user.Id)
	require.Len(t, topUps, 2)
	assert.EqualValues(t, 1312500, topUps[1].BonusQuota)
	assert.Equal(t, 2500000+25000+6250000+1312500, chainDepositQuota(t, db, user.Id))

	// The quote names the same rates.
	q, err := chainDepositQuote(5)
	require.NoError(t, err)
	assert.Equal(t, 0.01, q.BonusRate)
	assert.Equal(t, 0.01, q.ChainRate)
	assert.Empty(t, q.BonusUSD)
	q, err = chainDepositQuote(20)
	require.NoError(t, err)
	assert.Equal(t, 0.21, q.BonusRate)
	assert.Equal(t, 0.01, q.LowerRate)
	assert.Equal(t, "10.00", q.BonusUSD)
}

func TestChainDepositReplacesNowPaymentsInTheWallet(t *testing.T) {
	_, _, db := setupChainDeposit(t)
	setting.ChainDepositBonusRate = 0.01
	admin := chainDepositTestUser(t, db, "chain_wallet_admin", common.RoleAdminUser)
	customer := chainDepositTestUser(t, db, "chain_wallet_customer", common.RoleCommonUser)
	previous := struct{ key, secret, currencies, apiBase string }{setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret, setting.NowPaymentsPayCurrencies, nowPaymentsAPIBase}
	setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret = "np-key", "np-ipn"
	setting.NowPaymentsPayCurrencies = "usdtbsc"
	var invoices atomic.Int32
	nowPayments := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoices.Add(1)
		_, _ = w.Write([]byte(`{"invoice_url":"https://nowpayments.io/payment/?iid=1"}`))
	}))
	nowPaymentsAPIBase = nowPayments.URL
	t.Cleanup(func() {
		nowPayments.Close()
		setting.NowPaymentsApiKey, setting.NowPaymentsIpnSecret, setting.NowPaymentsPayCurrencies = previous.key, previous.secret, previous.currencies
		nowPaymentsAPIBase = previous.apiBase
	})
	require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}, &model.SubscriptionAddressExemption{}, &model.UserSession{}))
	plan := &model.SubscriptionPlan{Id: 7302, Title: "新人福利包", PriceAmount: 29.9, TotalAmount: 50 * 500000,
		DurationUnit: "day", DurationValue: 7, QuotaResetPeriod: "never", Enabled: true, MaxPurchasePerUser: 1}
	require.NoError(t, db.Create(plan).Error)
	// pay opens a NOWPayments invoice for a plan and for a top-up, and
	// returns how many reached NOWPayments.
	pay := func(user *model.User) int32 {
		before := invoices.Load()
		for _, call := range []struct {
			path, body string
			handler    gin.HandlerFunc
		}{
			{"/api/subscription/nowpayments/pay", fmt.Sprintf(`{"plan_id":%d,"pay_currency":"usdtbsc"}`, plan.Id), SubscriptionRequestNowPaymentsPay},
			{"/api/user/nowpayments/pay", `{"amount":100,"pay_currency":"usdtbsc"}`, RequestNowPaymentsPay},
		} {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodPost, call.path, strings.NewReader(call.body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set("id", user.Id)
			ctx.Set("role", user.Role)
			call.handler(ctx)
		}
		return invoices.Load() - before
	}

	info := func(user *model.User) (methods map[string]map[string]any, currencies []any) {
		gin.SetMode(gin.TestMode)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/topup/info", nil)
		ctx.Set("id", user.Id)
		ctx.Set("role", user.Role)
		GetTopUpInfo(ctx)
		var response struct {
			Data struct {
				PayMethods            []map[string]any `json:"pay_methods"`
				NowPaymentsCurrencies []any            `json:"nowpayments_currencies"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		methods = map[string]map[string]any{}
		for _, method := range response.Data.PayMethods {
			methods[method["type"].(string)] = method
		}
		return methods, response.Data.NowPaymentsCurrencies
	}

	// While the deposit address is for administrators, they get it in
	// NOWPayments' place, for top-ups and plans alike, and customers keep
	// NOWPayments.
	methods, currencies := info(admin)
	require.Contains(t, methods, model.PaymentMethodChainDeposit)
	assert.Equal(t, "0.01", methods[model.PaymentMethodChainDeposit]["bonus_rate"])
	assert.NotContains(t, methods, model.PaymentMethodNowPayments)
	assert.Empty(t, currencies, "plans are paid from the balance, not through NOWPayments")
	assert.Zero(t, pay(admin), "a stale console opens no NOWPayments invoice")
	methods, currencies = info(customer)
	assert.Contains(t, methods, model.PaymentMethodNowPayments)
	assert.NotContains(t, methods, model.PaymentMethodChainDeposit)
	assert.Len(t, currencies, 1)
	assert.EqualValues(t, 2, pay(customer), "a plan and a top-up invoice")

	// Opened to everyone, it replaces NOWPayments for customers too.
	setting.ChainDepositAdminOnly = false
	methods, currencies = info(customer)
	assert.Contains(t, methods, model.PaymentMethodChainDeposit)
	assert.NotContains(t, methods, model.PaymentMethodNowPayments)
	assert.Empty(t, currencies)
	assert.Zero(t, pay(customer))
}

func TestChainDepositAdminOnlyGating(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	customer := chainDepositTestUser(t, db, "chain_customer", common.RoleCommonUser)
	admin := chainDepositTestUser(t, db, "chain_admin2", common.RoleAdminUser)

	assert.False(t, canUseChainDeposit(common.RoleCommonUser))
	assert.True(t, canUseChainDeposit(common.RoleAdminUser))
	assert.True(t, canUseChainDeposit(common.RoleRootUser))

	body := callChainDeposit(RequestChainDepositAddress, customer, "/api/user/chain-deposit/address")
	assert.NotEqual(t, true, body["success"])
	body = callChainDeposit(RequestChainDepositCheck, customer, "/api/user/chain-deposit/check")
	assert.NotEqual(t, true, body["success"])
	stub.mu.Lock()
	assert.Empty(t, stub.requests, "a refused caller never reaches the service")
	stub.mu.Unlock()

	setting.ChainDepositAdminOnly = false
	assert.True(t, canUseChainDeposit(common.RoleCommonUser))
	body = callChainDeposit(RequestChainDepositAddress, customer, "/api/user/chain-deposit/address")
	assert.Equal(t, true, body["success"], "%v", body)

	setting.ChainDepositEnabled = false
	assert.False(t, canUseChainDeposit(common.RoleRootUser), "off means off for everyone")
	body = callChainDeposit(RequestChainDepositAddress, admin, "/api/user/chain-deposit/address")
	assert.NotEqual(t, true, body["success"])
	// Crediting does not depend on the switch.
	stub.setItems(chainTotal(1, customer.Id, "bsc", "USDT", 18, "2000000000000000000"))
	require.NoError(t, RunChainDepositPass(context.Background()))
	assert.Equal(t, 2*500000, chainDepositQuota(t, db, customer.Id))

	setting.ChainDepositEnabled = true
	setting.ChainDepositHmacSecret = ""
	assert.False(t, canUseChainDeposit(common.RoleRootUser), "no secret, no method")
}

func TestChainDepositCheckRunsOnePassToCreditWhatItFound(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	admin := chainDepositTestUser(t, db, "chain_check_pass", common.RoleAdminUser)
	stub.setItems(chainTotal(1, admin.Id, "bsc", "USDT", 18, "3000000000000000000"))
	require.Zero(t, chainDepositQuota(t, db, admin.Id))

	body := callChainDeposit(RequestChainDepositCheck, admin, "/api/user/chain-deposit/check")
	require.Equal(t, true, body["success"], "%v", body)
	assert.Equal(t, 3*500000, chainDepositQuota(t, db, admin.Id))
}

func TestChainDepositCheckMapsServiceRefusals(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	admin := chainDepositTestUser(t, db, "chain_check", common.RoleAdminUser)
	for code, want := range map[int]string{http.StatusNotFound: "No deposit address yet", http.StatusTooManyRequests: "Checked a moment ago"} {
		stub.mu.Lock()
		stub.checkCode = code
		stub.mu.Unlock()
		body := callChainDeposit(RequestChainDepositCheck, admin, "/api/user/chain-deposit/check")
		assert.NotEqual(t, true, body["success"])
		assert.Contains(t, body["data"], want)
	}
}

func TestChainDepositQuoteIsTheLeastTransferThatKeepsTheTier(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	admin := chainDepositTestUser(t, db, "chain_quote", common.RoleAdminUser)
	customer := chainDepositTestUser(t, db, "chain_quote_customer", common.RoleCommonUser)
	// Production's values on 2026-11-20.
	common.QuotaPerUnit = 500000
	operation_setting.Price = 1
	operation_setting.USDExchangeRate = 6.8
	operation_setting.GetPaymentSetting().AmountBonus = map[int]float64{300: 0.03, 1000: 0.05, 5000: 0.07, 10000: 0.1}

	quote := func(amount int64) *ChainDepositQuote {
		q, err := chainDepositQuote(amount)
		require.NoError(t, err)
		return q
	}
	// 5000 / 6.8 = 735.294…: 735.29 credits 4999.97, below the 7% tier.
	q := quote(5000)
	assert.Equal(t, 5000.0, q.Money, "Price 1: CNY equals the amount")
	assert.Equal(t, "735.30", q.USD)
	assert.Equal(t, "735.30", q.BonusUSD)
	assert.Equal(t, 0.07, q.BonusRate)
	assert.Equal(t, 0.05, q.LowerRate)
	// 2000 is in the 1000 tier: any transfer from 1000's price keeps 5%.
	q = quote(2000)
	assert.Equal(t, "294.12", q.USD)
	assert.Equal(t, "147.06", q.BonusUSD)
	assert.Equal(t, 0.05, q.BonusRate)
	assert.Equal(t, 0.03, q.LowerRate)
	q = quote(300)
	assert.Equal(t, 0.03, q.BonusRate)
	assert.Equal(t, 0.0, q.LowerRate)
	q = quote(100)
	assert.Equal(t, "14.71", q.USD)
	assert.Zero(t, q.BonusRate)
	assert.Empty(t, q.BonusUSD)

	// The quote agrees with crediting: its transfer reaches the amount and
	// its tier, and a cent less does not.
	for _, amount := range []int64{10, 50, 300, 999, 1000, 5000, 10000, 123457} {
		q := quote(amount)
		usd := decimal.RequireFromString(q.USD)
		price, err := chainDepositPrice(usd)
		require.NoError(t, err)
		assert.GreaterOrEqual(t, price.Quota, int(amount)*500000-1, "amount %d", amount)
		assert.Equal(t, int64(math.Floor(float64(price.Quota)*operation_setting.TopUpBonusRate(amount))), price.BonusQuota, "amount %d", amount)
		centLess := usd.Sub(decimal.New(1, -2)).Mul(decimal.NewFromFloat(6.8))
		assert.Less(t, chainDepositTierAmount(centLess).Floor().IntPart(), amount, "amount %d: a cent less still reaches it", amount)
	}

	call := func(user *model.User, body string) map[string]any {
		gin.SetMode(gin.TestMode)
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/chain-deposit/quote", strings.NewReader(body))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Set("id", user.Id)
		ctx.Set("role", user.Role)
		RequestChainDepositQuote(ctx)
		var out map[string]any
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &out))
		return out
	}
	body := call(admin, `{"amount":5000}`)
	require.Equal(t, true, body["success"], "%v", body)
	assert.Equal(t, "735.30", body["data"].(map[string]any)["usd"])
	for _, bad := range []string{`{"amount":0}`, `{"amount":-5}`, `{"amount":1000000001}`, `{}`, `nope`} {
		assert.NotEqual(t, true, call(admin, bad)["success"], bad)
	}
	assert.NotEqual(t, true, call(customer, `{"amount":5000}`)["success"], "admin only")
	stub.mu.Lock()
	assert.Empty(t, stub.requests, "a quote never calls the deposit service")
	stub.mu.Unlock()
}

func (s *chainDepositStub) setActivity(transfers []map[string]any, totals ...map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.transfers, s.totals = transfers, totals
}

func chainTransfer(hash string, token string, decimals int, amount string, confirmed bool) map[string]any {
	network := "bsc"
	if token == "USDT0" {
		network = "arbitrum"
	}
	return map[string]any{"network": network, "token": token, "decimals": decimals, "amount": amount,
		"tx_hash": hash, "seen_at": 1, "confirmed": confirmed}
}

func chainDepositStagesOf(t *testing.T, user *model.User) []map[string]any {
	t.Helper()
	body := callChainDeposit(RequestChainDepositActivity, user, "/api/user/chain-deposit/activity")
	require.Equal(t, true, body["success"], "%v", body)
	var out []map[string]any
	for _, item := range body["data"].(map[string]any)["transfers"].([]any) {
		out = append(out, item.(map[string]any))
	}
	return out
}

func TestChainDepositActivityFollowsATransferToItsCredit(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_activity", common.RoleAdminUser)
	first := "0x" + strings.Repeat("ab", 32)
	second := "0x" + strings.Repeat("cd", 32)

	// Seen, not yet read at its block.
	stub.setActivity([]map[string]any{chainTransfer(first, "USDT", 18, "12500000000000000000", false)})
	stages := chainDepositStagesOf(t, user)
	require.Len(t, stages, 1)
	assert.Equal(t, "confirming", stages[0]["stage"])
	assert.Equal(t, "12.5", stages[0]["amount"])
	assert.Equal(t, "BNB Smart Chain", stages[0]["network_name"])
	assert.Empty(t, chainDepositTopUps(t, db, user.Id))

	// Confirmed: asking for the activity credits it without waiting for the
	// scheduled pass, and answers the credit.
	total := chainTotal(1, user.Id, "bsc", "USDT", 18, "12500000000000000000")
	stub.setItems(total)
	stub.setActivity([]map[string]any{chainTransfer(first, "USDT", 18, "12500000000000000000", true)}, total["total"].(map[string]any))
	stages = chainDepositStagesOf(t, user)
	require.Len(t, stages, 1)
	assert.Equal(t, "credited", stages[0]["stage"])
	// 12.5 dollars are 87.5 money at rate 7, 12.5 units at price 7, with
	// the 20% tier at 10.
	assert.InDelta(t, 12.5, stages[0]["credited"], 0.001)
	assert.InDelta(t, 2.5, stages[0]["bonus"], 0.001)
	require.Len(t, chainDepositTopUps(t, db, user.Id), 1)

	// Half a dollar more waits for more; the first transfer stays credited.
	stub.setActivity([]map[string]any{
		chainTransfer(second, "USDT", 18, "500000000000000000", true),
		chainTransfer(first, "USDT", 18, "12500000000000000000", true),
	}, chainTotal(2, user.Id, "bsc", "USDT", 18, "13000000000000000000")["total"].(map[string]any))
	stages = chainDepositStagesOf(t, user)
	require.Len(t, stages, 2)
	assert.Equal(t, "waiting", stages[0]["stage"])
	assert.Equal(t, "credited", stages[1]["stage"])
	// The first transfer's point is 13 less the half dollar after it, where
	// the credit ended: it keeps showing that credit.
	assert.InDelta(t, 12.5, stages[1]["credited"], 0.001)
	assert.Nil(t, stages[0]["credited"])
}

func TestChainDepositActivityShowsCreditingWhenThePassCannotCredit(t *testing.T) {
	stub, _, db := setupChainDeposit(t)
	user := chainDepositTestUser(t, db, "chain_crediting", common.RoleAdminUser)
	pass := chainDepositActivityPass
	chainDepositActivityPass = func(context.Context) error { return nil }
	t.Cleanup(func() { chainDepositActivityPass = pass })

	stub.setActivity([]map[string]any{chainTransfer("0x"+strings.Repeat("ab", 32), "USDT0", 6, "3250000", true)},
		chainTotal(1, user.Id, "arbitrum", "USDT0", 6, "3250000")["total"].(map[string]any))
	stages := chainDepositStagesOf(t, user)
	require.Len(t, stages, 1)
	assert.Equal(t, "crediting", stages[0]["stage"])
	assert.Equal(t, "USDT", stages[0]["token"])
	assert.Equal(t, "3.25", stages[0]["amount"])
}
