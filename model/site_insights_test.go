package model

import (
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useInsightsTestDB(t *testing.T, dialect string) {
	t.Helper()
	useAffiliateTestDB(t, dialect)
	extra := []any{&QuotaData{}, &AuditLog{}, &Redemption{}, &InsightHour{}, &InsightUserHour{}, &InsightModelHour{}, &InsightChannelHour{}, &UpstreamCost{}, &UserConcurrencyRejection{}, &Task{}, &Checkin{}, &RiskGateEvent{}, &Option{}, &Channel{}}
	require.NoError(t, DB.AutoMigrate(extra...))
	t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(extra...)) })
}

func TestSiteInsightsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			// Days split at UTC+8 midnight: 2025-10-01 00:00 +08:00.
			const offset = 8 * 3600
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: offset}

			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", alice.AffCode)
			carol := registerAffiliateTestUser(t, "carol", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			require.NoError(t, DB.Model(&User{}).Where("id = ?", alice.Id).Updates(map[string]any{
				"created_at": day1 + 60, "oidc_id": "g-1", "email": "a.l.ice@gmail.com", "quota": 30 * dollar, "request_count": 3,
			}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", bob.Id).Updates(map[string]any{
				"created_at": day1 + 3600, "email": "bob@spam.example", "quota": -2 * dollar, "request_count": 1,
			}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", carol.Id).Updates(map[string]any{
				"created_at": day1 + 86400 + 60, "linux_do_id": "ld-1",
			}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", root.Id).Updates(map[string]any{"quota": 1000 * dollar}).Error)

			// Two overlapping requests of alice and one of bob that ends as
			// alice's second starts; one engine rejection, one upstream 429.
			logs := []Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: day1 + 100, UseTime: 50, ModelName: "opus", Quota: int(dollar), PromptTokens: 10, IsStream: true, Ip: "1.1.1.1",
					Other: `{"frt":800,"cache_tokens":80,"cache_creation_tokens":10,"usage_semantic":"anthropic","claude":true,"stream_status":{"end_reason":"eof"},"admin_info":{"client":"claude-cli/2.1.3"}}`},
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: day1 + 120, UseTime: 40, ModelName: "opus", Quota: int(dollar), PromptTokens: 10, IsStream: true, Ip: "1.1.1.1",
					Other: `{"frt":1200,"cache_tokens":0,"stream_status":{"end_reason":"eof"}}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeConsume, CreatedAt: day1 + 80, UseTime: 10, ModelName: "sonnet", Quota: int(dollar), PromptTokens: 5, Ip: "1.1.1.1", Other: `{}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeError, CreatedAt: day1 + 90, Content: "status_code=429, Credential concurrency limit exceeded.", ModelName: "sonnet", Ip: "2.2.2.2"},
				{UserId: carol.Id, Username: "carol", Type: LogTypeError, CreatedAt: day1 + 86400 + 100, Content: "status_code=429, Claude upstream rate limit was reached", ModelName: "opus", Ip: "3.3.3.3"},
				// Root's own request overlaps alice's: the capacity view leaves it
				// out, the quality view counts it.
				{UserId: root.Id, Username: "root", Type: LogTypeConsume, CreatedAt: day1 + 110, UseTime: 30, ModelName: "opus", Ip: "9.9.9.9", Other: `{}`},
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)

			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.EqualValues(t, 5, capacity.Requests)
			assert.EqualValues(t, 2, capacity.Errors)
			assert.Equal(t, 3, capacity.PeakConcurrency, "alice's two requests overlap bob's at second 80")
			assert.Equal(t, []NamedCount{{ErrorEngineConcurrency, 1}, {ErrorUpstreamRateLimit, 1}}, capacity.ErrorCategories)
			require.NotEmpty(t, capacity.UserPeaks)
			assert.Equal(t, UserRef{alice.Id, "alice"}, capacity.UserPeaks[0].UserRef)
			assert.Equal(t, 2, capacity.UserPeaks[0].Peak)
			assert.Len(t, capacity.Hourly, 48)
			for _, user := range capacity.UserPeaks {
				assert.NotEqual(t, root.Id, user.UserID, "root is not a customer")
			}
			var storedHours int64
			require.NoError(t, DB.Model(&InsightHour{}).Count(&storedHours).Error)
			assert.EqualValues(t, 48, storedHours, "final hours are stored")
			again, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.Equal(t, capacity, again, "stored hours read back the same")

			plan := SubscriptionPlan{Title: "trial", PriceAmount: 9.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&plan).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: bob.Id, PlanId: plan.Id, Money: 9.9, TradeNo: "SUB1", Status: common.TopUpStatusSuccess, CreateTime: day1 + 4000}).Error)
			topUps := []TopUp{
				{UserId: alice.Id, Amount: 50, Money: 50, BonusQuota: 5 * dollar, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: day1 + 200},
				{UserId: alice.Id, Amount: 20, Money: 20, PaymentMethod: "wxpay", Status: common.TopUpStatusSuccess, TradeNo: "T2", CreateTime: day1 + 86400 + 10},
				{UserId: bob.Id, Money: 9.9, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "SUB1", CreateTime: day1 + 4000},
				{UserId: carol.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusPending, TradeNo: "T3", CreateTime: day1 + 86400 + 200},
			}
			require.NoError(t, DB.Create(&topUps).Error)
			quotaRows := []QuotaData{
				{UserID: alice.Id, Username: "alice", ModelName: "opus", CreatedAt: day1, Count: 2, Quota: int(2 * dollar), TokenUsed: 20, CacheReadTokens: 80},
				{UserID: bob.Id, Username: "bob", ModelName: "claude-sonnet-5-5", CreatedAt: day1, Count: 1, Quota: int(dollar), TokenUsed: 5},
				{UserID: alice.Id, Username: "alice", ModelName: "opus", CreatedAt: day1 + 86400, Count: 1, Quota: int(dollar), TokenUsed: 10},
			}
			require.NoError(t, DB.Create(&quotaRows).Error)
			require.NoError(t, LOG_DB.Create(&AuditLog{
				EventId: "e1", UserId: root.Id, Username: "root", CreatedAt: day1 + 500, Action: "user.quota_add", Success: true, Category: AuditCategoryOperation,
				Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{
					"target_user_id": alice.Id, "target_username": "alice", "mode": "add", "requested_quota": 10 * dollar, "from": 20 * dollar, "to": 30 * dollar,
				}}},
			}).Error)

			finance, err := GetFinanceInsights(r)
			require.NoError(t, err)
			assert.Equal(t, 79.9, finance.Revenue, "the pending order is left out")
			assert.Equal(t, 70.0, finance.TopupRevenue)
			assert.Equal(t, 9.9, finance.SubscriptionRevenue, "a plan order is told apart by its subscription row")
			assert.EqualValues(t, 2, finance.PayingUsers)
			assert.Equal(t, 70.0, finance.TopupCreditUSD)
			assert.Equal(t, 5.0, finance.BonusUSD)
			assert.Equal(t, 3.0, finance.ConsumptionUSD, "read from the logs, root left out")
			assert.Equal(t, 1.0, finance.ClaudeUSD, "only the claude- model counts as Claude")
			assert.Equal(t, 26.6333, finance.RevenuePerUSD)
			assert.Equal(t, 30.0, finance.LiabilityUSD, "root's balance is not owed to a customer")
			assert.Equal(t, -2.0, finance.DebtUSD)
			require.Len(t, finance.Adjustments, 1)
			assert.Equal(t, UserRef{alice.Id, "alice"}, finance.Adjustments[0].Target)
			assert.Equal(t, 10.0, finance.Adjustments[0].DeltaUSD)
			assert.Equal(t, 10.0, finance.AdjustmentNetUSD)
			require.Len(t, finance.Daily, 2)
			assert.Equal(t, FinanceDay{
				Day: day1, Topup: 50, Subscription: 9.9, ConsumptionUSD: 3, RecognizedRevenue: 1.65, ClaudeUSD: 1,
				VendorUSD: map[string]float64{VendorOther: 2, VendorClaude: 1},
			}, finance.Daily[0], "alice's two dollars at 70 paid for 85 credited")
			assert.Equal(t, []VendorModel{
				{Vendor: VendorOther, Model: "opus", USD: 3, Requests: 3},
				{Vendor: VendorClaude, Model: "claude-sonnet-5-5", USD: 1, Requests: 1},
			}, finance.VendorModels, "largest first")
			require.Len(t, finance.Hourly, 48)
			assert.InDelta(t, finance.TopupRevenue, sumOf(finance.Hourly, func(h FinanceHour) float64 { return h.Topup }), 1e-9)
			assert.InDelta(t, finance.SubscriptionRevenue, sumOf(finance.Hourly, func(h FinanceHour) float64 { return h.Subscription }), 1e-9)
			assert.InDelta(t, finance.ConsumptionUSD, sumOf(finance.Hourly, func(h FinanceHour) float64 { return h.ConsumptionUSD }), 1e-9)
			assert.Equal(t, FinanceHour{Hour: day1 + 3600, Subscription: 9.9}, finance.Hourly[1], "bob's plan order at second 4000")

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 3, risk.Signups, "root is outside the range")
			assert.Equal(t, "hour", risk.SeriesUnit)
			assert.Zero(t, risk.AliasEmails, "dots in a Gmail address alone share no inbox with another account")
			assert.EqualValues(t, 1, risk.AliasPatternEmails)
			assert.Zero(t, risk.OffWhitelist, "the domain restriction is off")
			assert.ElementsMatch(t, []NamedCount{{"oidc", 1}, {"email", 1}, {"linuxdo", 1}}, risk.SignupMethods)
			require.Len(t, risk.SharedIPs, 1)
			assert.Equal(t, "1.1.1.1", risk.SharedIPs[0].IP)
			assert.Equal(t, 1, risk.SharedIPTotal)
			assert.False(t, risk.SharedIPs[0].SharedExit)
			assert.Equal(t, 2, risk.SharedIPs[0].NewMembers)
			assert.Zero(t, risk.SharedIPs[0].SubscriptionBuyers, "bob's plan is limited per user but no subscription was opened from it")
			assert.ElementsMatch(t, []RiskUser{
				{UserRef: UserRef{alice.Id, "alice"}, Requests: 2, Paid: true, CreatedAt: day1 + 60, BalanceUSD: 30},
				{UserRef: UserRef{bob.Id, "bob"}, Requests: 1, Subscription: true, CreatedAt: day1 + 3600, BalanceUSD: -2},
			}, risk.SharedIPs[0].Users, "bob's plan order wrote a top-up row with no credit: not a top-up")
			assert.Equal(t, []BalanceUser{{UserRef{bob.Id, "bob"}, -2}}, risk.Debtors)
			assert.EqualValues(t, 3, risk.SignupsMature, "every sign-up is older than six hours at the end")
			assert.EqualValues(t, 1, risk.ZeroUseMature, "carol never had a request succeed")
			assert.EqualValues(t, 1, risk.ZeroUseFailedMature, "carol's only request failed")

			growth, err := GetGrowthInsights(r)
			require.NoError(t, err)
			assert.Equal(t, FunnelRow{Segment: "all", Registered: 3, Activated: 2, Paid: 2, Repeat: 1}, growth.Funnel)
			assert.Equal(t, []FunnelRow{
				{Segment: "organic", Registered: 2, Activated: 1, Paid: 1, Repeat: 1},
				{Segment: "invited", Registered: 1, Activated: 1, Paid: 1},
			}, growth.ByInvite)
			assert.EqualValues(t, 1, growth.SubscriptionBuyers)
			assert.Zero(t, growth.SubscriptionToTopup)
			require.Len(t, growth.Hourly, 48)
			assert.Equal(t, GrowthHour{Hour: day1, Registered: 1, Activated: 1, Paid: 1}, growth.Hourly[0], "alice signed up in the first hour")
			assert.EqualValues(t, 3, sumOf(growth.Hourly, func(h GrowthHour) float64 { return float64(h.Registered) }))

			activity, err := GetActivityInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 2, activity.ActiveUsers)
			require.Len(t, activity.Hourly, 48)
			assert.Equal(t, ActivityHour{Hour: day1, ActiveUsers: 2, Requests: 3, QuotaUSD: 3}, activity.Hourly[0])
			assert.EqualValues(t, activity.Requests, sumOf(activity.Hourly, func(h ActivityHour) float64 { return float64(h.Requests) }))
			assert.InDelta(t, activity.QuotaUSD, sumOf(activity.Hourly, func(h ActivityHour) float64 { return h.QuotaUSD }), 1e-9)
			require.Len(t, activity.Daily, 2)
			assert.Equal(t, ActivityDay{Day: day1, DAU: 2, WAU: 2, Requests: 3, QuotaUSD: 3, ClaudeQuotaUSD: 1}, activity.Daily[0])
			assert.Equal(t, ActivityDay{Day: day1 + 86400, DAU: 1, WAU: 2, Requests: 1, QuotaUSD: 1}, activity.Daily[1])
			assert.Equal(t, 0.75, activity.Top1Share)
			require.Len(t, activity.Retention, 2)
			assert.Equal(t, RetentionCohort{Day: day1, Size: 2, Days: []float64{1, 0.5}}, activity.Retention[1])

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			assert.EqualValues(t, 6, quality.Requests, "root counts toward quality")
			assert.Equal(t, 0.3333, quality.ErrorRate)
			assert.EqualValues(t, 1200, quality.TTFTP50)
			assert.Equal(t, []NamedCount{{"eof", 2}}, quality.StreamEnds)
			assert.Equal(t, []NamedCount{{"429", 2}}, quality.StatusCodes)
			assert.Equal(t, 0.6957, quality.CacheShare, "80 cached of 115 input tokens")

			sonnetOnly, err := GetQualityInsights(r, []string{"sonnet"})
			require.NoError(t, err)
			assert.EqualValues(t, 2, sonnetOnly.Requests, "only the selected model counts")
			assert.EqualValues(t, 1, sonnetOnly.Errors)
			assert.Equal(t, 0.5, sonnetOnly.ErrorRate)
			assert.Zero(t, sonnetOnly.TTFTP95, "opus's first-response times are left out")
			require.Len(t, sonnetOnly.Daily, 2)
			assert.EqualValues(t, 2, sonnetOnly.Daily[0].Requests)
			assert.Zero(t, sonnetOnly.Daily[1].Requests)
			assert.Len(t, sonnetOnly.Models, len(quality.Models), "the table keeps every model, as the filter's options")
			assert.Equal(t, quality.StatusCodes, sonnetOnly.StatusCodes, "counted per hour, not per model")
			assert.Equal(t, quality.Vendors, sonnetOnly.Vendors, "the vendor cards ignore the filter")
			assert.Len(t, quality.Hourly, 48)
			assert.EqualValues(t, quality.Requests, sumOf(quality.Hourly, func(h QualityHour) float64 { return float64(h.Requests) }))
			assert.EqualValues(t, quality.Errors, sumOf(quality.Hourly, func(h QualityHour) float64 { return float64(h.Errors) }))
			assert.Equal(t, QualityHour{Hour: day1, Requests: 2, Errors: 1, ErrorRate: 0.5}, sonnetOnly.Hourly[0], "the hourly series follows the filter")
			assert.EqualValues(t, 2, sumOf(sonnetOnly.Hourly, func(h QualityHour) float64 { return float64(h.Requests) }))
			assert.Equal(t, capacity.ErrorCategories, quality.ErrorCategories, "customers' failures, as on the capacity view")
			assert.Equal(t, VendorQuality{Requests: 6, Errors: 2, ErrorRate: 0.3333, TTFTP50: quality.TTFTP50, TTFTP95: quality.TTFTP95},
				sonnetOnly.AllModels, "the all-models card ignores the filter")
			assert.Equal(t, []VendorQuality{{
				Vendor: VendorOther, Models: []string{"opus", "sonnet"}, Requests: quality.Requests, Errors: quality.Errors,
				ErrorRate: quality.ErrorRate, TTFTP50: quality.TTFTP50, TTFTP95: quality.TTFTP95,
			}}, quality.Vendors, "one vendor holds every model, so its figures are the site's")

			business, err := GetBusinessInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 1, business.Invitees)
			require.Len(t, business.TopInviters, 1)
			assert.Equal(t, InviterReturn{UserRef: UserRef{alice.Id, "alice"}, Invitees: 1, ActiveInvitee: 1, SpendUSD: 1, Payments: 9.9}, business.TopInviters[0])
			assert.Equal(t, []NamedCount{{"unknown", 3}, {"claude-cli/2.1.3", 1}}, business.Clients)
			require.Len(t, business.Models, 2)
			assert.Equal(t, "opus", business.Models[0].Model)
			assert.Equal(t, 0.75, business.Models[0].Share)
			assert.Equal(t, 59.93, business.Models[0].RevenueEstimate)
		})
	}
}

