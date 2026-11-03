package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func useInsightsTestDB(t *testing.T, dialect string) {
	t.Helper()
	useAffiliateTestDB(t, dialect)
	extra := []any{&QuotaData{}, &AuditLog{}, &Redemption{}, &InsightHour{}, &InsightUserHour{}, &InsightModelHour{}, &UserConcurrencyRejection{}}
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
					Other: `{"frt":800,"cache_tokens":80,"cache_creation_tokens":10,"stream_status":{"end_reason":"eof"},"admin_info":{"client":"claude-cli/2.1.3"}}`},
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

			capacity, err := GetCapacityInsights(r)
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
			again, err := GetCapacityInsights(r)
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

			risk, err := GetRiskInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 3, risk.Signups, "root is outside the range")
			assert.Equal(t, "hour", risk.SeriesUnit)
			assert.EqualValues(t, 1, risk.AliasEmails, "dots in a Gmail address")
			assert.EqualValues(t, 1, risk.OffWhitelist)
			assert.ElementsMatch(t, []NamedCount{{"oidc", 1}, {"email", 1}, {"linuxdo", 1}}, risk.SignupMethods)
			require.Len(t, risk.SharedIPs, 1)
			assert.Equal(t, "1.1.1.1", risk.SharedIPs[0].IP)
			assert.Len(t, risk.SharedIPs[0].Users, 2)
			assert.Equal(t, 1, risk.SharedIPs[0].SubscriptionBuyers)
			assert.Equal(t, []BalanceUser{{UserRef{bob.Id, "bob"}, -2}}, risk.Debtors)

			growth, err := GetGrowthInsights(r)
			require.NoError(t, err)
			assert.Equal(t, FunnelRow{Segment: "all", Registered: 3, Activated: 2, Paid: 2, Repeat: 1}, growth.Funnel)
			assert.Equal(t, []FunnelRow{
				{Segment: "organic", Registered: 2, Activated: 1, Paid: 1, Repeat: 1},
				{Segment: "invited", Registered: 1, Activated: 1, Paid: 1},
			}, growth.ByInvite)
			assert.EqualValues(t, 1, growth.SubscriptionBuyers)
			assert.Zero(t, growth.SubscriptionToTopup)

			activity, err := GetActivityInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 2, activity.ActiveUsers)
			require.Len(t, activity.Daily, 2)
			assert.Equal(t, ActivityDay{Day: day1, DAU: 2, WAU: 2, Requests: 3, QuotaUSD: 3}, activity.Daily[0])
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
		"status_code=429, Credential concurrency limit exceeded.": ErrorEngineConcurrency,
		"status_code=429, Claude upstream rate limit was reached": ErrorUpstreamRateLimit,
		"status_code=529, Claude upstream service failed":         ErrorUpstreamOverload,
		"status_code=502, bad gateway":                            ErrorUpstream,
		"status_code=400, invalid request":                        ErrorClient,
		"something else":                                          ErrorOther,
	} {
		assert.Equal(t, want, classifyErrorLog(content), content)
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
			capacity, err := GetCapacityInsights(InsightsRange{Start: hour1, End: hour2 + 3600})
			require.NoError(t, err)
			require.Len(t, capacity.Hourly, 2)
			assert.Equal(t, CapacityHour{Hour: hour1, Requests: 1, PeakConcurrency: 1}, capacity.Hourly[0], "alice's request counts where it began")
			assert.Equal(t, CapacityHour{Hour: hour2, Requests: 1, PeakConcurrency: 2}, capacity.Hourly[1], "and is still in flight when bob's begins")
			assert.Equal(t, hour2+300, capacity.PeakAt)
			assert.Len(t, capacity.UserPeaks, 2)
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
	first, err := GetCapacityInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 1, first.Requests)

	logAt(hour + 2)
	cached, err := GetCapacityInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 1, cached.Requests, "an open hour computed within the TTL is reused")

	insightOpenHourTTL = 0
	stale, err := GetCapacityInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 1, stale.Requests, "an older hour within the stale limit is served at once")
	assert.Eventually(t, func() bool {
		openInsightHours.mu.Lock()
		defer openInsightHours.mu.Unlock()
		return openInsightHours.byStart[hour].hour.summary.Requests == 2
	}, 5*time.Second, 20*time.Millisecond, "and is recomputed in the background")

	logAt(hour + 3)
	insightOpenHourStaleLimit = 0
	fresh, err := GetCapacityInsights(r)
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
