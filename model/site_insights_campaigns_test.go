package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The campaigns view costs each way of winning a customer and follows the people
// it reached to what they paid afterwards. Dollars are 500,000 quota here.
func TestCampaignInsightsFollowEachCohortToItsPayments(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })
			const day1 = int64(1759190400)
			const dollar = int64(affiliateDollar)
			r := InsightsRange{Start: day1, End: day1 + 7*86400}
			now := common.GetTimestamp()

			channel := registerAffiliateTestUser(t, "magpie", "")
			inviteGift := registerAffiliateTestUser(t, "gifted", "")
			buyer := registerAffiliateTestUser(t, "buyer", "")
			idle := registerAffiliateTestUser(t, "idle", "")
			forum := registerAffiliateTestUser(t, "forum", "")
			raffle := registerAffiliateTestUser(t, "raffle", "")
			refund := registerAffiliateTestUser(t, "refund", "")
			enterprise := registerAffiliateTestUser(t, "enterprise", "")
			staff := registerAffiliateTestUser(t, "staff", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", staff.Id).Update("role", common.RoleAdminUser).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", forum.Id).Update("quota", dollar).Error)

			newcomer := SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, MaxPurchasePerUser: 1, Enabled: true, TotalAmount: 50 * dollar}
			free := SubscriptionPlan{Title: "invite", PriceAmount: 0, MaxPurchasePerUser: 1, Enabled: true, TotalAmount: 3 * dollar}
			require.NoError(t, DB.Create(&newcomer).Error)
			require.NoError(t, DB.Create(&free).Error)
			plan := func(user int, plan SubscriptionPlan, source string, total, used int64, at int64, status string, end int64) {
				row := UserSubscription{UserId: user, PlanId: plan.Id, AmountTotal: total, AmountUsed: used, StartTime: at, EndTime: end, Status: status, Source: source}
				require.NoError(t, DB.Create(&row).Error)
				require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", row.Id).Update("created_at", at).Error)
			}
			// The inviter's gift: three dollars, one used, still running. A second gift ended unused.
			plan(inviteGift.Id, free, SubscriptionSourceAffiliateGift, 3*dollar, dollar, day1+100, "active", now+86400)
			plan(idle.Id, free, SubscriptionSourceAffiliateGift, 3*dollar, 0, day1+100, "expired", day1+200)
			// The newcomer plan: bought and used up, bought and barely touched, a staff account's.
			plan(buyer.Id, newcomer, "order", 50*dollar, 48*dollar, day1+1000, "active", now+86400)
			plan(idle.Id, newcomer, "order", 50*dollar, 5*dollar, day1+1100, "active", now+86400)
			plan(staff.Id, newcomer, "order", 50*dollar, 50*dollar, day1+1100, "active", now+86400)
			// Before the range: not this cohort.
			plan(forum.Id, free, SubscriptionSourceAffiliateGift, 3*dollar, 0, day1-100, "active", now+86400)

			add := func(id string, user int, at int64, from, to int64, mode string) {
				require.NoError(t, LOG_DB.Create(&AuditLog{
					EventId: id, Username: "root", CreatedAt: at, Action: "user.quota_" + mode, Success: true, Category: AuditCategoryOperation,
					Other: AuditOther{Op: &AuditOperation{Action: "user.quota_" + mode, Params: AuditFields{
						"target_user_id": user, "mode": mode, "requested_quota": to - from, "from": from, "to": to,
					}}},
				}).Error)
			}
			add("e1", forum.Id, day1+2000, 0, 3*dollar, "add")
			add("e2", raffle.Id, day1+2100, 0, 5*dollar, "add")
			add("e3", refund.Id, day1+2200, 0, 20*dollar, "add")
			add("e4", forum.Id, day1+2300, 3*dollar, 9*dollar, "override") // not a gift
			add("e5", enterprise.Id, day1+2400, 0, 5000*dollar, "add")     // paid for by a backfill below

			require.NoError(t, DB.Create(&Redemption{Key: "k1", UsedUserId: refund.Id, Quota: int(dollar), RedeemedTime: day1 + 2500}).Error)

			// The channel's fee runs the whole range: two dollars a day makes 60 a month,
			// seven days cost fourteen. One account signed up through it in the range.
			require.NoError(t, SaveChannelCosts([]ChannelCost{{UserID: channel.Id, MonthlyUSD: 60, Start: day1 - 86400}}))
			invitee := registerAffiliateTestUser(t, "invitee", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", invitee.Id).Updates(map[string]any{"inviter_id": channel.Id, "created_at": day1 + 50}).Error)

			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: buyer.Id, PlanId: newcomer.Id, Money: 29.9, TradeNo: "PACK1", Status: common.TopUpStatusSuccess, CreateTime: day1 + 900}).Error)
			require.NoError(t, DB.Create(&SubscriptionOrder{UserId: idle.Id, PlanId: newcomer.Id, Money: 29.9, TradeNo: "PACK2", Status: common.TopUpStatusSuccess, CreateTime: day1 + 1000}).Error)
			require.NoError(t, DB.Create(&[]TopUp{
				{UserId: buyer.Id, Money: 29.9, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "PACK1", CreateTime: day1 + 900},
				{UserId: idle.Id, Money: 29.9, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "PACK2", CreateTime: day1 + 1000},
				// The buyer tops up twice after the plan, once before it.
				{UserId: buyer.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T0", CreateTime: day1 + 100},
				{UserId: buyer.Id, Amount: 20, Money: 20, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T1", CreateTime: day1 + 90000},
				{UserId: buyer.Id, Amount: 30, Money: 30, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T2", CreateTime: day1 + 100000},
				// The forum account pays 12 before its grant and 15 after; the gifted one pays 8.
				{UserId: forum.Id, Amount: 12, Money: 12, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T7", CreateTime: day1 + 1500},
				{UserId: forum.Id, Amount: 15, Money: 15, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T3", CreateTime: day1 + 3000},
				{UserId: inviteGift.Id, Amount: 8, Money: 8, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T4", CreateTime: day1 + 4000},
				{UserId: invitee.Id, Amount: 40, Money: 40, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T5", CreateTime: day1 + 5000},
				// An enterprise backfill pays for what was added by hand: no promotion.
				{UserId: enterprise.Id, Amount: 5000, Money: 5000, PaymentMethod: "offline", PaymentProvider: PaymentProviderOfflineBackfill, Status: common.TopUpStatusSuccess, TradeNo: "T6", CreateTime: day1 + 6000},
			}).Error)

			insights, err := GetCampaignInsights(r)
			require.NoError(t, err)
			rows := map[string]CampaignRow{}
			for _, row := range insights.Rows {
				rows[row.Kind] = row
			}
			assert.Equal(t, CampaignRow{Kind: CampaignInviteGift, CostUSD: 6, GivenUSD: 6, UsedUSD: 1, LyingUSD: 2, LapsedUSD: 3, Recipients: 2, Payers: 1, PaidMoney: 8},
				rows[CampaignInviteGift], "an ended gift is lapsed, a running one lying; idle paid nothing but the plan")
			assert.Equal(t, CampaignRow{Kind: CampaignNewcomerPlan, CostUSD: 53, GivenUSD: 100, UsedUSD: 53, LyingUSD: 47, Recipients: 2, Payers: 1, PaidMoney: 50, PackMoney: 59.8},
				rows[CampaignNewcomerPlan], "its cost is what the buyers used; a payment before the plan and the plan's own are not repayment")
			assert.Equal(t, CampaignRow{Kind: CampaignForumID, CostUSD: 3, GivenUSD: 3, UsedUSD: 2, LyingUSD: 1, Recipients: 1, Payers: 1, PaidMoney: 15},
				rows[CampaignForumID], "the wallet still holds one of the three dollars")
			assert.Equal(t, CampaignRow{Kind: CampaignRaffle, CostUSD: 5, GivenUSD: 5, UsedUSD: 5, Recipients: 1},
				rows[CampaignRaffle])
			assert.Equal(t, CampaignRow{Kind: CampaignRedemption, CostUSD: 1, GivenUSD: 1, UsedUSD: 1, Recipients: 1}, rows[CampaignRedemption])
			assert.Equal(t, CampaignRow{Kind: CampaignChannelFee, CostUSD: 14, Recipients: 1, Payers: 1, PaidMoney: 40},
				rows[CampaignChannelFee], "the fee of the seven days against the account it brought")
			assert.Equal(t, CampaignRow{Kind: CampaignManualOther, CostUSD: 20, GivenUSD: 20, UsedUSD: 20, Recipients: 1},
				rows[CampaignManualOther], "compensation is listed, and a backfilled enterprise credit and an override are not in it")
			assert.Len(t, insights.Rows, 7)

			// The total leaves the compensation out and counts the account in two rows once.
			assert.EqualValues(t, 7, insights.Total.Recipients)
			assert.EqualValues(t, 14+53+3+5+1+6, insights.Total.CostUSD)
			assert.EqualValues(t, 4, insights.Total.Payers)
			assert.InDelta(t, 8+50+15+40, insights.Total.PaidMoney, 0.001)

			require.NotNil(t, insights.Newcomer)
			assert.Equal(t, &NewcomerFunnel{Bought: 2, UsedUp: 1, Repaid: 1, RepaidAfterUsedUp: 1, PackMoney: 59.8, RepaidMoney: 50,
				GivenUSD: 100, UsedUSD: 53, PriceMoney: 29.9}, insights.Newcomer)
		})
	}
}

// The gate view counts the requests the newcomer-plan gate moved to the wallet,
// turned away or let through, and measures its known mistakes and its catch.
func TestGateInsightsCountMarkedRequestsAndMistakes(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			gateDayCache.reset()
			t.Cleanup(gateDayCache.reset)
			const day1 = int64(1759190400)
			const dollar = int64(affiliateDollar)
			r := InsightsRange{Start: day1, End: day1 + 3*86400}

			farm := registerAffiliateTestUser(t, "farm1", "")
			farm2 := registerAffiliateTestUser(t, "farm2", "")
			human := registerAffiliateTestUser(t, "human", "")
			bystander := registerAffiliateTestUser(t, "bystander", "")
			for _, id := range []int{farm.Id, farm2.Id} {
				require.NoError(t, DB.Model(&User{}).Where("id = ?", id).Update("remark", crowdRemarkPrefix+"studio A").Error)
			}
			newcomer := SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, MaxPurchasePerUser: 1, Enabled: true}
			require.NoError(t, DB.Create(&newcomer).Error)
			for _, user := range []struct {
				id   int
				used int64
			}{{farm.Id, 40 * dollar}, {farm2.Id, 10 * dollar}, {human.Id, dollar}} {
				require.NoError(t, DB.Create(&UserSubscription{UserId: user.id, PlanId: newcomer.Id, AmountTotal: 50 * dollar, AmountUsed: user.used, Status: "active", Source: "order"}).Error)
			}
			// An administrator's plan is not a purchase.
			require.NoError(t, DB.Create(&UserSubscription{UserId: farm.Id, PlanId: newcomer.Id, AmountTotal: 99 * dollar, Status: "active", Source: "admin"}).Error)

			// The human was caught on the first day, exempted on the second, and paid back.
			require.NoError(t, DB.Create(&SubscriptionAddressExemption{UserId: human.Id, CreatedBy: 1, CreatedAt: day1 + 86400 + 100}).Error)
			require.NoError(t, LOG_DB.Create(&AuditLog{
				EventId: "e1", Username: "root", CreatedAt: day1 + 86400 + 200, Action: "user.quota_add", Success: true, Category: AuditCategoryOperation,
				Other: AuditOther{Op: &AuditOperation{Action: "user.quota_add", Params: AuditFields{
					"target_user_id": human.Id, "mode": "add", "from": 0, "to": 4 * dollar,
				}}},
			}).Error)

			gate := func(user int, at int64, quota int64, kind string, exit string, typ int) Log {
				other := `{"admin_info":{`
				switch {
				case kind != "":
					other += `"limited_plan_ip_gate":"` + kind + `","limited_plan_ip_gate_holders":2,"limited_plan_ip_gate_scope":"address"`
				case exit != "":
					other += `"limited_plan_ip_gate_exit":"` + exit + `"`
				}
				return Log{UserId: user, Type: typ, CreatedAt: at, ModelName: "opus", Quota: int(quota), Other: other + `}}`}
			}
			require.NoError(t, LOG_DB.Create(&[]Log{
				gate(farm.Id, day1+10, dollar, "wallet", "", LogTypeConsume),
				gate(farm.Id, day1+20, 2*dollar, "wallet", "", LogTypeConsume),
				gate(farm2.Id, day1+30, 0, "refused", "", LogTypeError),
				gate(human.Id, day1+40, 3*dollar, "wallet", "", LogTypeConsume),
				gate(human.Id, day1+86400+50, 5*dollar, "wallet", "", LogTypeConsume), // the day of the exemption, after it: counted, not a mistake before it
				gate(bystander.Id, day1+86400+60, dollar, "other_plan", "", LogTypeConsume),
				gate(bystander.Id, day1+86400+70, dollar, "", "crowd", LogTypeConsume),
				gate(human.Id, day1+86400+80, dollar, "", "traffic", LogTypeConsume),
				{UserId: farm.Id, Type: LogTypeConsume, CreatedAt: day1 + 90, Quota: int(dollar), Other: `{}`}, // no marker
				gate(farm.Id, day1+4*86400, dollar, "wallet", "", LogTypeConsume),                              // past the range
			}).Error)

			insights, err := GetGateInsights(r)
			require.NoError(t, err)
			assert.EqualValues(t, 4, insights.Wallet)
			assert.EqualValues(t, 1, insights.OtherPlan)
			assert.EqualValues(t, 1, insights.Refused)
			assert.EqualValues(t, 4, insights.Users, "farm, farm2, human and bystander were acted on")
			assert.InDelta(t, 11, insights.WalletUSD, 1e-6)
			require.Len(t, insights.Days, 3)
			assert.Equal(t, GateDay{Day: day1, Wallet: 3, Refused: 1, WalletUSD: 6, Users: 3}, insights.Days[0])
			assert.Equal(t, GateDay{Day: day1 + 86400, Wallet: 1, OtherPlan: 1, WalletUSD: 5, Users: 2, Exits: 2}, insights.Days[1])
			assert.Equal(t, []GateExit{{Kind: LimitedPlanExitCrowd, Requests: 1, Users: 1}, {Kind: LimitedPlanExitTraffic, Requests: 1, Users: 1}}, insights.Exits)

			assert.Equal(t, GateCrowd{Accounts: 2, Gated: 2, GrantedUSD: 100, UsedUSD: 50, UnusedUSD: 50}, insights.Crowd,
				"the administrator's plan is not counted; what the studio could not spend is the catch")
			assert.Equal(t, GateExemptions{Accounts: 1, InRange: 1, Gated: 1, WalletBeforeUSD: 3, RefundedUSD: 4}, insights.Exemptions,
				"three dollars were moved to the wallet before the exemption, four were paid back after")

			// Days that ended are kept: the same range answers from them once the logs are gone.
			require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)
			again, err := GetGateInsights(r)
			require.NoError(t, err)
			assert.Equal(t, insights.Days, again.Days)
			assert.Equal(t, insights.Exits, again.Exits)

			// A range that ends now is not kept: its running day is read again.
			today := common.GetTimestamp()
			live := InsightsRange{Start: today - today%86400, End: today + 1}
			require.NoError(t, LOG_DB.Create(&Log{UserId: farm.Id, Type: LogTypeConsume, CreatedAt: today, Quota: int(dollar), Other: `{"admin_info":{"limited_plan_ip_gate":"wallet"}}`}).Error)
			first, err := GetGateInsights(live)
			require.NoError(t, err)
			assert.EqualValues(t, 1, first.Wallet)
			require.NoError(t, LOG_DB.Where("1 = 1").Delete(&Log{}).Error)
			second, err := GetGateInsights(live)
			require.NoError(t, err)
			assert.EqualValues(t, 0, second.Wallet)
		})
	}
}