// The risk view reads sign-ins and plan orders as shared addresses, ranks a
// proxy exit after a farm, finds gift spenders that share no address, and
// counts the invite gift's refusals.
func TestRiskSignalsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}
			previousRestriction, previousWhitelist := common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist
			common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist = true, []string{"gmail.com", " googlemail.com", ""}
			t.Cleanup(func() {
				common.EmailDomainRestrictionEnabled, common.EmailDomainWhitelist = previousRestriction, previousWhitelist
			})

			user := func(name string, inviterCode string, created int64, fields map[string]any) *User {
				t.Helper()
				account := registerAffiliateTestUser(t, name, inviterCode)
				updates := map[string]any{"created_at": created}
				for key, value := range fields {
					updates[key] = value
				}
				require.NoError(t, DB.Model(&User{}).Where("id = ?", account.Id).Updates(updates).Error)
				return account
			}
			old := day1 - 86400
			inviter := user("inviter", "", old, nil)
			farm1 := user("farm1", inviter.AffCode, day1+100, map[string]any{"request_count": 1})
			farm2 := user("farm2", "", day1+200, map[string]any{"request_count": 1})
			older1 := user("older1", "", old, nil)
			older2 := user("older2", "", old, nil)
			user("inbox", "", old, map[string]any{"email": "john.smith@gmail.com"})
			alias := user("alias", "", day1+300, map[string]any{"email": "JohnSmith+x@googlemail.com"})
			dotted := user("dotted", "", day1+400, map[string]any{"email": "first.last@gmail.com"})
			corp := user("corp", "", day1+500, map[string]any{"email": "x@corp.example"})
			user("oauth", "", day1+600, map[string]any{"email": "y@corp.example", "linux_do_id": "ld-9"})
			require.NoError(t, DB.Delete(&User{}, dotted.Id).Error)

			// Both farm accounts signed in from one home address and bought
			// the plan limited per user; five accounts that bought nothing
			// signed in from a proxy node.
			limited := SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&limited).Error)
			for _, farm := range []*User{farm1, farm2} {
				addressTestSession(t, farm.Id, "10.0.0.1", day1+1000)
				require.NoError(t, DB.Create(&UserSubscription{UserId: farm.Id, PlanId: limited.Id, Status: "active", Source: "order",
					StartTime: day1 + 1000, EndTime: day1 + 8*86400, CreatedAt: day1 + 1000, UpdatedAt: day1 + 1000}).Error)
			}
			for i := range 5 {
				bystander := user("bystander"+strconv.Itoa(i), "", old, nil)
				addressTestSession(t, bystander.Id, "10.9.9.9", day1+2000)
			}
			// Two older accounts met on an address through a plan order and a
			// console sign-in.
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: older1.Id, PlanId: limited.Id, TradeNo: "O1", Status: "pending",
				CreateTime: day1 + 3000, Ip: "10.0.0.2"}).Error)
			require.NoError(t, LOG_DB.Create(&AuditLog{EventId: "login-1", UserId: older2.Id, Username: "older2", CreatedAt: day1 + 3000,
				Action: "user.login", Success: true, Category: AuditCategoryLogin, Ip: "10.0.0.2"}).Error)

			// farm1 spends its invite gift plan and never pays; farm2 spends
			// from a wallet it topped up. corp's only request failed.
			gift := UserSubscription{UserId: farm1.Id, PlanId: limited.Id, AmountTotal: 3 * dollar, StartTime: day1 + 100,
				EndTime: day1 + 8*86400, Status: "active", Source: SubscriptionSourceAffiliateGift}
			require.NoError(t, DB.Create(&gift).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: farm2.Id, Amount: 5, Money: 5, PaymentMethod: "alipay",
				Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: day1 + 1500}).Error)
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: farm1.Id, Username: "farm1", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(2 * dollar),
					Other: `{"billing_source":"subscription","subscription_id":` + strconv.Itoa(gift.Id) + `}`},
				{UserId: farm2.Id, Username: "farm2", Type: LogTypeConsume, CreatedAt: day1 + 4000, ModelName: "opus", Quota: int(dollar), Other: `{}`},
				{UserId: corp.Id, Username: "corp", Type: LogTypeError, CreatedAt: day1 + 4000, ModelName: "opus", Content: "status_code=500, boom"},
			}).Error)

			for i, outcome := range []AffiliateSignupGift{
				{UserId: farm1.Id, Status: AffiliateSignupGiftGiven},
				{UserId: 9001, Status: AffiliateSignupGiftIpUsed},
				{UserId: 9002, Status: AffiliateSignupGiftIpUsed},
				{UserId: 9003, Status: AffiliateSignupGiftEmailSignup},
			} {
				outcome.InviterId, outcome.PlanId, outcome.Ip = inviter.Id, limited.Id, "10.1.1."+strconv.Itoa(i)
				require.NoError(t, DB.Create(&outcome).Error)
				require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("id = ?", outcome.Id).Update("created_at", day1+100).Error)
			}

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 6, risk.Signups, "the deleted sign-up still counts")
			assert.EqualValues(t, 1, risk.DeletedSignups)
			assert.EqualValues(t, 1, risk.AliasEmails, "only the sign-up whose inbox another account has")
			assert.Equal(t, []AliasCluster{{Canonical: "johnsmith@gmail.com", Users: []UserRef{
				{risk.AliasClusters[0].Users[0].UserID, "inbox"}, {alias.Id, "alias"},
			}}}, risk.AliasClusters)
			assert.EqualValues(t, 2, risk.AliasPatternEmails)
			assert.True(t, risk.EmailRestriction)
			assert.EqualValues(t, 1, risk.OffWhitelist, "the email sign-up off the list, not the third-party one")
			assert.EqualValues(t, 4, risk.ZeroUseAccounts)
			assert.EqualValues(t, 1, risk.ZeroUseFailed)

			assert.Equal(t, 3, risk.SharedIPTotal)
			assert.Equal(t, 1, risk.SharedExits)
			require.Len(t, risk.SharedIPs, 3)
			assert.Equal(t, []string{"10.0.0.1", "10.0.0.2", "10.9.9.9"},
				[]string{risk.SharedIPs[0].IP, risk.SharedIPs[1].IP, risk.SharedIPs[2].IP}, "the farm first, the proxy exit last")
			assert.Equal(t, 2, risk.SharedIPs[0].SubscriptionBuyers)
			assert.Equal(t, 2, risk.SharedIPs[0].NewMembers)
			assert.True(t, risk.SharedIPs[0].Users[0].LimitedPlan)
			assert.True(t, risk.SharedIPs[2].SharedExit)
			assert.Len(t, risk.SharedIPs[2].Users, 5)

			assert.EqualValues(t, 2, risk.SignupSpenders)
			assert.EqualValues(t, 1, risk.UnpaidSpenders)
			assert.Equal(t, 2.0, risk.UnpaidSpendUSD)
			assert.Equal(t, []UnpaidSpender{{
				UserRef: UserRef{farm1.Id, "farm1"}, ConsumptionUSD: 2, GiftPlanUSD: 2, SignupMethod: "password",
				Inviter: UserRef{inviter.Id, "inviter"}, CreatedAt: day1 + 100,
			}}, risk.UnpaidSpenderTop)
			assert.Equal(t, []InviterSpenders{{UserRef: UserRef{inviter.Id, "inviter"}, Accounts: 1, ConsumptionUSD: 2}}, risk.UnpaidInviters)

			assert.Equal(t, []NamedCount{{AffiliateSignupGiftIpUsed, 2}, {AffiliateSignupGiftEmailSignup, 1}, {AffiliateSignupGiftGiven, 1}}, risk.SignupGifts)
			assert.Equal(t, []GiftBlockInviter{{UserRef: UserRef{inviter.Id, "inviter"}, Blocked: 2, Gifted: 1}}, risk.GiftBlockInviters,
				"an email sign-up is not a block")
		})
	}
}

func TestCanonicalEmail(t *testing.T) {
	for email, canonical := range map[string]string{
		"First.Last@Gmail.com":   "firstlast@gmail.com",
		"a.b+tag@googlemail.com": "ab@gmail.com",
		"a.b+tag@corp.example":   "a.b@corp.example",
		"+only@corp.example":     "",
		"no-at-sign":             "",
	} {
		assert.Equal(t, canonical, canonicalEmail(email), email)
	}
}

