package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v81"
)

// farmedCardShape replays the account of 2026-11-13: signed up and paid 35
// card top-ups (¥8,492.90) within five hours, 20 of them inside two hours,
// from 30 different cards, with declines and Stripe card-testing blocks.
func farmedCardShape(userId int, customer string, signup int64) ([]*model.TopUp, []topupWatchCharge) {
	var topUps []*model.TopUp
	var charges []topupWatchCharge
	total := 0.0
	for i := range 35 {
		at := signup + 60 + int64(i)*360 // 20 within the first two hours
		money := 242.65
		if i == 34 {
			money = 8492.90 - total
		}
		total += money
		topUps = append(topUps, &model.TopUp{UserId: userId, Money: money, CreateTime: at, Status: common.TopUpStatusSuccess, PaymentMethod: model.PaymentMethodStripeCard})
		charges = append(charges, topupWatchCharge{ID: fmt.Sprintf("ch_ok_%d", i), Customer: customer, Created: at, Fingerprint: fmt.Sprintf("fp_%d", i%30), Issuer: "UQPAY PTE. LTD.", Country: "SG"})
	}
	for i := range 8 {
		at := signup + 600 + int64(i)*300
		charges = append(charges, topupWatchCharge{ID: fmt.Sprintf("ch_bad_%d", i), Customer: customer, Created: at, Failed: true, Blocked: i < 4, Fingerprint: fmt.Sprintf("fp_%d", i)})
	}
	return topUps, charges
}

