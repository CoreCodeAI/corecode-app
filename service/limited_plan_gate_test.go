package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const gateFarmAddress = "117.150.5.21"

type gateWorld struct {
	newcomer *model.SubscriptionPlan
	monthly  *model.SubscriptionPlan
}

// newGateWorld seeds the plans and the gate's setting: the newcomer plan is
// limited per user and the monthly plan is not.
func newGateWorld(t *testing.T) *gateWorld {
	t.Helper()
	truncate(t)
	model.ResetLimitedPlanGateCache()
	previous := *operation_setting.GetLimitedPlanUseSetting()
	*operation_setting.GetLimitedPlanUseSetting() = operation_setting.LimitedPlanUseSetting{Enabled: true, Threshold: 3}
	w := &gateWorld{
		newcomer: &model.SubscriptionPlan{Title: "newcomer", DurationUnit: model.SubscriptionDurationDay, DurationValue: 7, Enabled: true, MaxPurchasePerUser: 1},
		monthly:  &model.SubscriptionPlan{Title: "monthly", DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, Enabled: true},
	}
	for _, plan := range []*model.SubscriptionPlan{w.newcomer, w.monthly} {
		require.NoError(t, model.DB.Create(plan).Error)
		model.InvalidateSubscriptionPlanCache(plan.Id)
	}
	t.Cleanup(func() {
		*operation_setting.GetLimitedPlanUseSetting() = previous
		model.ResetLimitedPlanGateCache()
		for _, table := range []string{"subscription_plans", "subscription_pre_consume_records", "subscription_address_exemptions", "user_sessions", "subscription_orders"} {
			model.DB.Exec("DELETE FROM " + table)
		}
		model.InvalidateSubscriptionPlanCache(w.newcomer.Id)
		model.InvalidateSubscriptionPlanCache(w.monthly.Id)
	})
	return w
}

var gateUserSeq int

func (w *gateWorld) user(t *testing.T, quota int) *model.User {
	t.Helper()
	gateUserSeq++
	user := &model.User{Id: 1000 + gateUserSeq, Username: fmt.Sprintf("gate_user_%d", gateUserSeq), AffCode: fmt.Sprintf("gate%d", gateUserSeq), Quota: quota, Status: common.UserStatusEnabled}
	require.NoError(t, model.DB.Create(user).Error)
	return user
}

func (w *gateWorld) hold(t *testing.T, user *model.User, plan *model.SubscriptionPlan, source string, total int64) *model.UserSubscription {
	t.Helper()
	now := time.Now().Unix()
	sub := &model.UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", Source: source, AllowWalletOverflow: true,
		AmountTotal: total, StartTime: now - 60, EndTime: now + 86400, CreatedAt: now - 60, UpdatedAt: now - 60}
	require.NoError(t, model.DB.Create(sub).Error)
	return sub
}

func (w *gateWorld) request(t *testing.T, user *model.User, ip string) {
	t.Helper()
	require.NoError(t, model.LOG_DB.Create(&model.Log{UserId: user.Id, CreatedAt: time.Now().Unix() - 60, Type: model.LogTypeConsume, Ip: ip}).Error)
}

// farm gives count other accounts the newcomer plan and one request from ip each.
func (w *gateWorld) farm(t *testing.T, count int, ip string) {
	t.Helper()
	for i := 0; i < count; i++ {
		other := w.user(t, 0)
		w.hold(t, other, w.newcomer, "order", 1_000_000)
		w.request(t, other, ip)
	}
}

func gateBill(t *testing.T, user *model.User, ip string, pre int, preference string) (*BillingSession, *types.NewAPIError, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	c.Request.RemoteAddr = ip + ":4000"
	c.Set(string(constant.ContextKeyLanguage), "zh-CN")
	info := &relaycommon.RelayInfo{UserId: user.Id, RequestId: fmt.Sprintf("gate-req-%d-%d", user.Id, time.Now().UnixNano()),
		OriginModelName: "claude-sonnet-5-5", IsPlayground: true}
	info.UserSetting.BillingPreference = preference
	session, apiErr := NewBillingSession(c, info, pre)
	return session, apiErr, info
}

func subscriptionUsed(t *testing.T, id int) int64 {
	t.Helper()
	var sub model.UserSubscription
	require.NoError(t, model.DB.First(&sub, id).Error)
	return sub.AmountUsed
}

func walletOf(t *testing.T, id int) int {
	t.Helper()
	quota, err := model.GetUserQuota(id, false)
	require.NoError(t, err)
	return quota
}

func TestNewcomerPlanBelowTheThresholdChargesThePlan(t *testing.T) {
	w := newGateWorld(t)
	user := w.user(t, 500_000)
	sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
	w.request(t, user, gateFarmAddress)
	w.farm(t, 2, gateFarmAddress)

	session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
	assert.Equal(t, 500_000, walletOf(t, user.Id))
	assert.Empty(t, info.LimitedPlanGate)
}

