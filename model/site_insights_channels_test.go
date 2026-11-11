package model

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelInsightsDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			require.NoError(t, DB.AutoMigrate(&Option{}))
			t.Cleanup(func() { require.NoError(t, DB.Migrator().DropTable(&Option{})) })
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })

			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 2*86400}

			channel := registerAffiliateTestUser(t, "magpie", "")
			require.NoError(t, DB.Create(&Affiliate{UserId: channel.Id, Rate: 10, Channel: true, Tier: "retail"}).Error)
			payer := registerAffiliateTestUser(t, "payer", channel.AffCode)
			gifted := registerAffiliateTestUser(t, "gifted", channel.AffCode)
			referred := registerAffiliateTestUser(t, "referred", payer.AffCode)
			organic := registerAffiliateTestUser(t, "organic", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", channel.Id).Update("created_at", day1-30*86400).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", payer.Id).Updates(map[string]any{"created_at": day1 + 60, "request_count": 3}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", gifted.Id).Updates(map[string]any{"created_at": day1 - 86400, "quota": 6 * dollar, "request_count": 1}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", referred.Id).Update("created_at", day1+100).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", organic.Id).Update("created_at", day1+200).Error)

			// The payer tops up and buys a plan; the plan's order also writes a
			// top-up row with no credit, which is told apart by its trade number.
			plan := SubscriptionPlan{Title: "trial", PriceAmount: 29.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&plan).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: payer.Id, PlanId: plan.Id, Money: 29.9, TradeNo: "SUB1", Status: common.TopUpStatusSuccess, CreateTime: day1 + 300}).Error)
			// The gifted account, created before the range, buys a plan in it:
			// the channel's revenue, but not from a new account.
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: gifted.Id, PlanId: plan.Id, Money: 5, TradeNo: "SUB2", Status: common.TopUpStatusSuccess, CreateTime: day1 + 900}).Error)
			require.NoError(t, DB.Create(&[]TopUp{
				{UserId: payer.Id, Amount: 50, Money: 50, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: day1 + 200},
				{UserId: payer.Id, Money: 29.9, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "SUB1", CreateTime: day1 + 300},
				{UserId: gifted.Id, Money: 5, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "SUB2", CreateTime: day1 + 900},
				{UserId: organic.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T2", CreateTime: day1 + 400},
			}).Error)

			// The gifted account got the channel's plan and an administrator's
			// six dollars, and spent one dollar of the plan.
			gift := UserSubscription{UserId: gifted.Id, PlanId: plan.Id, AmountTotal: 3 * dollar, AmountUsed: dollar,
				StartTime: day1 + 10, EndTime: time.Now().Unix() + 86400, Status: "active", Source: SubscriptionSourceAffiliateGift}
			require.NoError(t, DB.Create(&gift).Error)
			require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", gift.Id).Update("created_at", day1+10).Error)
			require.NoError(t, LOG_DB.Create(&AuditLog{
				EventId: "e1", Username: "root", CreatedAt: day1 + 500, Action: "user.quota_add", Success: true, Category: AuditCategoryOperation,
				Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{
					"target_user_id": gifted.Id, "mode": "add", "requested_quota": 6 * dollar, "from": 0, "to": 6 * dollar,
				}}},
			}).Error)
			require.NoError(t, LOG_DB.Create(&[]Log{
				{UserId: payer.Id, Username: "payer", Type: LogTypeConsume, CreatedAt: day1 + 600, ModelName: "opus", Quota: int(2 * dollar), Other: `{}`},
				{UserId: gifted.Id, Username: "gifted", Type: LogTypeConsume, CreatedAt: day1 + 700, ModelName: "opus", Quota: int(dollar),
					Other: `{"billing_source":"subscription","subscription_id":` + strconv.Itoa(gift.Id) + `}`},
			}).Error)
			require.NoError(t, DB.Create(&AffiliateCommission{UserId: channel.Id, SourceUserId: payer.Id, Level: 1, Rate: 10, Amount: dollar, CreatedAt: day1 + 800}).Error)

			// Thirty dollars a month from before the range: two days of it fall in.
			require.Error(t, SaveChannelCosts([]ChannelCost{{UserID: channel.Id, MonthlyUSD: 30, Start: day1, End: day1}}))
			require.NoError(t, SaveChannelCosts([]ChannelCost{{UserID: channel.Id, MonthlyUSD: 30, Start: day1 - 10*86400, Note: " monthly "}}))
			costs, err := ReadChannelCosts()
			require.NoError(t, err)
			assert.Equal(t, []ChannelCost{{UserID: channel.Id, MonthlyUSD: 30, Start: day1 - 10*86400, Note: "monthly"}}, costs)

			insights, err := GetChannelInsights(r)
			require.NoError(t, err)
			require.Len(t, insights.Channels, 3)
			assert.Equal(t, ChannelRow{
				Segment: ChannelSegmentChannel, Channel: UserRef{channel.Id, "magpie"}, Tier: "retail",
				Accounts: 2, Registered: 1, Activated: 1, Paid: 1, Repeat: 1,
				Revenue: 84.9, RevenueNewAccounts: 79.9, Payers: 2, NewPayers: 2,
				ConsumptionUSD: 3, GiftConsumptionUSD: 1, GrantedUSD: 9, GiftOutstandingUSD: 8,
				CommissionUSD: 1, FeeUSD: 2,
			}, insights.Channels[0])
			assert.Equal(t, ChannelRow{Segment: ChannelSegmentInvited, Accounts: 1, Registered: 1}, insights.Channels[1],
				"an invitation that is not a channel's")
			// The channel's own account is organic: nobody invited it.
			assert.Equal(t, ChannelRow{Segment: ChannelSegmentOrganic, Accounts: 2, Registered: 1, Paid: 1, Revenue: 10, RevenueNewAccounts: 10, Payers: 1, NewPayers: 1}, insights.Channels[2])
		})
	}
}