func TestTopupWatchRules(t *testing.T) {
	defaults := *operation_setting.GetTopupWatchSetting()
	now := int64(1_800_000_000)
	old := now - 30*24*3600

	legitUsers := []*model.User{
		{Id: 1, Username: "steady", CreatedAt: old, StripeCustomer: "cus_1", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
		{Id: 2, Username: "newcomer", CreatedAt: now - 3*3600, StripeCustomer: "cus_2", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
		{Id: 3, Username: "big", CreatedAt: old, StripeCustomer: "cus_3", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
		{Id: 4, Username: "retry", CreatedAt: old, StripeCustomer: "cus_4", Status: common.UserStatusEnabled, Role: common.RoleCommonUser},
	}
	card := func(user int, at int64, fingerprint string, failed bool) topupWatchCharge {
		return topupWatchCharge{Customer: fmt.Sprintf("cus_%d", user), Created: at, Fingerprint: fingerprint, Failed: failed}
	}
	topUp := func(user int, at int64, money float64) *model.TopUp {
		return &model.TopUp{UserId: user, Money: money, CreateTime: at}
	}
	// The busiest paying customers up to 2026-11-13: 2 top-ups in two hours,
	// 5 and ¥2,000 in a day, a new account paying ¥1,100, a declined card
	// followed by another.
	legit := topupWatchData{Now: now, StripeRead: true, Users: legitUsers,
		TopUps: []*model.TopUp{
			topUp(1, now-20*3600, 200), topUp(1, now-19*3600, 200), topUp(1, now-10*3600, 100), topUp(1, now-3600, 200), topUp(1, now-1800, 300),
			topUp(2, now-2*3600, 1000), topUp(2, now-3600, 100),
			topUp(3, now-5*3600, 2000),
			topUp(4, now-600, 300),
		},
		Charges: []topupWatchCharge{
			card(1, now-20*3600, "a", false), card(1, now-3600, "a", false),
			card(2, now-2*3600, "b", false),
			card(3, now-5*3600, "c", false),
			card(4, now-700, "d1", true), card(4, now-600, "d2", false),
		},
	}
	assert.Empty(t, evaluateTopupWatch(defaults, legit), "the busiest real customers raise nothing")

	signup := now - 5*3600 - 600
	farmer := &model.User{Id: 3529, Username: "farmer", CreatedAt: signup, StripeCustomer: "cus_farm", Status: common.UserStatusEnabled, Role: common.RoleCommonUser}
	topUps, charges := farmedCardShape(3529, "cus_farm", signup)
	farmed := topupWatchData{Now: now, StripeRead: true, Users: []*model.User{farmer}, TopUps: topUps, Charges: charges}

	findings := evaluateTopupWatch(defaults, farmed)
	require.Len(t, findings, 1)
	assert.Equal(t, []string{"burst", "daily", "new_account", "failed", "blocked", "cards"}, findings[0].Rules)
	assert.Equal(t, 35, findings[0].Count)
	assert.InDelta(t, 8492.90, findings[0].Amount, 0.001)
	assert.Len(t, findings[0].Cards, 30)
	assert.True(t, findings[0].Freeze, "many cards and a large sum freeze the account")

	cases := map[string]func(*operation_setting.TopupWatchSetting, *topupWatchData){
		"allowlisted": func(s *operation_setting.TopupWatchSetting, _ *topupWatchData) { s.Allowlist = "12, 3529" },
		"observe mode": func(s *operation_setting.TopupWatchSetting, _ *topupWatchData) {
			s.Mode = operation_setting.TopupWatchModeObserve
		},
		"administrator": func(_ *operation_setting.TopupWatchSetting, d *topupWatchData) {
			d.Users = []*model.User{{Id: 3529, CreatedAt: signup, StripeCustomer: "cus_farm", Status: common.UserStatusEnabled, Role: common.RoleAdminUser}}
		},
		"below the freeze amount": func(s *operation_setting.TopupWatchSetting, _ *topupWatchData) { s.FreezeAmount = 9000 },
		"Stripe unread":           func(_ *operation_setting.TopupWatchSetting, d *topupWatchData) { d.StripeRead = false },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			setting, data := defaults, farmed
			change(&setting, &data)
			findings := evaluateTopupWatch(setting, data)
			require.Len(t, findings, 1, "the account is still reported")
			assert.False(t, findings[0].Freeze)
		})
	}
}

func TestRunTopupWatchFreezesAndAlertsOnce(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useViolationTestDB(t, dialect)
			for _, table := range []any{&model.TopUp{}, &model.AuditLog{}} {
				require.NoError(t, model.DB.AutoMigrate(table))
				t.Cleanup(func() { require.NoError(t, model.DB.Migrator().DropTable(table)) })
			}
			now := common.GetTimestamp()
			signup := now - 5*3600 - 600
			for _, user := range []*model.User{
				{Id: 3529, Username: "farmer", StripeCustomer: "cus_farm"},
				{Id: 3530, Username: "trusted", StripeCustomer: "cus_trusted"},
			} {
				user.AffCode, user.Password, user.Group = fmt.Sprintf("tw%d", user.Id), "unused", "default"
				user.Role, user.Status = common.RoleCommonUser, common.UserStatusEnabled
				require.NoError(t, model.DB.Create(user).Error)
				require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("created_at", signup).Error)
			}
			var chargeJSON []string
			for _, shape := range []struct {
				id       int
				customer string
			}{{3529, "cus_farm"}, {3530, "cus_trusted"}} {
				topUps, charges := farmedCardShape(shape.id, shape.customer, signup)
				for i, topUp := range topUps {
					topUp.TradeNo = fmt.Sprintf("tw-%d-%d", shape.id, i)
					require.NoError(t, model.DB.Create(topUp).Error)
				}
				for _, charge := range charges {
					status, outcome := "succeeded", "authorized"
					if charge.Failed {
						status, outcome = "failed", "issuer_declined"
					}
					if charge.Blocked {
						outcome = "blocked"
					}
					chargeJSON = append(chargeJSON, fmt.Sprintf(`{"id":%q,"object":"charge","amount":28000,"currency":"hkd","created":%d,"customer":%q,"status":%q,"outcome":{"type":%q},"payment_method_details":{"type":"card","card":{"fingerprint":%q,"country":"SG"}}}`,
						charge.ID, charge.Created, charge.Customer, status, outcome, charge.Fingerprint))
				}
			}
			stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data := ""
				if r.URL.Path == "/v1/charges" {
					data = strings.Join(chargeJSON, ",")
				}
				_, _ = fmt.Fprintf(w, `{"object":"list","has_more":false,"url":%q,"data":[%s]}`, r.URL.Path, data)
			}))
			t.Cleanup(stub.Close)
			stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{URL: stripe.String(stub.URL)}))
			t.Cleanup(func() { stripe.SetBackend(stripe.APIBackend, nil) })

			var sent []string
			previousSend := sendTopupWatchFeishu
			sendTopupWatchFeishu = func(_ string, _ string, text string) error { sent = append(sent, text); return nil }
			t.Cleanup(func() { sendTopupWatchFeishu = previousSend })
			setting := operation_setting.GetTopupWatchSetting()
			previousSetting := *setting
			setting.Enabled, setting.StripeApiKey, setting.Allowlist = true, "rk_test_watch", "3530"
			setting.FeishuWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/test"
			t.Cleanup(func() { *setting = previousSetting })

			first, err := RunTopupWatch(context.Background(), now, nil)
			require.NoError(t, err)
			assert.Empty(t, first.Errors)
			assert.Equal(t, []int{3529}, first.Frozen)
			require.Len(t, sent, 2, "one alert per account")
			assert.Contains(t, sent[0], "账户已自动冻结")
			assert.Contains(t, sent[0], "30 张")
			assert.Contains(t, sent[1], "#3530")
			assert.NotContains(t, sent[1], "已自动冻结")

			statuses := map[int]int{}
			var users []model.User
			require.NoError(t, model.DB.Select("id", "status").Find(&users).Error)
			for _, user := range users {
				statuses[user.Id] = user.Status
			}
			assert.Equal(t, common.UserStatusDisabled, statuses[3529])
			assert.Equal(t, common.UserStatusEnabled, statuses[3530], "an allowlisted account is never disabled")
			var audits []model.AuditLog
			require.NoError(t, model.DB.Find(&audits).Error)
			require.Len(t, audits, 1)
			assert.Equal(t, "user.manage", audits[0].Action)
			assert.Equal(t, "topup_watch", audits[0].Other.AdminInfo.AdminUsername)

			second, err := RunTopupWatch(context.Background(), now+600, first.Alerted)
			require.NoError(t, err)
			assert.Empty(t, second.Frozen)
			assert.Len(t, sent, 2, "the next run repeats nothing")
			assert.Equal(t, 2, second.Findings)
		})
	}
}