func TestNewcomerPlanAboveTheThresholdChargesTheWallet(t *testing.T) {
	for _, preference := range []string{"subscription_first", "subscription_only", "wallet_first", "wallet_only"} {
		t.Run(preference, func(t *testing.T) {
			w := newGateWorld(t)
			user := w.user(t, 500_000)
			sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
			w.request(t, user, gateFarmAddress)
			w.farm(t, 3, gateFarmAddress)

			session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, preference)
			require.Nil(t, apiErr)
			assert.Equal(t, BillingSourceWallet, session.funding.Source())
			assert.Zero(t, subscriptionUsed(t, sub.Id), "the plan is not charged")
			assert.Equal(t, 490_000, walletOf(t, user.Id), "the wallet is")
			assert.Equal(t, model.LimitedPlanGateWallet, info.LimitedPlanGate)
			assert.Equal(t, 3, info.LimitedPlanGateHolders)
		})
	}
}

func TestNewcomerPlanAboveTheThresholdWithAnEmptyWalletIsRefused(t *testing.T) {
	w := newGateWorld(t)
	user := w.user(t, 0)
	sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
	w.request(t, user, gateFarmAddress)
	w.farm(t, 3, gateFarmAddress)

	for _, preference := range []string{"subscription_first", "wallet_first", "subscription_only"} {
		session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, preference)
		require.NotNil(t, apiErr, preference)
		assert.Nil(t, session)
		assert.Equal(t, http.StatusForbidden, apiErr.StatusCode, "the status of any other lack of balance, not a 5xx")
		assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
		assert.Equal(t, "新人包每人限一份；你所在网络已有多个账号使用过，本次请求无法使用新人包额度。请正常充值，或联系客服。", apiErr.Error())
		assert.True(t, types.IsSkipRetryError(apiErr), "another channel would not help")
		assert.True(t, types.IsRecordErrorLog(apiErr), "an administrator can see why")
		assert.Equal(t, model.LimitedPlanGateRefused, info.LimitedPlanGate)
	}
	assert.Zero(t, subscriptionUsed(t, sub.Id))
}

func TestNewcomerPlanGateLeavesOtherSubscriptionsAlone(t *testing.T) {
	w := newGateWorld(t)
	user := w.user(t, 0)
	gifted := w.hold(t, user, w.newcomer, "order", 1_000_000)
	paid := w.hold(t, user, w.monthly, "order", 1_000_000)
	w.request(t, user, gateFarmAddress)
	w.farm(t, 3, gateFarmAddress)

	session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, int64(10_000), subscriptionUsed(t, paid.Id), "the monthly plan pays")
	assert.Zero(t, subscriptionUsed(t, gifted.Id), "the newcomer plan sits out, though it ends first")
	assert.Equal(t, model.LimitedPlanGateOtherPlan, info.LimitedPlanGate)
}

func TestNewcomerPlanGateSparesExemptAccountsAndSharedExits(t *testing.T) {
	t.Run("exempt", func(t *testing.T) {
		w := newGateWorld(t)
		user := w.user(t, 0)
		sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
		w.request(t, user, gateFarmAddress)
		w.farm(t, 5, gateFarmAddress)
		require.NoError(t, model.SetSubscriptionAddressExemption(user.Id, true, 1))

		session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, "subscription_first")
		require.Nil(t, apiErr)
		assert.Equal(t, BillingSourceSubscription, session.funding.Source())
		assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
		assert.Empty(t, info.LimitedPlanGate)
	})
	t.Run("shared exit", func(t *testing.T) {
		w := newGateWorld(t)
		user := w.user(t, 0)
		sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
		w.request(t, user, "203.0.113.9")
		w.farm(t, 4, "203.0.113.9")
		for i := 0; i < 6; i++ {
			w.request(t, w.user(t, 0), "203.0.113.9")
		}

		session, apiErr, _ := gateBill(t, user, "203.0.113.9", 10_000, "subscription_first")
		require.Nil(t, apiErr)
		assert.Equal(t, BillingSourceSubscription, session.funding.Source())
		assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
	})
}

func TestNewcomerPlanGateSwitchedOffKeepsTheOldBehaviour(t *testing.T) {
	w := newGateWorld(t)
	operation_setting.GetLimitedPlanUseSetting().Enabled = false
	user := w.user(t, 0)
	sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
	w.request(t, user, gateFarmAddress)
	w.farm(t, 10, gateFarmAddress)

	session, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
	assert.Empty(t, info.LimitedPlanGate)
}