// The finance view earns a plan's price over the days it runs and a wallet's
// money as it is spent, and leaves root's requests and given credit unpaid.
func TestFinanceRecognizesRevenueAsItIsEarned(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			const week = 7 * 86400
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: 8 * 3600}

			payer := registerAffiliateTestUser(t, "payer", "")
			buyer := registerAffiliateTestUser(t, "buyer", "")
			guest := registerAffiliateTestUser(t, "guest", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			for id, quota := range map[int]int64{payer.Id: 50 * dollar, buyer.Id: 0, guest.Id: 0, root.Id: 1000 * dollar} {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", id).Update("quota", quota).Error)
			}

			// The payer paid 80 for $80 before the range and was given $20 more,
			// so each wallet dollar carries 0.8. They also bought a $7 plan with
			// balance. The buyer paid 14 in the range for a week's plan; the
			// guest's plan was an inviter's gift.
			require.NoError(t, DB.Create(&TopUp{UserId: payer.Id, Amount: 80, Money: 80, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "W1", CreateTime: day1 - 86400}).Error)
			require.NoError(t, LOG_DB.Create(&AuditLog{
				EventId: "gift", UserId: root.Id, Username: "root", CreatedAt: day1 - 3600, Action: "user.quota_add", Success: true, Category: AuditCategoryOperation,
				Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{"target_user_id": payer.Id, "from": 80 * dollar, "to": 100 * dollar}}},
			}).Error)
			orders := []SubscriptionOrder{
				{UserId: buyer.Id, PlanId: 1, Money: 14, TradeNo: "S1", PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CreateTime: day1, CompleteTime: day1},
				{UserId: payer.Id, PlanId: 2, Money: 7, TradeNo: "S2", PaymentMethod: PaymentMethodBalance, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess,
					CreateTime: day1, CompleteTime: day1, ProviderPayload: "charged_quota=" + strconv.FormatInt(7*dollar, 10)},
			}
			require.NoError(t, DB.Create(&orders).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: buyer.Id, Money: 14, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "S1", CreateTime: day1}).Error)
			bought := UserSubscription{UserId: buyer.Id, PlanId: 1, AmountTotal: 20 * dollar, StartTime: day1, EndTime: day1 + week, Status: "active", Source: "order"}
			withBalance := UserSubscription{UserId: payer.Id, PlanId: 2, AmountTotal: 10 * dollar, StartTime: day1, EndTime: day1 + week, Status: "active", Source: PaymentMethodBalance}
			given := UserSubscription{UserId: guest.Id, PlanId: 3, AmountTotal: 5 * dollar, StartTime: day1, EndTime: day1 + week, Status: "active", Source: SubscriptionSourceAffiliateGift}
			for _, subscription := range []*UserSubscription{&bought, &withBalance, &given} {
				require.NoError(t, DB.Create(subscription).Error)
			}

			plan := func(id int, overflow int64) string {
				other := `{"billing_source":"subscription","subscription_id":` + strconv.Itoa(id)
				if overflow > 0 {
					other += `,"billing_overflow_source":"wallet","billing_overflow_quota":` + strconv.FormatInt(overflow, 10)
				}
				return other + "}"
			}
			consume := func(user *User, at int64, dollars int64, other string) Log {
				return Log{UserId: user.Id, Username: user.Username, Type: LogTypeConsume, CreatedAt: at, ModelName: "opus", Quota: int(dollars * dollar), Other: other}
			}
			logs := []Log{
				consume(payer, day1+100, 10, `{"billing_source":"wallet"}`),
				consume(buyer, day1+200, 6, plan(bought.Id, dollar)),
				consume(root, day1+300, 30, `{"billing_source":"wallet"}`),
				// A log from before billing_source was recorded was billed to the wallet.
				consume(payer, day1+86400+100, 5, `{}`),
				consume(guest, day1+86400+200, 4, plan(given.Id, 0)),
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: root.Id, Username: "root", ModelName: "claude-opus-5-5", CreatedAt: day1, Count: 1, Quota: int(30 * dollar)},
				{UserID: root.Id, Username: "root", ModelName: "gpt-6-sol", CreatedAt: day1 + 86400, Count: 4, Quota: int(4 * dollar)},
			}).Error)

			finance, err := GetFinanceInsights(r)
			require.NoError(t, err)
			assert.Equal(t, 30.0, finance.ClaudeUSD, "the Claude charge keeps root, as the engine's cost does")
			assert.Equal(t, 14.0, finance.Revenue, "a plan bought with balance brings in no money")
			assert.Equal(t, 25.0, finance.ConsumptionUSD, "payer 15, buyer 6, guest 4")
			assert.Equal(t, 30.0, finance.RootConsumptionUSD)
			assert.Equal(t, 8.0, finance.GiftConsumptionUSD, "a fifth of the payer's 15, the buyer's unpaid wallet dollar, the guest's 4")
			assert.Equal(t, 12.0, finance.RecognizedWalletRevenue, "the payer's 15 at 0.8")
			assert.Equal(t, 5.6, finance.RecognizedSubscriptionRevenue, "two of seven days of 14, and of $7 balance at 0.8")
			assert.Equal(t, 17.6, finance.RecognizedRevenue)
			assert.Equal(t, 0.704, finance.RecognizedPerUSD)
			assert.Equal(t, 0.56, finance.RevenuePerUSD)
			assert.Equal(t, 40.0, finance.LiabilityPaidValue, "the payer's $50 at 0.8")
			require.Len(t, finance.Daily, 2)
			assert.Equal(t, FinanceDay{Day: day1, Subscription: 14, ConsumptionUSD: 16, RecognizedRevenue: 10.8, ClaudeUSD: 30, RootConsumptionUSD: 30, VendorUSD: map[string]float64{VendorClaude: 30}}, finance.Daily[0])
			assert.Equal(t, FinanceDay{Day: day1 + 86400, ConsumptionUSD: 9, RecognizedRevenue: 6.8, VendorUSD: map[string]float64{VendorCodex: 4}}, finance.Daily[1],
				"the charge by vendor keeps root, as the Claude charge does")
			assert.Equal(t, []VendorModel{
				{Vendor: VendorClaude, Model: "claude-opus-5-5", USD: 30, Requests: 1},
				{Vendor: VendorCodex, Model: "gpt-6-sol", USD: 4, Requests: 4},
			}, finance.VendorModels, "largest first")
			assert.Empty(t, finance.VendorRevenue, "root's use earns nothing")

			// Customers' use shares the recognized revenue out by vendor: 15
			// of 19 customer dollars on Claude, 4 on Codex; root's are left out.
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: payer.Id, Username: "payer", ModelName: "claude-sonnet-5-5", CreatedAt: day1, Count: 3, Quota: int(15 * dollar)},
				{UserID: guest.Id, Username: "guest", ModelName: "gpt-6-sol", CreatedAt: day1 + 86400, Count: 2, Quota: int(4 * dollar)},
			}).Error)
			finance, err = GetFinanceInsights(r)
			require.NoError(t, err)
			assert.Equal(t, []VendorRevenue{
				{Vendor: VendorClaude, CustomerUSD: 15, Share: 0.7895, RecognizedRevenue: 13.89},
				{Vendor: VendorCodex, CustomerUSD: 4, Share: 0.2105, RecognizedRevenue: 3.71},
			}, finance.VendorRevenue, "17.6 recognized, shared 15 to 4, largest first")
		})
	}
}

func sumOf[T any](rows []T, value func(T) float64) float64 {
	var total float64
	for _, row := range rows {
		total += value(row)
	}
	return total
}

// A range of 24 hours that starts mid-hour spans 25 UTC hours, each listed
// and zero-filled, and adds up to the range's totals; a week has no hourly
// series.
func TestInsightsHourlySeries(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			start := hour1 + 1800
			r := InsightsRange{Start: start, End: start + 86400, Offset: 8 * 3600}

			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			carol := registerAffiliateTestUser(t, "carol", "")
			for id, created := range map[int]int64{alice.Id: start + 60, bob.Id: r.End - 3600, carol.Id: start + 7200} {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", id).Update("created_at", created).Error)
			}
			require.NoError(t, DB.Model(&User{}).Where("id = ?", alice.Id).Update("request_count", 2).Error)
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: start + 100, ModelName: "claude-opus-5-5", Quota: int(dollar), IsStream: true, Other: `{"frt":700}`},
				{UserId: alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: start + 3700, ModelName: "gpt-6-luna", Content: "status_code=429, Credential concurrency limit exceeded."},
			}).Error)
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: alice.Id, Username: "alice", ModelName: "claude-opus-5-5", CreatedAt: hour1, Count: 5, Quota: int(5 * dollar)},
				{UserID: alice.Id, Username: "alice", ModelName: "claude-opus-5-5", CreatedAt: hour1 + 3600, Count: 1, Quota: int(dollar)},
			}).Error)
			require.NoError(t, DB.Create(&TopUp{UserId: alice.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: start + 200}).Error)

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			require.Len(t, quality.Hourly, 25)
			assert.Equal(t, hour1, quality.Hourly[0].Hour, "keyed by the rollup's UTC hour, not the range's start")
			assert.Equal(t, QualityHour{Hour: hour1, Requests: 1, TTFTP50: 700, TTFTP95: 700}, quality.Hourly[0])
			assert.Equal(t, QualityHour{Hour: hour1 + 3600, Requests: 1, Errors: 1, ErrorRate: 1}, quality.Hourly[1])
			assert.Equal(t, QualityHour{Hour: hour1 + 2*3600}, quality.Hourly[2], "an hour without requests is listed")
			assert.EqualValues(t, quality.Requests, sumOf(quality.Hourly, func(h QualityHour) float64 { return float64(h.Requests) }))
			claude, err := GetQualityInsights(r, []string{"claude-opus-5-5"})
			require.NoError(t, err)
			assert.Zero(t, claude.Hourly[1].Requests, "the GPT failure is not a Claude model's")
			assert.EqualValues(t, claude.Requests, sumOf(claude.Hourly, func(h QualityHour) float64 { return float64(h.Requests) }))

			finance, err := GetFinanceInsights(r)
			require.NoError(t, err)
			require.Len(t, finance.Hourly, 25)
			assert.Equal(t, FinanceHour{Hour: hour1, Topup: 10, ConsumptionUSD: 1}, finance.Hourly[0])
			assert.InDelta(t, finance.TopupRevenue, sumOf(finance.Hourly, func(h FinanceHour) float64 { return h.Topup }), 1e-9)
			assert.InDelta(t, finance.ConsumptionUSD, sumOf(finance.Hourly, func(h FinanceHour) float64 { return h.ConsumptionUSD }), 1e-9)

			growth, err := GetGrowthInsights(r)
			require.NoError(t, err)
			require.Len(t, growth.Hourly, 25)
			assert.Equal(t, GrowthHour{Hour: hour1, Registered: 1, Activated: 1, Paid: 1}, growth.Hourly[0])
			assert.Equal(t, GrowthHour{Hour: hour1 + 2*3600, Registered: 1}, growth.Hourly[2])
			assert.EqualValues(t, growth.Funnel.Registered, sumOf(growth.Hourly, func(h GrowthHour) float64 { return float64(h.Registered) }))

			activity, err := GetActivityInsights(r)
			require.NoError(t, err)
			require.Len(t, activity.Hourly, 25)
			assert.Equal(t, ActivityHour{Hour: hour1}, activity.Hourly[0], "the quota row before the range's start is left out, as in the totals")
			assert.Equal(t, ActivityHour{Hour: hour1 + 3600, ActiveUsers: 1, Requests: 1, QuotaUSD: 1}, activity.Hourly[1])
			assert.EqualValues(t, activity.Requests, sumOf(activity.Hourly, func(h ActivityHour) float64 { return float64(h.Requests) }))
			assert.InDelta(t, activity.QuotaUSD, sumOf(activity.Hourly, func(h ActivityHour) float64 { return h.QuotaUSD }), 1e-9)

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 3, risk.Signups)
			assert.EqualValues(t, 2, risk.ZeroUseAccounts)
			assert.EqualValues(t, 2, risk.SignupsMature, "bob signed up an hour before the end")
			assert.EqualValues(t, 1, risk.ZeroUseMature, "carol is old enough and never sent a request")

			week := InsightsRange{Start: hour1, End: hour1 + 7*86400, Offset: 8 * 3600}
			weekQuality, err := GetQualityInsights(week, nil)
			require.NoError(t, err)
			assert.Nil(t, weekQuality.Hourly)
			assert.NotEmpty(t, weekQuality.Daily)
			weekFinance, err := GetFinanceInsights(week)
			require.NoError(t, err)
			assert.Nil(t, weekFinance.Hourly)
			weekGrowth, err := GetGrowthInsights(week)
			require.NoError(t, err)
			assert.Nil(t, weekGrowth.Hourly)
			weekActivity, err := GetActivityInsights(week)
			require.NoError(t, err)
			assert.Nil(t, weekActivity.Hourly)
			encoded, err := common.Marshal(weekQuality)
			require.NoError(t, err)
			assert.NotContains(t, string(encoded), `"hourly"`, "a long range's payload does not grow")
		})
	}
}

