package model

import (
	"fmt"
	"maps"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// riskTestUser registers an account created at created, with fields set.
func riskTestUser(t *testing.T, name string, inviterCode string, created int64, fields map[string]any) *User {
	t.Helper()
	account := registerAffiliateTestUser(t, name, inviterCode)
	updates := map[string]any{"created_at": created}
	maps.Copy(updates, fields)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", account.Id).Updates(updates).Error)
	return account
}

// riskTestGrant writes a quota audit row that changed target from one value to
// another, as the admin quota actions do.
func riskTestGrant(t *testing.T, action string, target int, at int64, from, to int64, success bool) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&AuditLog{EventId: "grant-" + common.GetRandomString(16), UserId: 1, Username: "admin",
		CreatedAt: at, Category: "admin", Action: action, Success: success,
		Other: AuditOther{Op: &AuditOperation{Action: action, Params: AuditFields{"target_user_id": target, "from": from, "to": to}}}}).Error)
}

func TestUnpaidSpendSplitsBySource(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}
			old := day1 - 86400

			host := riskTestUser(t, "host", "", old, nil)
			granted := riskTestUser(t, "granted", host.AffCode, day1+100, nil)
			coded := riskTestUser(t, "coded", "", day1+100, nil)
			gifted := riskTestUser(t, "gifted", host.AffCode, day1+100, nil)
			buyer := riskTestUser(t, "buyer", "", day1+100, nil)
			late := riskTestUser(t, "late", "", day1+100, nil)

			// A grant of 10 made before the range counts; one made after the
			// range's end does not.
			riskTestGrant(t, "user.quota_add", granted.Id, old-5000, 0, 10*dollar, true)
			riskTestGrant(t, "user.quota_add", late.Id, r.End+100, 0, 10*dollar, true)
			require.NoError(t, DB.Create(&Redemption{Key: fmt.Sprintf("riskcode%024d", 1), Name: "promo", Quota: int(3 * dollar),
				UsedUserId: coded.Id, Status: common.RedemptionCodeStatusUsed, RedeemedTime: day1 + 500, CreatedTime: old}).Error)
			require.NoError(t, DB.Create(&Redemption{Key: fmt.Sprintf("riskcode%024d", 2), Name: "late", Quota: int(1 * dollar),
				UsedUserId: late.Id, Status: common.RedemptionCodeStatusUsed, RedeemedTime: r.End + 5, CreatedTime: old}).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: buyer.Id, PlanId: 1, Money: 29.9, TradeNo: "risk-buyer",
				Status: common.TopUpStatusSuccess, CreateTime: day1 + 200}).Error)

			// gifted spends 3: 2 from a gift plan and 1 from its wallet, the
			// overflow the log names.
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: granted.Id, Username: "granted", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(5 * dollar), Other: `{}`},
				{UserId: coded.Id, Username: "coded", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(4 * dollar), Other: `{}`},
				{UserId: gifted.Id, Username: "gifted", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(3 * dollar),
					Other: `{"billing_source":"subscription","subscription_gift":true,"billing_overflow_source":"wallet","billing_overflow_quota":` + strconv.FormatInt(dollar, 10) + `}`},
				{UserId: buyer.Id, Username: "buyer", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(4 * dollar), Other: `{}`},
				{UserId: late.Id, Username: "late", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(3 * dollar), Other: `{}`},
			}).Error)

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 5, risk.SignupSpenders, "the buyer spent too; it is left out of the unpaid list only")
			assert.EqualValues(t, 4, risk.UnpaidSpenders)
			assert.Equal(t, 15.0, risk.UnpaidSpendUSD)
			assert.Equal(t, 5.0, risk.UnpaidGrantedUSD, "the hand grant covers the wallet part of granted")
			assert.Equal(t, 3.0, risk.UnpaidRedeemedUSD, "a code redeemed after the range's end does not count")
			assert.Equal(t, 2.0, risk.UnpaidGiftPlanUSD)
			assert.Equal(t, 5.0, risk.UnpaidSignupGiftUSD, "the rest: 1 for gifted, 1 for coded, 3 for late")
			assert.EqualValues(t, 1, risk.UnpaidHandFunded)

			byName := make(map[string]UnpaidSpender)
			for _, row := range risk.UnpaidSpenderTop {
				byName[row.Username] = row
			}
			assert.NotContains(t, byName, "buyer")
			assert.Equal(t, UnpaidSpender{UserRef: UserRef{granted.Id, "granted"}, ConsumptionUSD: 5, GrantedUSD: 5,
				SignupMethod: "password", Inviter: UserRef{host.Id, "host"}, CreatedAt: day1 + 100}, byName["granted"])
			assert.Equal(t, UnpaidSpender{UserRef: UserRef{coded.Id, "coded"}, ConsumptionUSD: 4, RedeemedUSD: 3, SignupGiftUSD: 1,
				SignupMethod: "password", CreatedAt: day1 + 100}, byName["coded"])
			assert.Equal(t, UnpaidSpender{UserRef: UserRef{gifted.Id, "gifted"}, ConsumptionUSD: 3, GiftPlanUSD: 2, SignupGiftUSD: 1,
				SignupMethod: "password", Inviter: UserRef{host.Id, "host"}, CreatedAt: day1 + 100}, byName["gifted"])
			assert.Equal(t, UnpaidSpender{UserRef: UserRef{late.Id, "late"}, ConsumptionUSD: 3, SignupGiftUSD: 3,
				SignupMethod: "password", CreatedAt: day1 + 100}, byName["late"])

			// The inviter list is ranked by the gifted part of what its
			// invitees spent: granted's 5 is hand credit and does not count.
			assert.Equal(t, []InviterSpenders{{UserRef: UserRef{host.Id, "host"}, Accounts: 2, GiftAccounts: 1, ConsumptionUSD: 8, GiftUSD: 3}}, risk.UnpaidInviters)
		})
	}
}