// Restricted keys get no card fingerprint, so a card farm must still count as
// many cards from brand, last four digits and expiry.
func TestTopupWatchChargeIdentityWithoutFingerprint(t *testing.T) {
	card := func(last4 string, month, year int64) *stripe.Charge {
		return &stripe.Charge{ID: "ch_" + last4, PaymentMethodDetails: &stripe.ChargePaymentMethodDetails{
			Card: &stripe.ChargePaymentMethodDetailsCard{Brand: "visa", Last4: last4, ExpMonth: month, ExpYear: year},
		}}
	}
	a := topupWatchChargeFrom(card("6835", 2, 2031))
	b := topupWatchChargeFrom(card("7787", 2, 2031))
	c := topupWatchChargeFrom(card("6835", 6, 2030))
	again := topupWatchChargeFrom(card("6835", 2, 2031))
	require.NotEmpty(t, a.Fingerprint)
	require.Equal(t, a.Fingerprint, again.Fingerprint)
	require.NotEqual(t, a.Fingerprint, b.Fingerprint)
	require.NotEqual(t, a.Fingerprint, c.Fingerprint)

	withPrint := &stripe.Charge{PaymentMethodDetails: &stripe.ChargePaymentMethodDetails{
		Card: &stripe.ChargePaymentMethodDetailsCard{Fingerprint: "fp_real", Last4: "6835", ExpMonth: 2, ExpYear: 2031},
	}}
	require.Equal(t, "fp_real", topupWatchChargeFrom(withPrint).Fingerprint)
}