func TestResolveInsightsRange(t *testing.T) {
	r, ok := ResolveInsightsRange(0, 1_000_000, 0, 31)
	assert.True(t, ok)
	assert.Equal(t, int64(1_000_000-7*86400), r.Start, "start defaults to seven days before end")
	_, ok = ResolveInsightsRange(1, 1+32*86400, 0, 31)
	assert.False(t, ok, "a span past the bound is rejected")
	_, ok = ResolveInsightsRange(10, 5, 0, 31)
	assert.False(t, ok)
	_, ok = ResolveInsightsRange(1, 2, 15*3600, 31)
	assert.False(t, ok, "an offset past UTC+14 is rejected")
}

func TestClassifyErrorLog(t *testing.T) {
	for content, want := range map[string]string{
		"status_code=429, Credential concurrency limit exceeded.":            ErrorEngineConcurrency,
		"status_code=429, Concurrency limit exceeded.":                       ErrorEngineLimit,
		"status_code=429, Access key rate limit exceeded.":                   ErrorEngineLimit,
		"status_code=429, Access key cost limit exceeded.":                   ErrorEngineLimit,
		"status_code=429, Credential request rate limit exceeded.":           ErrorEngineBudget,
		"status_code=429, Credential quota budget exceeded.":                 ErrorEngineBudget,
		"status_code=429, A fresh credential quota observation is required.": ErrorEngineBudget,
		"status_code=429, Claude upstream rate limit was reached":            ErrorUpstreamRateLimit,
		"status_code=429, Upstream rate limit exceeded.":                     ErrorUpstreamRateLimit,
		"status_code=529, Claude upstream service failed":                    ErrorUpstreamOverload,
		"status_code=502, bad gateway":                                       ErrorUpstream,
		"status_code=400, invalid request":                                   ErrorClient,
		"something else":                                                     ErrorOther,
		NoChannelErrorContent(503, "vip"):                                    ErrorNoChannel,
		"status_code=503, upstream said no_channel: x":                       ErrorUpstream,
	} {
		assert.Equal(t, want, classifyErrorLog(content), content)
	}
	for _, test := range []struct {
		content, errorType, want string
	}{
		{"status_code=403, insufficient balance at the supplier", "openai_error", ErrorUpstreamAuth},
		{"status_code=401, invalid api key", "claude_error", ErrorUpstreamAuth},
		{"status_code=402, payment required", "upstream_error", ErrorUpstreamAuth},
		{"status_code=403, model not allowed for this token", "new_api_error", ErrorClient},
		{"status_code=401, unauthorized", "new_api_error", ErrorClient},
		{"status_code=400, bad request", "openai_error", ErrorClient},
		{"status_code=404, model not found", "openai_error", ErrorClient},
		{"status_code=429, Concurrency limit exceeded.", "openai_error", ErrorEngineLimit},
	} {
		assert.Equal(t, test.want, classifyError(test.content, logOtherFields{ErrorType: test.errorType}), test.content)
	}
	assert.Equal(t, "new_api_error", parseLogOther(`{"error_type":"new_api_error","status_code":403}`).ErrorType)
}

// A request's attempts share its request id and are counted once: served
// when any attempt was, otherwise failed under its last error. The channels
// still count attempts, and only requests the engine served are in the
// pool's peak.
func TestInsightHourCountsRequestsOnce(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour = int64(1759248000)
			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			carol := registerAffiliateTestUser(t, "carol", "")
			engine, public := "http://gpt-load:3001", "https://api.example.com"
			require.NoError(t, DB.Create(&[]Channel{
				{Id: 2, Name: "engine", Key: "k2", BaseURL: &engine},
				{Id: 7, Name: "relay", Key: "k7", BaseURL: &public},
			}).Error)
			upstream := `{"error_type":"openai_error"}`
			require.NoError(t, LOG_DB.Create(&[]Log{
				// Failed on the engine, then served by channel 7: one request,
				// in flight from 95 to 130.
				{RequestId: "retried", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 100, UseTime: 5, ChannelId: 2, ModelName: "gpt-6",
					Content: "status_code=502, bad gateway", Other: upstream},
				{RequestId: "retried", UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 130, UseTime: 35, ChannelId: 7, ModelName: "gpt-6", Other: `{}`},
				// Served by the engine, from 110 to 150.
				{RequestId: "pooled", UserId: carol.Id, Type: LogTypeConsume, CreatedAt: hour + 150, UseTime: 40, ChannelId: 2, ModelName: "claude-opus-5", Other: `{}`},
				// Refused before any channel: no time in flight.
				{UserId: bob.Id, Type: LogTypeError, CreatedAt: hour + 120, ChannelId: 0, ModelName: "gpt-6", Content: NoChannelErrorContent(503, "vip"),
					Other: `{"error_type":"new_api_error"}`},
				// Refused by the engine, then rate limited on channel 7.
				{RequestId: "failed", UserId: bob.Id, Type: LogTypeError, CreatedAt: hour + 200, ChannelId: 2, ModelName: "gpt-6",
					Content: "status_code=429, Credential concurrency limit exceeded.", Other: upstream},
				{RequestId: "failed", UserId: bob.Id, Type: LogTypeError, CreatedAt: hour + 202, UseTime: 2, ChannelId: 7, ModelName: "gpt-6",
					Content: "status_code=429, Upstream rate limit exceeded.", Other: upstream},
				// Refused by the engine and not retried.
				{RequestId: "refused", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 300, ChannelId: 2, ModelName: "claude-opus-5",
					Content: "status_code=429, Credential concurrency limit exceeded.", Other: upstream},
			}).Error)

			scope, err := loadInsightHourScope()
			require.NoError(t, err)
			assert.Equal(t, map[int]bool{2: true}, scope.engines)
			got, err := computeInsightHour(hour, scope)
			require.NoError(t, err)
			summary := got.summary
			assert.EqualValues(t, 5, summary.Requests)
			assert.EqualValues(t, 3, summary.Errors, "the rescued request is not a failure")
			assert.EqualValues(t, 7, summary.Attempts)
			assert.EqualValues(t, 5, summary.AttemptErrors)
			assert.Equal(t, map[string]int64{ErrorUpstreamRateLimit: 1, ErrorNoChannel: 1, ErrorEngineConcurrency: 1}, summary.Categories,
				"a request failing every attempt is counted under its last error")
			assert.EqualValues(t, 1, summary.EngineRejections)
			assert.EqualValues(t, 1, summary.UpstreamRateLimit)
			assert.Equal(t, 2, summary.Peak, "the retried request is in flight once")
			assert.Equal(t, hour+110, summary.PeakAt)
			assert.Equal(t, 1, summary.PoolPeak, "only the request the engine served")
			assert.Equal(t, hour+110, summary.PoolPeakAt)
			assert.EqualValues(t, 2, summary.PeakRPM)
			assert.Equal(t, hour+60, summary.PeakRPMAt)
			assert.Equal(t, map[string]int64{"429": 3, "502": 1, "503": 1}, summary.StatusCodes, "status codes count attempts")

			require.Contains(t, summary.Vendors, VendorClaude)
			require.Contains(t, summary.Vendors, VendorCodex)
			claude, codex := summary.Vendors[VendorClaude], summary.Vendors[VendorCodex]
			assert.Equal(t, [4]int64{2, 1, 1, hour + 110}, [4]int64{claude.Requests, claude.Errors, int64(claude.PoolPeak), claude.PoolPeakAt})
			assert.Equal(t, [4]int64{3, 2, 0, 0}, [4]int64{codex.Requests, codex.Errors, int64(codex.PoolPeak), codex.PoolPeakAt},
				"channel 7 is not the engine's")
			assert.Equal(t, 1, codex.Peak)

			models := map[string][2]int64{}
			for name, model := range got.models {
				models[name] = [2]int64{model.row.Requests, model.row.Errors}
			}
			assert.Equal(t, map[string][2]int64{"gpt-6": {3, 2}, "claude-opus-5": {2, 1}}, models)
			users := map[int]int64{}
			for id, user := range got.users {
				users[id] = user.Requests
			}
			assert.Equal(t, map[int]int64{alice.Id: 2, bob.Id: 2, carol.Id: 1}, users)
			channels := map[insightChannelKey][2]int64{}
			for key, channel := range got.channels {
				channels[key] = [2]int64{channel.row.Requests, channel.row.Errors}
			}
			assert.Equal(t, map[insightChannelKey][2]int64{
				{2, "gpt-6"}: {0, 2}, {7, "gpt-6"}: {1, 1}, {0, "gpt-6"}: {0, 1},
				{2, "claude-opus-5"}: {1, 1},
			}, channels, "channels count attempts")

			r := InsightsRange{Start: hour, End: hour + 3600}
			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			require.NotNil(t, capacity.Attempts)
			require.NotNil(t, capacity.PoolPeak)
			assert.Equal(t, [8]int64{5, 3, 7, 5, 2, hour + 110, 1, hour + 110}, [8]int64{capacity.Requests, capacity.Errors, *capacity.Attempts, *capacity.AttemptErrors,
				int64(capacity.PeakConcurrency), capacity.PeakAt, int64(*capacity.PoolPeak), *capacity.PoolPeakAt})
			assert.Equal(t, []CapacityHour{{Hour: hour, Requests: 5, Errors: 3, PeakConcurrency: 2, PoolPeak: new(1), EngineRejections: 1, UpstreamRateLimit: 1}}, capacity.Hourly)
			assert.Zero(t, capacity.StaleHours)
			pooled, err := GetCapacityInsights(r, VendorClaude)
			require.NoError(t, err)
			assert.Equal(t, [6]int64{2, 1, 2, 1, 1, hour + 110}, [6]int64{pooled.Requests, pooled.Errors, *pooled.Attempts, *pooled.AttemptErrors, int64(*pooled.PoolPeak), *pooled.PoolPeakAt})
			assert.Equal(t, new(1), pooled.Hourly[0].PoolPeak)
			relayed, err := GetCapacityInsights(r, VendorCodex)
			require.NoError(t, err)
			assert.Equal(t, [6]int64{3, 2, 5, 4, 0, 0}, [6]int64{relayed.Requests, relayed.Errors, *relayed.Attempts, *relayed.AttemptErrors, int64(*relayed.PoolPeak), *relayed.PoolPeakAt})

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			assert.Equal(t, [4]int64{5, 3, 7, 5}, [4]int64{quality.Requests, quality.Errors, *quality.Attempts, *quality.AttemptErrors})
			assert.Zero(t, quality.StaleHours)
			claudeOnly, err := GetQualityInsights(r, []string{"claude-opus-5"})
			require.NoError(t, err)
			assert.Equal(t, [4]int64{2, 1, 7, 5}, [4]int64{claudeOnly.Requests, claudeOnly.Errors, *claudeOnly.Attempts, *claudeOnly.AttemptErrors},
				"the model filter narrows requests, not attempts")
		})
	}
}

// Without a known engine channel the pool's peak is zero.
func TestInsightHourPoolPeakNeedsEngineChannels(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 50, UseTime: 20, ChannelId: 2, ModelName: "claude-opus-5", Other: `{}`}).Error)
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.Equal(t, [4]int64{1, hour + 30, 0, 0}, [4]int64{int64(got.summary.Peak), got.summary.PeakAt, int64(got.summary.PoolPeak), got.summary.PoolPeakAt})
}

// An hour past the row cap keeps its earliest rows and says it was cut.
func TestInsightHourTruncationKeepsTheStart(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	maxRows := insightHourMaxLogRows
	insightHourMaxLogRows = 3
	t.Cleanup(func() { insightHourMaxLogRows = maxRows })
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	for _, at := range []int64{10, 70, 130, 1800, 3000} {
		require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + at, ModelName: "opus", Other: `{}`}).Error)
	}
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.True(t, got.summary.Truncated)
	assert.EqualValues(t, 3, got.summary.Requests)
	assert.Equal(t, map[string][2]int64{"opus": {3, 0}}, map[string][2]int64{"opus": {got.models["opus"].row.Requests, got.models["opus"].row.Errors}})
	assert.Equal(t, [2]int64{1, hour}, [2]int64{got.summary.PeakRPM, got.summary.PeakRPMAt}, "the first minute is kept")
}