func TestRiskLeavesStaffOut(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}
			old := day1 - 86400

			staffHost := riskTestUser(t, "staffhost", "", old, map[string]any{"role": common.RoleAdminUser})
			staffer := riskTestUser(t, "staffer", "", old, map[string]any{"role": common.RoleAdminUser, "email": "t.w.i.n@gmail.com"})
			first := riskTestUser(t, "first", "", day1+100, map[string]any{"email": "twin@gmail.com"})
			second := riskTestUser(t, "second", "", day1+200, nil)
			invitee := riskTestUser(t, "invitee", staffHost.AffCode, day1+400, nil)
			spender := riskTestUser(t, "spender", staffHost.AffCode, day1+500, nil)

			// Two customers and an administrator share one address; the
			// administrator and one customer share another, which therefore
			// has one customer and is no cluster.
			addressTestSession(t, first.Id, "10.6.6.6", day1+1000)
			addressTestSession(t, second.Id, "10.6.6.6", day1+1000)
			addressTestSession(t, staffer.Id, "10.6.6.6", day1+1000)
			addressTestSession(t, staffer.Id, "10.7.7.7", day1+1000)
			addressTestSession(t, first.Id, "10.7.7.7", day1+1000)

			gift := AffiliateSignupGift{UserId: invitee.Id, InviterId: staffHost.Id, Status: AffiliateSignupGiftIpUsed, Ip: "10.8.8.8"}
			require.NoError(t, DB.Create(&gift).Error)
			require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("id = ?", gift.Id).Update("created_at", day1+400).Error)

			require.NoError(t, LOG_DB.Create(&Log{UserId: spender.Id, Username: "spender", Type: LogTypeConsume, CreatedAt: day1 + 4000,
				ModelName: "opus", Quota: int(2 * dollar), Other: `{}`}).Error)

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 4, risk.Signups, "the two administrators were created before the range")
			assert.Empty(t, risk.AliasClusters, "an administrator's inbox is not another customer's")
			assert.EqualValues(t, 0, risk.AliasEmails)
			assert.Equal(t, 1, risk.SharedIPTotal, "the address that held one customer is no cluster")
			require.Len(t, risk.SharedIPs, 1)
			assert.Equal(t, "10.6.6.6", risk.SharedIPs[0].IP)
			require.Len(t, risk.SharedIPs[0].Users, 2)
			for _, user := range risk.SharedIPs[0].Users {
				assert.NotEqual(t, staffer.Id, user.UserID)
			}
			assert.Empty(t, risk.GiftBlockInviters, "an administrator's invitees are not a gift block")
			assert.Empty(t, risk.SignupGifts)
			assert.EqualValues(t, 1, risk.UnpaidSpenders)
			assert.Empty(t, risk.UnpaidInviters, "the spender's inviter is an administrator")
		})
	}
}