func TestNewcomerPlanGateMarksTheLogs(t *testing.T) {
	w := newGateWorld(t)
	user := w.user(t, 500_000)
	w.hold(t, user, w.newcomer, "order", 1_000_000)
	w.request(t, user, gateFarmAddress)
	w.farm(t, 3, gateFarmAddress)
	_, apiErr, info := gateBill(t, user, gateFarmAddress, 10_000, "subscription_first")
	require.Nil(t, apiErr)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	other := model.NewLogOther()
	AppendRelayLogAdminInfo(c, info, other)
	appendBillingInfo(info, other)

	logged := other.Snapshot()
	adminInfo, ok := logged["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "wallet", adminInfo["limited_plan_ip_gate"])
	assert.EqualValues(t, 3, adminInfo["limited_plan_ip_gate_holders"])
	assert.Equal(t, model.LimitedPlanScopeAddress, adminInfo["limited_plan_ip_gate_scope"])
	assert.Equal(t, "wallet", logged["limited_plan_gate"], "the customer's log says why the plan did not pay")
	assert.NotContains(t, logged, "limited_plan_ip_gate_holders", "the count is for administrators")
	assert.NotContains(t, logged, "limited_plan_ip_gate_scope", "the scope is for administrators")
	assert.NotContains(t, adminInfo, "limited_plan_ip_gate_exit", "a gated address is no exit")
}

// A holder behind a listed proxy block keeps the plan, and the log says the
// block, not the customer, was spared.
func TestNewcomerPlanGateSparesAListedExit(t *testing.T) {
	w := newGateWorld(t)
	setting := operation_setting.GetLimitedPlanUseSetting()
	setting.NetworkEnabled, setting.NetworkThreshold = true, 4
	user := w.user(t, 500_000)
	sub := w.hold(t, user, w.newcomer, "order", 1_000_000)
	w.request(t, user, "185.220.236.155")
	for i := 0; i < 5; i++ {
		other := w.user(t, 0)
		w.hold(t, other, w.newcomer, "order", 1_000_000)
		w.request(t, other, fmt.Sprintf("185.220.236.%d", 160+i))
	}

	gated, apiErr, info := gateBill(t, user, "185.220.236.155", 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceWallet, gated.funding.Source(), "unlisted, the studio's block gates the newcomer")
	assert.Equal(t, model.LimitedPlanScopeNetwork, info.LimitedPlanGateScope)

	setting.SharedExitNetworks = "185.220.236.0/24"
	model.ResetLimitedPlanGateCache()
	session, apiErr, info := gateBill(t, user, "185.220.236.155", 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Equal(t, BillingSourceSubscription, session.funding.Source())
	assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
	assert.Empty(t, info.LimitedPlanGate)
	assert.Equal(t, model.LimitedPlanExitListed, info.LimitedPlanGateExit)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	other := model.NewLogOther()
	AppendRelayLogAdminInfo(c, info, other)
	logged := other.Snapshot()
	adminInfo, ok := logged["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "listed", adminInfo["limited_plan_ip_gate_exit"])
	assert.NotContains(t, adminInfo, "limited_plan_ip_gate")
	assert.NotContains(t, logged, "limited_plan_ip_gate_exit", "the reason is for administrators")
}

// A studio that rotates through a block of addresses is gated by the network,
// and the account that moved to a clean address stays gated.
func TestNewcomerPlanGateFollowsTheNetworkAndTheAccount(t *testing.T) {
	w := newGateWorld(t)
	setting := operation_setting.GetLimitedPlanUseSetting()
	setting.NetworkEnabled, setting.NetworkThreshold, setting.StickyDays = true, 4, 7
	users := []*model.User{}
	for i := 0; i < 5; i++ {
		user := w.user(t, 0)
		w.hold(t, user, w.newcomer, "order", 1_000_000)
		w.request(t, user, fmt.Sprintf("103.135.100.%d", 180+i))
		users = append(users, user)
	}

	// Each used its own address of the block, which carries four others.
	_, apiErr, info := gateBill(t, users[0], "103.135.100.185", 10_000, "subscription_first")
	require.NotNil(t, apiErr, "no wallet to pay with")
	assert.Equal(t, model.LimitedPlanGateRefused, info.LimitedPlanGate)
	assert.Equal(t, model.LimitedPlanScopeNetwork, info.LimitedPlanGateScope)

	// The account moved to an address nobody used and is still gated.
	_, apiErr, info = gateBill(t, users[0], "119.246.95.21", 10_000, "subscription_first")
	require.NotNil(t, apiErr)
	assert.Equal(t, model.LimitedPlanScopeSticky, info.LimitedPlanGateScope)

	// A customer with the plan and no history in the block is served.
	clean := w.user(t, 0)
	sub := w.hold(t, clean, w.newcomer, "order", 1_000_000)
	_, apiErr, info = gateBill(t, clean, "119.246.95.21", 10_000, "subscription_first")
	require.Nil(t, apiErr)
	assert.Empty(t, info.LimitedPlanGate)
	assert.Equal(t, int64(10_000), subscriptionUsed(t, sub.Id))
}

func TestNewcomerPlanGateRefusalIsTranslated(t *testing.T) {
	for lang, fragment := range map[string]string{"en": "limited to one per person", "zh-CN": "新人包每人限一份", "zh-TW": "新人包每人限一份"} {
		message := i18n.Translate(lang, i18n.MsgQuotaLimitedPlanGate, nil)
		assert.Contains(t, message, fragment, lang)
		assert.NotEqual(t, i18n.MsgQuotaLimitedPlanGate, message, "%s has the text, not the key", lang)
	}
}