// A request whose logs' starts fall on either side of an hour's start, a
// second apart from whole-second use times, belongs to the earlier hour,
// which counts it once as its outcome says; the later hour leaves it out.
func TestInsightHourFoldsRequestsAcrossItsStart(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	const prev = hour - 3600
	alice := registerAffiliateTestUser(t, "alice", "")
	upstream := `{"error_type":"openai_error"}`
	require.NoError(t, LOG_DB.Create(&[]Log{
		// Began at hour-1 by its error log, at hour by its consume log.
		{RequestId: "late", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 2, UseTime: 3, ChannelId: 2, ModelName: "gpt-6",
			Content: "status_code=502, bad gateway", Other: upstream},
		{RequestId: "late", UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 40, UseTime: 40, ChannelId: 7, ModelName: "gpt-6", Other: `{}`},
		// Its error log written before the hour, its consume log after.
		{RequestId: "early", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour - 1, ChannelId: 2, ModelName: "gpt-6",
			Content: "status_code=502, bad gateway", Other: upstream},
		{RequestId: "early", UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 30, UseTime: 30, ChannelId: 7, ModelName: "gpt-6", Other: `{}`},
	}).Error)
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	before, err := computeInsightHour(prev, scope)
	require.NoError(t, err)
	after, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.Equal(t, [4]int64{2, 0, 4, 2}, [4]int64{before.summary.Requests, before.summary.Errors, before.summary.Attempts, before.summary.AttemptErrors},
		"both requests were served, in the hour they began")
	assert.Equal(t, [2]int64{0, 0}, [2]int64{after.summary.Requests, after.summary.Errors})
	assert.Equal(t, 2, after.summary.Peak, "still in flight in the later hour")
}

// A request with an error log among the kept rows of a truncated hour is
// judged from all of its logs, not counted failed because its consume log
// fell past the cut.
func TestInsightHourTruncationReadsWholeRequests(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	maxRows := insightHourMaxLogRows
	insightHourMaxLogRows = 3
	t.Cleanup(func() { insightHourMaxLogRows = maxRows })
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	for _, log := range []Log{
		{RequestId: "retried", Type: LogTypeError, CreatedAt: hour + 3590, UseTime: 5, ChannelId: 2, Content: "status_code=502, bad gateway", Other: `{"error_type":"openai_error"}`},
		{RequestId: "a", Type: LogTypeConsume, CreatedAt: hour + 10, Other: `{}`},
		{RequestId: "b", Type: LogTypeConsume, CreatedAt: hour + 20, Other: `{}`},
		{RequestId: "retried", Type: LogTypeConsume, CreatedAt: hour + 3630, UseTime: 45, ChannelId: 7, Other: `{}`},
		{RequestId: "c", Type: LogTypeConsume, CreatedAt: hour + 30, Other: `{}`},
	} {
		log.UserId, log.ModelName = alice.Id, "opus"
		require.NoError(t, LOG_DB.Create(&log).Error)
	}
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	assert.True(t, got.summary.Truncated)
	assert.Equal(t, [3]int64{3, 0, 4}, [3]int64{got.summary.Requests, got.summary.Errors, got.summary.Attempts},
		"the retried request was served; c is past the cut")
}

// A violation fee is charged on a consume log after the refused request's
// error log: it moves money, and the request stays failed. The engine's own
// caps and budget are their own categories, not the account concurrency
// rejections or an upstream's rate limit.
func TestInsightHourFeesAndEngineRefusals(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	upstream := `{"error_type":"openai_error"}`
	require.NoError(t, LOG_DB.Create(&[]Log{
		{RequestId: "csam", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 100, UseTime: 4, ChannelId: 7, ModelName: "grok-5",
			Content: "status_code=400, request refused", Other: upstream},
		{RequestId: "csam", UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 101, UseTime: 5, ChannelId: 7, ModelName: "grok-5", Quota: 500,
			Other: `{"violation_fee":true,"fee_quota":500}`},
		{RequestId: "capped", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 200, ChannelId: 2, ModelName: "claude-opus-5",
			Content: "status_code=429, Access key cost limit exceeded.", Other: upstream},
		{RequestId: "spent", UserId: alice.Id, Type: LogTypeError, CreatedAt: hour + 300, ChannelId: 2, ModelName: "claude-opus-5",
			Content: "status_code=429, Credential quota budget exceeded.", Other: upstream},
	}).Error)
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	summary := got.summary
	assert.Equal(t, [4]int64{3, 3, 3, 3}, [4]int64{summary.Requests, summary.Errors, summary.Attempts, summary.AttemptErrors})
	assert.Equal(t, map[string]int64{ErrorClient: 1, ErrorEngineLimit: 1, ErrorEngineBudget: 1}, summary.Categories)
	assert.Equal(t, [2]int64{0, 0}, [2]int64{summary.EngineRejections, summary.UpstreamRateLimit})
	fee := got.channels[insightChannelKey{7, "grok-5"}]
	require.NotNil(t, fee)
	assert.Equal(t, [3]int64{0, 1, 500}, [3]int64{fee.row.Requests, fee.row.Errors, fee.row.Quota}, "the fee is money, not a served attempt")
	assert.Empty(t, fee.latency)
	assert.EqualValues(t, 500, got.users[alice.Id].Quota)
}

// While a range holds hours stored under the older version, the capacity
// view leaves out the figures they lack instead of summing part of the range,
// and each old hour carries no pool peak.
func TestCapacityLeavesOutWhatStaleHoursLack(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 3600 + 50, UseTime: 20, ChannelId: 2, ModelName: "opus", Other: `{}`}).Error)
	require.NoError(t, DB.Create(&InsightHour{HourStart: hour, Version: insightHourVersion - 1, Data: `{"requests":4,"errors":1,"peak":2}`}).Error)
	r := InsightsRange{Start: hour, End: hour + 2*3600}
	capacity, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.Equal(t, 1, capacity.StaleHours)
	assert.Nil(t, capacity.Attempts)
	assert.Nil(t, capacity.PoolPeak)
	require.Len(t, capacity.Hourly, 2)
	assert.Nil(t, capacity.Hourly[0].PoolPeak, "the old hour had no pool peak")
	assert.Equal(t, new(0), capacity.Hourly[1].PoolPeak)
	quality, err := GetQualityInsights(r, nil)
	require.NoError(t, err)
	assert.Nil(t, quality.Attempts)
	data, err := common.Marshal(capacity)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"stale_hours":1`)

	fresh, err := GetCapacityInsights(InsightsRange{Start: hour + 3600, End: hour + 2*3600}, "")
	require.NoError(t, err)
	data, err = common.Marshal(fresh)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"stale_hours":0`, "a version 5 server says so even with none")
}

// Requests refused before any channel, the risk gate's blocks and the async
// tasks' outcomes reach the quality view.
func TestQualityRefusalsAndTasks(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour1 = int64(1759248000)
			r := InsightsRange{Start: hour1, End: hour1 + 3*3600}
			alice := registerAffiliateTestUser(t, "alice", "")
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour1 + 100, UseTime: 10, ChannelId: 3, ModelName: "gpt-6", Other: `{}`},
				{UserId: alice.Id, Username: "alice", Type: LogTypeError, CreatedAt: hour1 + 200, ChannelId: 0, ModelName: "gpt-6",
					Content: NoChannelErrorContent(503, "vip")},
			}).Error)
			require.NoError(t, DB.Create(&[]RiskGateEvent{
				{CreatedAt: hour1 + 10, Stage: RiskGateStageHardRegex, Action: RiskGateActionBlocked},
				{CreatedAt: hour1 + 20, Stage: RiskGateStageHardRegex, Action: RiskGateActionBlocked},
				{CreatedAt: hour1 + 30, Stage: RiskGateStageDecision, Action: RiskGateActionBlocked},
				{CreatedAt: hour1 + 40, Stage: RiskGateStageDecision, Action: RiskGateActionObserved},
				{CreatedAt: hour1 - 10, Stage: RiskGateStageDecision, Action: RiskGateActionBlocked},
			}).Error)
			require.NoError(t, DB.Create(&[]Task{
				{TaskID: "q1", ChannelId: 9, Status: TaskStatusFailure, FailReason: "status_code=500, upstream died. Try later", SubmitTime: hour1 + 50,
					Properties: Properties{OriginModelName: "seedance"}},
				{TaskID: "q2", ChannelId: 9, Status: TaskStatusSuccess, SubmitTime: hour1 - 50, FinishTime: hour1 + 50,
					Properties: Properties{OriginModelName: "seedance"}},
			}).Error)

			quality, err := GetQualityInsights(r, []string{"seedance"})
			require.NoError(t, err)
			assert.Equal(t, &QualityRefusals{NoChannel: 1, RiskGate: 3, RiskGateStages: []NamedCount{
				{Name: RiskGateStageHardRegex, Count: 2}, {Name: RiskGateStageDecision, Count: 1},
			}}, quality.Refusals, "observe-mode hits and events outside the range are left out; the model filter does not narrow it")

			all, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			assert.EqualValues(t, 2, all.Requests)
			assert.EqualValues(t, 1, all.Errors, "a refusal is a failure the customer saw")
			assert.Equal(t, []NamedCount{{Name: ErrorNoChannel, Count: 1}}, all.ErrorCategories)
			assert.Equal(t, []NamedCount{{Name: "no_channel: no available channel in group vip", Count: 1}}, all.ErrorReasons)

			upstream, err := GetUpstreamInsights(r)
			require.NoError(t, err)
			for _, row := range upstream.Daily {
				assert.NotZero(t, row.ChannelID, "a refusal is in no channel's figures")
			}
			for _, row := range upstream.Models {
				assert.NotZero(t, row.ChannelID)
			}

			seedance := TaskOutcome{Model: "seedance", Submitted: 1, Failed: 1, FailureRate: 1, Reasons: []NamedCount{{Name: "upstream died", Count: 1}}}
			require.NotNil(t, all.Tasks)
			assert.Equal(t, []TaskOutcome{seedance}, all.Tasks.Models, "a task submitted before the range is left out")
			channel := seedance
			channel.Model, channel.ChannelID = "", 9
			assert.Equal(t, []TaskOutcome{channel}, all.Tasks.Channels)
			total := seedance
			total.Model = ""
			assert.Equal(t, total, all.Tasks.Total)
			assert.False(t, all.Tasks.Truncated)
		})
	}
}

// The activity view counts customers only, active on usage, and splits
// Claude's charge out.
func TestActivityLeavesRootOut(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int(common.QuotaPerUnit)
			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			carol := registerAffiliateTestUser(t, "carol", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: alice.Id, Username: "alice", ModelName: "claude-opus-5", CreatedAt: day1, Count: 2, Quota: 2 * dollar, TokenUsed: 20},
				{UserID: alice.Id, Username: "alice", ModelName: "gpt-6", CreatedAt: day1, Count: 1},
				// bob's only request came back with no usage.
				{UserID: bob.Id, Username: "bob", ModelName: "gpt-6", CreatedAt: day1, Count: 1},
				{UserID: carol.Id, Username: "carol", ModelName: "gpt-6", CreatedAt: day1 + 3600, Count: 1, Quota: dollar, TokenUsed: 10},
				{UserID: root.Id, Username: "root", ModelName: "claude-opus-5", CreatedAt: day1, Count: 9, Quota: 5 * dollar, TokenUsed: 90},
			}).Error)

			activity, err := GetActivityInsights(InsightsRange{Start: day1, End: day1 + 86400, Offset: 8 * 3600})
			require.NoError(t, err)
			assert.EqualValues(t, 2, activity.ActiveUsers, "bob had no usage, root is not a customer")
			assert.EqualValues(t, 5, activity.Requests)
			assert.Equal(t, 3.0, activity.QuotaUSD)
			assert.Equal(t, 2.0, activity.ClaudeQuotaUSD)
			assert.Equal(t, 5.0, activity.RootQuotaUSD)
			require.Len(t, activity.Daily, 1)
			assert.Equal(t, ActivityDay{Day: day1, DAU: 2, WAU: 2, Requests: 5, QuotaUSD: 3, ClaudeQuotaUSD: 2}, activity.Daily[0])
			assert.Equal(t, ActivityHour{Hour: day1, ActiveUsers: 1, Requests: 4, QuotaUSD: 2}, activity.Hourly[0])
			require.NotEmpty(t, activity.TopUsers)
			assert.Equal(t, alice.Id, activity.TopUsers[0].UserID)
			assert.Equal(t, 0.6667, activity.Top1Share)
			for _, user := range activity.TopUsers {
				assert.NotEqual(t, root.Id, user.UserID)
			}
		})
	}
}