func TestSharedExitsAreListedRankedAndCapped(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}
			old := day1 - 86400

			limited := SubscriptionPlan{Title: "limited", PriceAmount: 29.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&limited).Error)
			// One proxy carries six accounts, one of which bought the limited
			// plan; the others carry five accounts that bought nothing. The
			// exit with a plan buyer ranks first.
			for i := range 6 {
				member := riskTestUser(t, fmt.Sprintf("buyerexit%d", i), "", old, nil)
				addressTestSession(t, member.Id, "10.20.0.1", day1+1000)
				if i == 0 {
					require.NoError(t, DB.Create(&UserSubscription{UserId: member.Id, PlanId: limited.Id, Status: "active", Source: "order",
						StartTime: day1 + 1000, EndTime: day1 + 8*86400, CreatedAt: day1 + 1000, UpdatedAt: day1 + 1000}).Error)
				}
			}
			// Twenty-one more exits, so the list is cut.
			for exit := range 21 {
				ip := fmt.Sprintf("10.21.%d.1", exit)
				for i := range 5 {
					member := riskTestUser(t, fmt.Sprintf("exit%d-%d", exit, i), "", old, nil)
					addressTestSession(t, member.Id, ip, day1+2000)
				}
			}

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.Equal(t, 22, risk.SharedExits, "the count is every exit")
			assert.Equal(t, 22, risk.SharedIPTotal)
			assert.Empty(t, risk.SharedIPs, "no review address in this range")
			require.Len(t, risk.SharedExitTop, riskSharedExitLimit)
			assert.Equal(t, "10.20.0.1", risk.SharedExitTop[0].IP)
			assert.Equal(t, 1, risk.SharedExitTop[0].SubscriptionBuyers)
			for _, exit := range risk.SharedExitTop {
				assert.True(t, exit.SharedExit)
			}
		})
	}
}

func TestHandGrantsReadAcrossPages(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			const target, other = 4242, 4243
			var rows []AuditLog
			for i := range handGrantPage + 3 {
				rows = append(rows, AuditLog{EventId: fmt.Sprintf("page-%d-%s", i, common.GetRandomString(8)), CreatedAt: day1 + 10,
					Category: "admin", Action: "user.quota_add", Success: true,
					Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{"target_user_id": target, "from": 0, "to": 1}}}})
			}
			rows = append(rows,
				AuditLog{EventId: "page-failed-" + common.GetRandomString(8), CreatedAt: day1 + 10, Category: "admin", Action: "user.quota_add",
					Success: false, Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{"target_user_id": target, "from": 0, "to": 1000}}}},
				AuditLog{EventId: "page-other-" + common.GetRandomString(8), CreatedAt: day1 + 10, Category: "admin", Action: "user.quota_add",
					Success: true, Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{"target_user_id": other, "from": 0, "to": 1000}}}})
			require.NoError(t, LOG_DB.CreateInBatches(&rows, 500).Error)

			granted, err := readHandGrants(day1+86400, []int{target})
			require.NoError(t, err)
			assert.Equal(t, map[int]int64{target: handGrantPage + 3}, granted,
				"every page is read, a failed row and another account's row are not")
		})
	}
}