func TestInsightHourSpansHours(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour1 = int64(1759248000)
			hour2 := hour1 + 3600
			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			// alice's request runs from 10 minutes before hour 2 to 10 minutes
			// into it; bob's starts 5 minutes into hour 2.
			logs := []Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour2 + 600, UseTime: 1200, ModelName: "opus", Other: `{}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeConsume, CreatedAt: hour2 + 900, UseTime: 600, ModelName: "opus", Other: `{}`},
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)
			capacity, err := GetCapacityInsights(InsightsRange{Start: hour1, End: hour2 + 3600}, "")
			require.NoError(t, err)
			require.Len(t, capacity.Hourly, 2)
			assert.Equal(t, CapacityHour{Hour: hour1, Requests: 1, PeakConcurrency: 1, PoolPeak: new(0)}, capacity.Hourly[0], "alice's request counts where it began")
			assert.Equal(t, CapacityHour{Hour: hour2, Requests: 1, PeakConcurrency: 2, PoolPeak: new(0)}, capacity.Hourly[1], "and is still in flight when bob's begins")
			assert.Equal(t, hour2+300, capacity.PeakAt)
			assert.Len(t, capacity.UserPeaks, 2)
		})
	}
}

func TestCapacitySplitsByVendor(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour1 = int64(1759248000)
			hour2 := hour1 + 3600
			alice := registerAffiliateTestUser(t, "alice", "")
			bob := registerAffiliateTestUser(t, "bob", "")
			// Two Claude requests overlap; a GPT request runs beside them, and a
			// Claude one from hour 1 is still in flight when hour 2 opens.
			logs := []Log{
				{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: hour2 + 600, UseTime: 1200, ModelName: "claude-opus-5-5", Other: `{}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeConsume, CreatedAt: hour2 + 900, UseTime: 600, ModelName: "claude-sonnet-5-5", Other: `{}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeConsume, CreatedAt: hour2 + 1000, UseTime: 600, ModelName: "gpt-6-luna", Other: `{}`},
				{UserId: bob.Id, Username: "bob", Type: LogTypeError, CreatedAt: hour2 + 1100, Content: "status_code=429, Credential concurrency limit exceeded.", ModelName: "gpt-6-luna"},
			}
			require.NoError(t, LOG_DB.Create(&logs).Error)
			r := InsightsRange{Start: hour1, End: hour2 + 3600}
			all, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.EqualValues(t, 4, all.Requests)
			assert.Equal(t, 3, all.PeakConcurrency)

			claude, err := GetCapacityInsights(r, VendorClaude)
			require.NoError(t, err)
			require.Len(t, claude.Hourly, 2)
			assert.Equal(t, CapacityHour{Hour: hour1, Requests: 1, PeakConcurrency: 1, PoolPeak: new(0)}, claude.Hourly[0])
			assert.Equal(t, CapacityHour{Hour: hour2, Requests: 1, PeakConcurrency: 2, PoolPeak: new(0)}, claude.Hourly[1], "the request from hour 1 is still in flight")
			assert.Equal(t, hour2+300, claude.PeakAt)
			assert.Empty(t, claude.UserPeaks, "users' peaks are not split by vendor")

			codex, err := GetCapacityInsights(r, VendorCodex)
			require.NoError(t, err)
			assert.EqualValues(t, 2, codex.Requests)
			assert.EqualValues(t, 1, codex.Errors)
			assert.Equal(t, 1, codex.PeakConcurrency, "the rejected request had no use time and ended as it began")
			assert.Equal(t, []NamedCount{{ErrorEngineConcurrency, 1}}, codex.ErrorCategories)
			assert.EqualValues(t, 1, codex.Hourly[1].EngineRejections)

			grok, err := GetCapacityInsights(r, VendorGrok)
			require.NoError(t, err)
			assert.Zero(t, grok.Requests)

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			assert.Equal(t, []NamedCount{{ErrorEngineConcurrency, 1}}, quality.ErrorCategories)
			gpt, err := GetQualityInsights(r, []string{"gpt-6-luna"})
			require.NoError(t, err)
			assert.Equal(t, codex.ErrorCategories, gpt.ErrorCategories, "one vendor's models narrow the categories to it")
			claudeOnly, err := GetQualityInsights(r, []string{"claude-opus-5-5", "claude-sonnet-5-5"})
			require.NoError(t, err)
			assert.Empty(t, claudeOnly.ErrorCategories)
			mixed, err := GetQualityInsights(r, []string{"claude-opus-5-5", "gpt-6-luna"})
			require.NoError(t, err)
			assert.Equal(t, quality.ErrorCategories, mixed.ErrorCategories, "models of several vendors keep every category")
		})
	}
}

func TestUserConcurrencyRejections(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const hour = int64(1759248000)
			alice := registerAffiliateTestUser(t, "alice", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))
			key := ConcurrencyRejectionKey{HourStart: hour, UserId: alice.Id}
			assert.Empty(t, AddUserConcurrencyRejections(map[ConcurrencyRejectionKey]int64{key: 2, {HourStart: hour, UserId: root.Id}: 9}))
			assert.Empty(t, AddUserConcurrencyRejections(map[ConcurrencyRejectionKey]int64{key: 3, {HourStart: hour + 3600, UserId: alice.Id}: 1}))
			points, users, err := ReadUserConcurrencyRejections(hour, hour+7200)
			require.NoError(t, err)
			assert.Equal(t, []CountPoint{{hour, 5}, {hour + 3600, 1}}, points, "counts add up and root is left out")
			assert.Equal(t, []UserCount{{UserRef{alice.Id, "alice"}, 6}}, users)
		})
	}
}

func TestHistogram(t *testing.T) {
	for value, key := range map[int64]int64{87: 87, 999: 1000, 1234: 1200, 1250: 1300, 45678: 46000} {
		assert.Equal(t, key, histogramKey(value), value)
	}
	h := histogram{}
	for _, value := range []int64{800, 1200, 3000, 3000} {
		h.add(value)
	}
	assert.EqualValues(t, 3000, h.percentile(0.5), "index 2 of four sorted values")
	assert.EqualValues(t, 800, h.percentile(0))
	assert.Equal(t, h, decodeHistogram(h.encode()))
	assert.Zero(t, histogram{}.percentile(0.5))
}

func TestOpenInsightHoursAreReusedWithinTTL(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	resetOpen := func() {
		openInsightHours.mu.Lock()
		openInsightHours.byStart = nil
		openInsightHours.mu.Unlock()
	}
	resetOpen()
	t.Cleanup(resetOpen)
	ttl, staleLimit := insightOpenHourTTL, insightOpenHourStaleLimit
	t.Cleanup(func() { insightOpenHourTTL, insightOpenHourStaleLimit = ttl, staleLimit })

	alice := registerAffiliateTestUser(t, "alice", "")
	now := time.Now().Unix()
	hour := now - now%3600
	r := InsightsRange{Start: hour, End: hour + 3600}
	logAt := func(at int64) {
		require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Username: "alice", Type: LogTypeConsume, CreatedAt: at, ModelName: "opus", Other: `{}`}).Error)
	}

	logAt(hour + 1)
	first, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.EqualValues(t, 1, first.Requests)

	logAt(hour + 2)
	cached, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.EqualValues(t, 1, cached.Requests, "an open hour computed within the TTL is reused")

	insightOpenHourTTL = 0
	stale, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.EqualValues(t, 1, stale.Requests, "an older hour within the stale limit is served at once")
	assert.Eventually(t, func() bool {
		openInsightHours.mu.Lock()
		defer openInsightHours.mu.Unlock()
		return openInsightHours.byStart[hour].hour.summary.Requests == 2
	}, 5*time.Second, 20*time.Millisecond, "and is recomputed in the background")

	logAt(hour + 3)
	insightOpenHourStaleLimit = 0
	fresh, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.EqualValues(t, 3, fresh.Requests, "an hour past the stale limit is read from the logs now")
}

func TestModelVendor(t *testing.T) {
	for model, vendor := range map[string]string{
		"claude-opus-5-5":       VendorClaude,
		"gpt-6.1-sol":           VendorCodex,
		"codex-auto-review":     VendorCodex,
		"grok-4.7":              VendorGrok,
		"gemini-3.8-flash-high": VendorGemini,
		"opus":                  VendorOther,
	} {
		assert.Equal(t, vendor, ModelVendor(model), model)
	}
}

// Image and video models are media, ahead of gpt- and grok-. Each name is
// one that exists: common.ImageGenerationModels, relay/channel/volcengine,
// plugins/tasks, and the media groups' plugin in corecode-infra
// (config/task-plugins/seedance-wan: seedance-2.5-720p, wan-3.0-480p).
func TestMediaVendorMatchesRealModels(t *testing.T) {
	names := []string{
		"gpt-image-1", "gpt-image-2.5-flare", "dall-e-3", "sora-2", "veo-3.0-generate-001", "imagen-4.0-generate-001",
		"grok-imagine-video", "grok-imagine-image", "seedance-1-0-pro-250528", "seedance-2.5-720p",
		"doubao-seedance-2-0-260128", "seedream-4-0-250828", "doubao-seedream-4-5-251128", "wan-3.0-480p",
		"wan2.7-image-pro", "wan3.0-video", "wanx2.1-t2i-turbo", "qwen-image-3.0", "kling-v3", "viduq3-pro",
		"MiniMax-Hailuo-02", "jimeng_v30",
	}
	for _, name := range names {
		assert.Equal(t, VendorMedia, ModelVendor(name), name)
	}
	for _, prefix := range VendorPrefixes(VendorMedia) {
		assert.True(t, slices.ContainsFunc(names, func(name string) bool { return strings.HasPrefix(name, prefix) }),
			"media prefix %q matches no real model", prefix)
	}
	assert.Equal(t, VendorCodex, ModelVendor("gpt-6"))
	assert.Equal(t, VendorGrok, ModelVendor("grok-4.7"))
}

// Uncached input is prompt tokens less the cache only where billing counts
// the cache inside them.
func TestUncachedPrompt(t *testing.T) {
	for _, tc := range []struct {
		name   string
		prompt int
		other  string
		want   int64
	}{
		{"OpenAI usage, recorded", 100_000, `{"cache_tokens":90000,"prompt_includes_cache":true}`, 10_000},
		{"Anthropic usage, recorded", 10, `{"cache_tokens":80,"cache_creation_tokens":10,"usage_semantic":"anthropic","claude":true,"prompt_includes_cache":false}`, 10},
		{"OpenAI usage, older log", 100, `{"cache_tokens":60,"cache_creation_tokens":30}`, 10},
		{"Anthropic usage, older log", 10, `{"cache_tokens":80,"usage_semantic":"anthropic"}`, 10},
		{"Claude log before usage_semantic", 10, `{"cache_tokens":80,"claude":true}`, 10},
		{"Claude-derived OpenAI usage, older log", 10, `{"cache_tokens":80,"cache_creation_tokens":20,"cache_creation_tokens_5m":20}`, 10},
		{"never below zero", 5, `{"cache_tokens":80,"prompt_includes_cache":true}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, uncachedPrompt(insightLog{PromptTokens: tc.prompt}, parseLogOther(tc.other)))
		})
	}
}

// A task's submit log is a request with no duration; its settlement delta
// and refund move money in their own hour and are no request; what paid is
// read from the log, a given plan from its flag even once the plan is gone.
func TestInsightHourTaskMoney(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	const next = hour + 3600
	dollar := int(common.QuotaPerUnit)
	alice := registerAffiliateTestUser(t, "alice", "")
	bob := registerAffiliateTestUser(t, "bob", "")
	carol := registerAffiliateTestUser(t, "carol", "")
	require.NoError(t, DB.Create(&Channel{Id: 9, Name: "media", Key: "k9"}).Error)
	const video = "seedance-2.5-720p"
	bought := `"billing_source":"subscription","subscription_id":41,"subscription_plan_id":5,"subscription_gift":false`
	// Subscription 999 no longer exists; only the flag says it was given.
	given := `"billing_source":"subscription","subscription_id":999,"subscription_plan_id":6,"subscription_gift":true`
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 100, ChannelId: 9, ModelName: video, Quota: 10 * dollar, Group: "media",
			Other: `{"is_task":true,"task_id":"t1","billing_source":"wallet"}`},
		{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: hour + 200, ChannelId: 9, ModelName: video, Quota: 6 * dollar, Group: "media",
			Other: `{"is_task":true,"task_id":"t2",` + bought + `}`},
		{UserId: carol.Id, Type: LogTypeConsume, CreatedAt: hour + 300, ChannelId: 9, ModelName: video, Quota: 4 * dollar, Group: "vip",
			Other: `{"is_task":true,"task_id":"t3",` + given + `}`},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 400, UseTime: 20, ChannelId: 3, ModelName: "gpt-6", Quota: 2 * dollar, Group: "default",
			Other: `{"billing_source":"wallet"}`},

		// The next hour: alice's task fails and is refunded in full, more
		// than she used in that hour; bob's settles $1 above its reservation;
		// carol's settles $1 below it.
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: next + 50, UseTime: 10, ChannelId: 3, ModelName: "gpt-6", Quota: 3 * dollar, Group: "default",
			Other: `{"billing_source":"wallet"}`},
		{UserId: alice.Id, Type: LogTypeRefund, CreatedAt: next + 100, ChannelId: 9, ModelName: video, Quota: 10 * dollar, Group: "media",
			Other: `{"is_task":true,"task_id":"t1","reason":"failed","billing_source":"wallet"}`},
		{UserId: bob.Id, Type: LogTypeConsume, CreatedAt: next + 200, ChannelId: 9, ModelName: video, Quota: dollar, Group: "media",
			Other: `{"is_task":true,"task_id":"t2","pre_consumed_quota":3000000,"actual_quota":3500000,` + bought + `}`},
		{UserId: carol.Id, Type: LogTypeConsume, CreatedAt: next + 300, UseTime: 5, ChannelId: 9, ModelName: "wan-3.0-480p", Quota: 3 * dollar, Group: "vip",
			Other: `{"is_task":true,"task_id":"t4",` + given + `}`},
		{UserId: carol.Id, Type: LogTypeRefund, CreatedAt: next + 400, ChannelId: 9, ModelName: video, Quota: dollar, Group: "vip",
			Other: `{"is_task":true,"task_id":"t3","pre_consumed_quota":2000000,"actual_quota":1500000,` + given + `}`},
	}).Error)

	type money struct{ Requests, Quota, Wallet, Gift int64 }
	usersOf := func(h *insightHour) map[int]money {
		users := map[int]money{}
		for id, u := range h.users {
			users[id] = money{u.Requests, u.Quota / int64(dollar), u.WalletQuota / int64(dollar), u.GiftQuota / int64(dollar)}
		}
		return users
	}
	groupsOf := func(h *insightHour) map[string]insightGroupUse {
		groups := map[string]insightGroupUse{}
		for name, g := range h.summary.Groups {
			groups[name] = insightGroupUse{g.Requests, g.Quota / int64(dollar)}
		}
		return groups
	}
	plansOf := func(h *insightHour) map[int]int64 {
		plans := map[int]int64{}
		for id, quota := range h.summary.Plans {
			plans[id] = quota / int64(dollar)
		}
		return plans
	}
	check := func(t *testing.T, hours []*insightHour) {
		require.Len(t, hours, 2)
		first, second := hours[0], hours[1]
		assert.EqualValues(t, 4, first.summary.Requests, "three submissions and a request")
		assert.Equal(t, map[int]money{
			alice.Id: {2, 12, 12, 0},
			bob.Id:   {1, 6, 0, 0},
			carol.Id: {1, 4, 0, 4},
		}, usersOf(first), "a plan-paid task is the plan's; a deleted given plan is still a gift")
		assert.Equal(t, map[string]insightGroupUse{"media": {2, 16}, "vip": {1, 4}, "default": {1, 2}}, groupsOf(first))
		assert.Equal(t, map[int]int64{5: 6, 6: 4}, plansOf(first))

		assert.EqualValues(t, 2, second.summary.Requests, "a settlement or refund is no request")
		assert.EqualValues(t, 2, second.summary.Attempts)
		assert.Equal(t, map[int]money{
			alice.Id: {1, -7, -7, 0},
			bob.Id:   {0, 1, 0, 0},
			carol.Id: {1, 2, 0, 2},
		}, usersOf(second), "alice's $10 refund outweighs her $3 and is kept whole")
		assert.Equal(t, map[string]insightGroupUse{"media": {0, -9}, "vip": {1, 2}, "default": {1, 3}}, groupsOf(second))
		assert.Equal(t, map[int]int64{5: 1, 6: 2}, plansOf(second))
		assert.Equal(t, 1, second.summary.Peak, "a settlement or refund holds no slot")
	}

	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	first, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	second, err := computeInsightHour(next, scope)
	require.NoError(t, err)
	check(t, []*insightHour{first, second})
	assert.Empty(t, first.models[video].latency, "a submission has no duration")
	assert.Equal(t, histogram{20: 1}, first.models["gpt-6"].latency)
	assert.Empty(t, first.channels[insightChannelKey{9, video}].latency)
	assert.Equal(t, [2]int64{3, 20}, [2]int64{first.channels[insightChannelKey{9, video}].row.Requests, first.channels[insightChannelKey{9, video}].row.Quota / int64(dollar)})
	videoChannel := second.channels[insightChannelKey{9, video}]
	assert.Equal(t, [2]int64{0, -10}, [2]int64{videoChannel.row.Requests, videoChannel.row.Quota / int64(dollar)},
		"the channel's revenue falls by the whole refunds, and settlements are no request")

	// Stored and read back, the groups and plans are the same.
	r := InsightsRange{Start: hour, End: next + 3600}
	_, err = loadInsightHours(r)
	require.NoError(t, err)
	var stored int64
	require.NoError(t, DB.Model(&InsightHour{}).Where("version = ?", insightHourVersion).Count(&stored).Error)
	require.EqualValues(t, 2, stored)
	reloaded, err := loadInsightHours(r)
	require.NoError(t, err)
	check(t, reloaded)

	// Over both hours each refund cancels its charge: alice paid $2 + $3 net,
	// bob $7, carol $6, and channel 9 earned $10 + $3.
	finance, err := GetFinanceInsights(r)
	require.NoError(t, err)
	assert.InDelta(t, 18, finance.ConsumptionUSD, 1e-9)
	assert.InDelta(t, 11, finance.GiftConsumptionUSD, 1e-9, "carol's given plan net of its refund, and alice's unpaid wallet net of hers")
	upstream, err := GetUpstreamInsights(r)
	require.NoError(t, err)
	revenue := map[int]float64{}
	for _, channel := range upstream.Channels {
		revenue[channel.ID] = channel.RevenueUSD
	}
	assert.InDelta(t, 13, revenue[9], 1e-9)
}

// The funds view states what running plans owe, each plan's movement, the
// checkouts by method, use by billing group and credit given outside
// top-ups; it counts an order when it was paid and a top-up's bonus as
// unpaid credit.
func TestFinancePlansOrdersAndGroups(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			const day = int64(86400)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*day}
			now := r.End
			previousSignup := common.QuotaForNewUser
			common.QuotaForNewUser = int(dollar / 2)
			t.Cleanup(func() { common.QuotaForNewUser = previousSignup })

			payer := registerAffiliateTestUser(t, "payer", "")
			renewer := registerAffiliateTestUser(t, "renewer", "")
			guest := registerAffiliateTestUser(t, "guest", "")
			root := &User{Username: "root", DisplayName: "root", Role: common.RoleRootUser, Status: common.UserStatusEnabled}
			require.NoError(t, root.Insert(0))

			monthly := SubscriptionPlan{Title: "monthly", PriceAmount: 30, Enabled: true, QuotaResetPeriod: SubscriptionResetNever}
			daily := SubscriptionPlan{Title: "daily", PriceAmount: 10, Enabled: true, MaxPurchasePerUser: 1, QuotaResetPeriod: SubscriptionResetDaily}
			require.NoError(t, DB.Create(&monthly).Error)
			require.NoError(t, DB.Create(&daily).Error)

			// The payer paid 20 for $20 and a $5 bonus, so each wallet dollar
			// carries 0.8 and a fifth of it is unpaid. The guest's top-up was
			// opened before the range and paid in it; another was paid after it.
			require.NoError(t, DB.Create(&[]TopUp{
				{UserId: payer.Id, Amount: 20, Money: 20, BonusQuota: 5 * dollar, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: day1 + 100, CompleteTime: day1 + 200},
				{UserId: guest.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusPending, TradeNo: "T2", CreateTime: day1 + 200},
				{UserId: guest.Id, Amount: 10, Money: 10, PaymentMethod: "stripe", Status: common.TopUpStatusExpired, TradeNo: "T3", CreateTime: day1 + 300},
				{UserId: guest.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusPending, TradeNo: "T4", CreateTime: now - 60},
				{UserId: guest.Id, Amount: 5, Money: 5, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T5", CreateTime: day1 - 100, CompleteTime: day1 + 50},
				{UserId: guest.Id, Amount: 7, Money: 7, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T6", CreateTime: day1 + 500, CompleteTime: now + 100},
				{UserId: renewer.Id, Money: 30, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "S1", CreateTime: day1 + 3600, CompleteTime: day1 + 3600},
			}).Error)
			require.NoError(t, DB.Create(&[]SubscriptionOrder{
				{UserId: renewer.Id, PlanId: monthly.Id, Money: 30, TradeNo: "S0", PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CreateTime: day1 - 29*day, CompleteTime: day1 - 29*day},
				{UserId: renewer.Id, PlanId: monthly.Id, Money: 30, TradeNo: "S1", PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CreateTime: day1 + 3600, CompleteTime: day1 + 3600},
				{UserId: payer.Id, PlanId: daily.Id, Money: 10, TradeNo: "SB", PaymentMethod: PaymentMethodBalance, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess,
					CreateTime: day1, CompleteTime: day1, ProviderPayload: "charged_quota=" + strconv.FormatInt(10*dollar, 10)},
				{UserId: guest.Id, PlanId: monthly.Id, Money: 30, TradeNo: "S2", PaymentMethod: "wxpay", Status: common.TopUpStatusPending, CreateTime: day1 + 400},
				{UserId: root.Id, PlanId: monthly.Id, Money: 30, TradeNo: "SR", PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CreateTime: day1 - day, CompleteTime: day1 - day},
			}).Error)
			for _, subscription := range []UserSubscription{
				// The renewer's first month ended in the range, half used; the
				// second was bought an hour into it.
				{UserId: renewer.Id, PlanId: monthly.Id, AmountTotal: 30 * dollar, AmountUsed: 15 * dollar, StartTime: day1 - 29*day, EndTime: day1 + day, Status: "expired", Source: "order"},
				{UserId: renewer.Id, PlanId: monthly.Id, AmountTotal: 30 * dollar, AmountUsed: 3 * dollar, StartTime: day1 + 3600, EndTime: day1 + 3600 + 30*day, Status: "active", Source: "order"},
				// The payer's plan runs five days and resets daily.
				{UserId: payer.Id, PlanId: daily.Id, AmountTotal: 10 * dollar, AmountUsed: 4 * dollar, StartTime: day1, EndTime: day1 + 5*day, Status: "active", Source: PaymentMethodBalance},
				{UserId: guest.Id, PlanId: monthly.Id, AmountTotal: 30 * dollar, AmountUsed: 10 * dollar, StartTime: day1, EndTime: day1 + 10*day, Status: "active", Source: "admin"},
				{UserId: root.Id, PlanId: monthly.Id, AmountTotal: 30 * dollar, StartTime: day1 - day, EndTime: day1 + 29*day, Status: "active", Source: "order"},
			} {
				require.NoError(t, DB.Create(&subscription).Error)
			}
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: payer.Id, Username: "payer", Type: LogTypeConsume, CreatedAt: day1 + 1000, ModelName: "opus", Quota: int(5 * dollar), Other: `{"billing_source":"wallet"}`},
				{UserId: guest.Id, Username: "guest", Type: LogTypeSystem, CreatedAt: day1 + 20, Content: "New user sign-up bonus ¥0.500000"},
			}).Error)
			require.NoError(t, DB.Create(&Checkin{UserId: payer.Id, CheckinDate: "2025-10-01", QuotaAwarded: int(dollar), CreatedAt: day1 + 10}).Error)
			require.NoError(t, DB.Create(&[]QuotaData{
				{UserID: payer.Id, Username: "payer", ModelName: "opus", UseGroup: "default", CreatedAt: day1, Count: 2, Quota: int(3 * dollar), TokenUsed: 10},
				{UserID: renewer.Id, Username: "renewer", ModelName: "gpt-6-sol", UseGroup: "codex-only", CreatedAt: day1, Count: 1, Quota: int(2 * dollar), TokenUsed: 5, CacheReadTokens: 5},
				{UserID: root.Id, Username: "root", ModelName: "opus", UseGroup: "default", CreatedAt: day1, Count: 9, Quota: int(9 * dollar)},
			}).Error)

			finance, err := financeInsightsAt(r, now)
			require.NoError(t, err)
			assert.Equal(t, 25.0, finance.TopupRevenue, "T1, and T5 paid in the range; T6 was paid after it")
			assert.Equal(t, 30.0, finance.SubscriptionRevenue)
			assert.Equal(t, 5.0, finance.BonusUSD)
			assert.Equal(t, 1.0, finance.GiftConsumptionUSD, "the bonus fifth of the payer's 5 is unpaid")
			assert.Equal(t, 4.0, finance.RecognizedWalletRevenue, "the bonus still lowers the price: 5 at 0.8")

			// 30 over 30 days with 28 days and an hour left; 8 of balance over
			// five days with three left. Root's plan is not owed to a customer.
			assert.Equal(t, PlanLiability{
				At: now, DeferredValue: 32.84, PaidPlans: 2, PaidUsers: 2, GiftPlans: 1,
				PaidQuotaLeftUSD: 27, GiftQuotaLeftUSD: 20, PaidPeriodLeftUSD: 6,
			}, finance.PlanLiability)
			assert.Equal(t, []PlanBookRow{
				{PlanID: monthly.Id, Title: "monthly", Price: 30, RunningPaid: 1, RunningGifted: 1, Sold: 1, SoldValue: 30, Renewed: 1, Gifted: 1,
					Expired: 1, DeferredValue: 28.04, FinishedPlans: 1, FinishedUsedShare: 0.5},
				{PlanID: daily.Id, Title: "daily", Price: 10, OnePerUser: true, RunningPaid: 1, Sold: 1, SoldValue: 8,
					ExpiringSoon: 1, ExpiringValue: 4.8, DeferredValue: 4.8},
			}, finance.PlanBook, "running plans first")

			assert.Equal(t, []OrderMethodFunnel{
				{PaymentMethod: "alipay", Created: 5, Paid: 3, Pending: 2, PendingStale: 1, PlanOrders: 1, PaidMoney: 57, CompletionRate: 0.6},
				{PaymentMethod: "stripe", Created: 1, Expired: 1},
				{PaymentMethod: "wxpay", Created: 1, Pending: 1, PendingStale: 1, PlanOrders: 1},
			}, finance.OrderMethods, "a paid plan order counts once though top_ups holds it too; wallet-paid and earlier ones are left out")

			revenue := finance.RecognizedRevenue
			require.Len(t, finance.Groups, 2)
			assert.InDelta(t, 0.6*revenue, finance.Groups[0].RevenueEstimate, 0.011, "recognized revenue shared by consumption")
			assert.InDelta(t, 0.4*revenue, finance.Groups[1].RevenueEstimate, 0.011)
			finance.Groups[0].RevenueEstimate, finance.Groups[1].RevenueEstimate = 0, 0
			assert.Equal(t, []GroupConsumption{
				{Group: "default", Requests: 2, Users: 1, Tokens: 10, ConsumptionUSD: 3, Share: 0.6, Ratio: 1, ListUSD: 3},
				{Group: "codex-only", Requests: 1, Users: 1, Tokens: 10, ConsumptionUSD: 2, Share: 0.4},
			}, finance.Groups, "root's use is left out; a group without a ratio has no list price")

			assert.Equal(t, 1.0, finance.CheckinCreditUSD)
			assert.EqualValues(t, 1, finance.SignupBonuses)
			assert.Equal(t, 0.5, finance.SignupCreditEstimateUSD)
			assert.Zero(t, finance.InviteeBonuses)
		})
	}
}