func TestSplitUnpaidSpend(t *testing.T) {
	cases := []struct {
		name                                          string
		quota, gift, granted, redeemed                int64
		wantGranted, wantRedeemed, wantGift, wantRest int64
	}{
		{"all four sources", 10, 2, 3, 4, 3, 4, 2, 1},
		{"hand grant larger than the wallet part takes the wallet part", 10, 0, 20, 0, 10, 0, 0, 0},
		{"codes before the rest", 10, 0, 0, 30, 0, 10, 0, 0},
		{"gift plan is capped at the consumption", 5, 9, 0, 0, 0, 0, 5, 0},
		{"negative grant and code totals count as none", 6, 0, -4, -1, 0, 0, 0, 6},
		{"no gift", 7, 0, 0, 0, 0, 0, 0, 7},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitUnpaidSpend(tc.quota, tc.gift, tc.granted, tc.redeemed)
			assert.Equal(t, spendSources{granted: tc.wantGranted, redeemed: tc.wantRedeemed, giftPlan: tc.wantGift, signupGift: tc.wantRest}, got)
			assert.Equal(t, tc.quota, got.granted+got.redeemed+got.giftPlan+got.signupGift, "the parts sum to the consumption")
		})
	}
}

// A plan bought from the wallet is paid with credit, so a hand-funded account
// that bought one is still an unpaid spender.
func TestWalletBoughtPlanIsNotMoneyPaid(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 2*86400}
	funded := riskTestUser(t, "funded", "", day1+100, nil)
	riskTestGrant(t, "user.quota_add", funded.Id, day1-5000, 0, 10*dollar, true)
	require.NoError(t, DB.Create(&SubscriptionOrder{UserId: funded.Id, PlanId: 1, Money: 29.9, TradeNo: "risk-wallet",
		Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderBalance, CreateTime: day1 + 200}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: funded.Id, Username: "funded", Type: LogTypeConsume, CreatedAt: day1 + 4000,
		ModelName: "opus", Quota: int(6 * dollar), Other: `{}`}).Error)

	risk, err := GetRiskInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 1, risk.UnpaidSpenders)
	assert.Equal(t, 6.0, risk.UnpaidGrantedUSD)
}

// Check-in rewards credit the wallet, but they are not a sign-up gift, so an
// invitee who only spent check-in credit adds nothing to the inviter's gift.
func TestCheckinCreditIsNotAnInviterGift(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 2*86400}
	host := riskTestUser(t, "host", "", day1-86400, nil)
	checker := riskTestUser(t, "checker", host.AffCode, day1+100, nil)
	require.NoError(t, DB.Create(&Checkin{UserId: checker.Id, CheckinDate: "2025-10-01", QuotaAwarded: int(dollar), CreatedAt: day1 + 200}).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: checker.Id, Username: "checker", Type: LogTypeConsume, CreatedAt: day1 + 4000,
		ModelName: "opus", Quota: int(dollar), Other: `{}`}).Error)

	risk, err := GetRiskInsights(r)
	require.NoError(t, err)
	assert.Equal(t, 1.0, risk.UnpaidCheckinUSD)
	assert.Equal(t, 0.0, risk.UnpaidSignupGiftUSD)
	assert.Equal(t, []InviterSpenders{{UserRef: UserRef{host.Id, "host"}, Accounts: 1, ConsumptionUSD: 1, GiftUSD: 0}}, risk.UnpaidInviters)
}

// An hour cut by its row cap says so in the risk and channel views, as the
// finance view does.
func TestRiskAndChannelsSayWhenAnHourWasCut(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 3600}
	spender := riskTestUser(t, "cut", "", day1+100, nil)
	require.NoError(t, DB.Create(&InsightHour{HourStart: day1, Version: insightHourVersion, Data: `{"truncated":true}`, CreatedAt: 1}).Error)
	require.NoError(t, DB.Create(&InsightUserHour{HourStart: day1, UserId: spender.Id, Requests: 1, Quota: dollar}).Error)

	risk, err := GetRiskInsights(r)
	require.NoError(t, err)
	assert.True(t, risk.Truncated)
	channels, err := GetChannelInsights(r)
	require.NoError(t, err)
	assert.True(t, channels.Truncated)
}