// A bill splits by the model it names and its remainder by revenue; a fee
// by revenue; a channel with neither leaves its revenue uncosted.
func TestVendorUpstreamCosts(t *testing.T) {
	upstream := &UpstreamInsights{
		Channels: []UpstreamChannel{
			{ID: 1, CostSource: UpstreamCostSourceUpstream, CostUSD: 10, LatestCostAt: 100},
			{ID: 2, CostSource: UpstreamCostSourceFee, CostUSD: 4},
			{ID: 3, CostSource: UpstreamCostSourceNone},
			{ID: 4, CostSource: UpstreamCostSourceFee, CostUSD: 2},
		},
		Models: []UpstreamModel{
			{Model: "gpt-a", ChannelID: 1, RevenueUSD: 6, CostUSD: 7},
			{Model: "claude-x", ChannelID: 1, RevenueUSD: 2},
			{Model: "gpt-b", ChannelID: 2, RevenueUSD: 1},
			{Model: "grok-c", ChannelID: 2, RevenueUSD: 3},
			{Model: "claude-y", ChannelID: 3, RevenueUSD: 5},
		},
	}
	rows, bill, fee := vendorUpstreamCosts(upstream)
	assert.Equal(t, []VendorUpstreamCost{
		{Vendor: VendorCodex, BillUSD: 9.25, FeeUSD: 1, CostedRevenueUSD: 7, OldestBillAt: 100, Channels: []int{1, 2}},
		{Vendor: VendorGrok, FeeUSD: 3, CostedRevenueUSD: 3, Channels: []int{2}},
		{Vendor: VendorClaude, BillUSD: 0.75, CostedRevenueUSD: 2, UncostedRevenueUSD: 5, OldestBillAt: 100, Channels: []int{1}},
	}, rows, "7 named, 3 left shared 6 to 2; the fee 1 to 3")
	assert.Zero(t, bill)
	assert.Equal(t, 2.0, fee, "a fee on a channel that served nothing")
}

// A stored hour of an older version is served as it is and counted stale; the
// task rebuilds it while its logs last and keeps it once they are gone. A
// final hour with no stored row is still computed and stored on demand.
func TestOldVersionHoursAreServedThenRebuilt(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			now := time.Now().Unix()
			base := now - now%3600 - 10*3600
			logsGone := base - 5*3600
			alice := registerAffiliateTestUser(t, "alice", "")
			old := insightHourVersion - 1
			require.NoError(t, DB.Create(&[]InsightHour{
				{HourStart: base, Version: old, Data: `{"requests":7,"errors":1,"peak":3,"peak_at":` + strconv.FormatInt(base+60, 10) + `}`},
				{HourStart: logsGone, Version: old, Data: `{"requests":4}`},
			}).Error)
			require.NoError(t, DB.Create(&InsightUserHour{HourStart: base, UserId: alice.Id, Requests: 7, Quota: 700, WalletQuota: 700}).Error)
			// The earliest log starts the stale hour, so its logs are whole;
			// the hour after it has no stored row.
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: base, ModelName: "claude-opus-5", Quota: 50, Other: `{}`},
				{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: base + 3600 + 100, UseTime: 10, ModelName: "claude-opus-5", Quota: 30, Other: `{}`},
			}).Error)
			r := InsightsRange{Start: logsGone, End: base + 2*3600}
			versions := func() map[int64]int {
				var rows []InsightHour
				require.NoError(t, DB.Where("hour_start IN ?", []int64{logsGone, base, base + 3600}).Find(&rows).Error)
				got := make(map[int64]int, len(rows))
				for _, row := range rows {
					got[row.HourStart] = row.Version
				}
				return got
			}

			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.Equal(t, 2, capacity.StaleHours)
			assert.EqualValues(t, 7+4+1, capacity.Requests, "the stale hours as stored and the missing one computed")
			assert.Equal(t, [2]int64{3, base + 60}, [2]int64{int64(capacity.PeakConcurrency), capacity.PeakAt})
			require.Len(t, capacity.UserPeaks, 1)
			assert.EqualValues(t, 8, capacity.UserPeaks[0].Requests, "the stale hour's user row is read too")
			assert.Equal(t, map[int64]int{logsGone: old, base: old, base + 3600: insightHourVersion}, versions(),
				"a view stores the missing hour and recomputes no stale one")
			var data string
			require.NoError(t, DB.Model(&InsightHour{}).Where("hour_start = ?", base).Pluck("data", &data).Error)
			assert.Contains(t, data, `"requests":7`)
			for _, view := range []func() (int, error){
				func() (int, error) { got, err := GetQualityInsights(r, nil); return got.StaleHours, err },
				func() (int, error) { got, err := GetFinanceInsights(r); return got.StaleHours, err },
				func() (int, error) { got, err := GetUpstreamInsights(r); return got.StaleHours, err },
				func() (int, error) { got, err := GetChannelInsights(r); return got.StaleHours, err },
				func() (int, error) { got, err := GetBusinessInsights(r); return got.StaleHours, err },
			} {
				stale, err := view()
				require.NoError(t, err)
				assert.Equal(t, 2, stale)
			}

			// An older-version row stored minutes ago means a server of the
			// last release may still be running: the missing hours are filled
			// and nothing is rebuilt yet.
			_, err = FillInsightHours(1, 1000)
			require.NoError(t, err)
			assert.Equal(t, map[int64]int{logsGone: old, base: old, base + 3600: insightHourVersion}, versions())

			allowInsightRebuild(t)
			filled, err := FillInsightHours(1, 1000)
			require.NoError(t, err)
			assert.Equal(t, 1, filled)
			assert.Equal(t, map[int64]int{logsGone: old, base: insightHourVersion, base + 3600: insightHourVersion}, versions(),
				"the hour whose logs are whole is rebuilt; the one whose logs are gone is kept")
			again, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			assert.Equal(t, 1, again.StaleHours)
			assert.EqualValues(t, 4+1+1, again.Requests)
			require.Len(t, again.UserPeaks, 1)
			assert.EqualValues(t, 2, again.UserPeaks[0].Requests, "the rebuilt hour replaced its user rows")
			filled, err = FillInsightHours(1, 1000)
			require.NoError(t, err)
			assert.Zero(t, filled, "nothing is left to rebuild")
		})
	}
}

// allowInsightRebuild lifts the wait the rollup task keeps while a server of
// the last release may still be running.
func allowInsightRebuild(t *testing.T) {
	t.Helper()
	delay, quiet := insightRebuildStartDelay, insightRebuildQuiet
	insightRebuildStartDelay, insightRebuildQuiet = 0, 0
	t.Cleanup(func() { insightRebuildStartDelay, insightRebuildQuiet = delay, quiet })
}

// The rebuild waits out a server of the last release: this process must have
// run a while, and no older-version row may have been stored lately.
func TestInsightRebuildWaitsForTheOldServer(t *testing.T) {
	now := common.StartTime + insightRebuildStartDelay
	old := insightHourVersion - 1
	assert.True(t, insightRebuildHeld(nil, now-1), "just started")
	assert.False(t, insightRebuildHeld(nil, now))
	assert.True(t, insightRebuildHeld([]InsightHour{{Version: old, CreatedAt: now - insightRebuildQuiet + 1}}, now),
		"an older server stored a row within the quiet time")
	assert.False(t, insightRebuildHeld([]InsightHour{{Version: old, CreatedAt: now - insightRebuildQuiet}}, now))
	assert.False(t, insightRebuildHeld([]InsightHour{{Version: insightHourVersion, CreatedAt: now}}, now),
		"this version's own rows do not hold it")
}

// The task rebuilds stale hours newest first, within its limit, after the
// missing ones.
func TestFillInsightHoursRebuildsNewestFirst(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	now := time.Now().Unix()
	newest := now - now%3600
	for !insightHourFinal(newest, now) {
		newest -= 3600
	}
	first := newest - 3*3600
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: first, ModelName: "opus", Other: `{}`}).Error)
	rows := []InsightHour{}
	for start := first; start <= newest; start += 3600 {
		rows = append(rows, InsightHour{HourStart: start, Version: insightHourVersion - 1, Data: `{}`})
	}
	// Hours before the first log are already stored, so nothing is missing.
	for start := first - insightHourLookahead; start < first; start += 3600 {
		rows = append(rows, InsightHour{HourStart: start, Version: insightHourVersion, Data: `{}`})
	}
	require.NoError(t, DB.Create(&rows).Error)

	allowInsightRebuild(t)
	filled, err := FillInsightHours(1, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, filled)
	var rebuilt []int64
	require.NoError(t, DB.Model(&InsightHour{}).Where("hour_start >= ? AND version = ?", first, insightHourVersion).Order("hour_start").Pluck("hour_start", &rebuilt).Error)
	assert.Equal(t, []int64{newest - 3600, newest}, rebuilt)
}

// The finance view computes upstream costs from the hours it already loaded:
// the rollup's user-hour rows are read once per request, not once for the
// finance figures and again for the upstream view.
func TestFinanceInsightsReadsHourRollupOnce(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	r := InsightsRange{Start: day1, End: day1 + 2*86400, Offset: 8 * 3600}
	var userHourReads int
	const callback = "test:count_user_hour_reads"
	require.NoError(t, DB.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "insight_user_hours" {
			userHourReads++
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Query().Remove(callback)) })

	_, err := GetFinanceInsights(r)
	require.NoError(t, err)
	assert.LessOrEqual(t, userHourReads, 1, "the hour rollup is loaded once for the finance view")
}
