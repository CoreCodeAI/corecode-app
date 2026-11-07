package model

import (
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// affiliateDollar is one unit of display currency in quota; with price 1 it
// is also what ¥1 of payment buys at list price.
const affiliateDollar = 500000

func useAffiliateTestDB(t *testing.T, dialect string) {
	t.Helper()
	var driver gorm.Dialector
	connections := 8
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
		connections = 1
	case "mysql":
		dsn := os.Getenv("TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN is not configured")
		}
		driver = postgres.Open(dsn)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(connections)
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database version: %s", version)

	previousDB, previousLogDB := DB, LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousSetting, previousPrice, previousQuotaPerUnit := *operation_setting.GetAffiliateSetting(), operation_setting.Price, common.QuotaPerUnit
	DB, LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	initCol()
	operation_setting.Price = 1
	common.QuotaPerUnit = affiliateDollar
	*operation_setting.GetAffiliateSetting() = operation_setting.AffiliateSetting{
		Enabled: true, SelfServeRate: 10, MaxRate: 30, SecondLevelRate: 5, MinWithdrawal: 100,
	}
	tables := []any{&User{}, &TopUp{}, &Log{}, &Affiliate{}, &AffiliateReferral{}, &AffiliateCommission{}, &AffiliateWithdrawal{}, &AffiliateSignupGift{}, &AffiliateRetiredCode{},
		&SubscriptionPlan{}, &SubscriptionOrder{}, &UserSubscription{}, &UserSession{}}
	for _, table := range tables {
		require.False(t, db.Migrator().HasTable(table), "use an empty test database")
	}
	require.NoError(t, db.AutoMigrate(tables...))
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(tables...))
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		initCol()
		*operation_setting.GetAffiliateSetting() = previousSetting
		operation_setting.Price, common.QuotaPerUnit = previousPrice, previousQuotaPerUnit
		require.NoError(t, sqlDB.Close())
	})
}

func registerAffiliateTestUser(t *testing.T, name string, inviterCode string) *User {
	t.Helper()
	user := &User{Username: name, DisplayName: name, Role: common.RoleCommonUser, Status: common.UserStatusEnabled}
	require.NoError(t, user.Insert(InviterIdForAffCode(inviterCode)))
	require.NoError(t, DB.First(user, user.Id).Error)
	return user
}

func payAffiliateTestTopUp(t *testing.T, userId int, money float64, provider string) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId: userId, Money: money, Status: common.TopUpStatusSuccess, PaymentProvider: provider,
		TradeNo: fmt.Sprintf("aff-test-%d-%s", userId, common.GetRandomString(8)),
	}).Error)
}

func consumeAffiliateTestQuota(t *testing.T, userId int, dollars int) {
	t.Helper()
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).
		Update("used_quota", gorm.Expr("used_quota + ?", dollars*affiliateDollar)).Error)
}

func affiliateTestBalance(t *testing.T, userId int) int64 {
	t.Helper()
	affiliate, err := GetAffiliate(userId)
	require.NoError(t, err)
	if affiliate == nil {
		return 0
	}
	return affiliate.Balance
}

type affiliateTestCredit struct {
	UserId int
	Level  int
	Rate   int
	Amount int64
}

func affiliateTestCredits(t *testing.T, sourceUserId int) []affiliateTestCredit {
	t.Helper()
	var commissions []AffiliateCommission
	require.NoError(t, DB.Where("source_user_id = ?", sourceUserId).Order("id").Find(&commissions).Error)
	credits := make([]affiliateTestCredit, 0, len(commissions))
	for _, commission := range commissions {
		credits = append(credits, affiliateTestCredit{commission.UserId, commission.Level, commission.Rate, commission.Amount})
	}
	return credits
}

func settleAffiliateTestUser(t *testing.T, userId int) {
	t.Helper()
	_, err := SettleAffiliateReferral(userId)
	require.NoError(t, err)
}

func TestAffiliateCommissionDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			dollars := func(n int) int64 { return int64(n * affiliateDollar) }

			// A is a 30% promotion channel granted by an administrator.
			a := registerAffiliateTestUser(t, "aff_a", "")
			_, err := SetAffiliate(a.Id, 30, AffiliateTierDistributor, 1)
			require.NoError(t, err)

			// Every enabled user's code binds and gives them the default rate.
			stranger := registerAffiliateTestUser(t, "aff_stranger", "")
			assert.Equal(t, stranger.Id, InviterIdForAffCode(stranger.AffCode))
			strangerAffiliate, err := GetAffiliate(stranger.Id)
			require.NoError(t, err)
			require.NotNil(t, strangerAffiliate)
			assert.Equal(t, 10, strangerAffiliate.Rate)
			assert.Zero(t, InviterIdForAffCode("nope"))
			disabled := registerAffiliateTestUser(t, "aff_disabled", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", disabled.Id).Update("status", common.UserStatusDisabled).Error)
			assert.Zero(t, InviterIdForAffCode(disabled.AffCode))

			b := registerAffiliateTestUser(t, "aff_b", a.AffCode)
			assert.Equal(t, a.Id, b.InviterId)
			var referral AffiliateReferral
			require.NoError(t, DB.Where("user_id = ?", b.Id).First(&referral).Error, "a sign-up with an affiliate's code starts counting at once")

			// B has the default 10% without paying or applying.
			require.NoError(t, EnsureDefaultAffiliate(b.Id))
			require.NoError(t, EnsureDefaultAffiliate(b.Id), "ensuring twice keeps one row")
			bAffiliate, err := GetAffiliate(b.Id)
			require.NoError(t, err)
			assert.Equal(t, 10, bAffiliate.Rate)
			assert.False(t, bAffiliate.Channel)
			payAffiliateTestTopUp(t, b.Id, 60, PaymentProviderEpay)
			payAffiliateTestTopUp(t, b.Id, 500, PaymentProviderBalance)
			require.NoError(t, DB.Create(&TopUp{UserId: b.Id, Money: 900, Status: common.TopUpStatusPending, TradeNo: "aff-test-pending"}).Error)
			payAffiliateTestTopUp(t, b.Id, 40, PaymentProviderEpay)

			c := registerAffiliateTestUser(t, "aff_c", b.AffCode)
			assert.Equal(t, b.Id, c.InviterId)
			payAffiliateTestTopUp(t, c.Id, 200, PaymentProviderEpay)

			// C's consumption pays B 10% and, because A is a channel, A 5%.
			consumeAffiliateTestQuota(t, c.Id, 100)
			settleAffiliateTestUser(t, c.Id)
			assert.Equal(t, []affiliateTestCredit{
				{b.Id, 1, 10, dollars(10)},
				{a.Id, 2, 5, dollars(5)},
			}, affiliateTestCredits(t, c.Id))

			// Settling again with no new consumption pays nothing.
			settleAffiliateTestUser(t, c.Id)
			assert.Len(t, affiliateTestCredits(t, c.Id), 2)

			// B's own consumption pays A 30%; B paid ¥100, so the base is 50.
			consumeAffiliateTestQuota(t, b.Id, 50)
			settleAffiliateTestUser(t, b.Id)
			assert.Equal(t, []affiliateTestCredit{{a.Id, 1, 30, dollars(15)}}, affiliateTestCredits(t, b.Id))

			// Consumption beyond what C paid earns nothing: ¥200 paid, 250 consumed.
			consumeAffiliateTestQuota(t, c.Id, 150)
			settleAffiliateTestUser(t, c.Id)
			consumeAffiliateTestQuota(t, c.Id, 30)
			settleAffiliateTestUser(t, c.Id)
			assert.Equal(t, []affiliateTestCredit{
				{b.Id, 1, 10, dollars(10)},
				{a.Id, 2, 5, dollars(5)},
				{b.Id, 1, 10, dollars(10)},
				{a.Id, 2, 5, dollars(5)},
			}, affiliateTestCredits(t, c.Id))

			// Users C invites belong to C alone: neither B nor A earns from them.
			_, err = SetAffiliate(c.Id, 10, "", 1)
			require.NoError(t, err)
			d := registerAffiliateTestUser(t, "aff_d", c.AffCode)
			payAffiliateTestTopUp(t, d.Id, 100, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, d.Id, 40)
			settleAffiliateTestUser(t, d.Id)
			assert.Equal(t, []affiliateTestCredit{{c.Id, 1, 10, dollars(4)}}, affiliateTestCredits(t, d.Id))

			assert.Equal(t, dollars(20), affiliateTestBalance(t, b.Id))
			assert.Equal(t, dollars(25), affiliateTestBalance(t, a.Id))

			// Concurrent settlements of the same consumption pay once.
			consumeAffiliateTestQuota(t, d.Id, 10)
			var wg sync.WaitGroup
			for range 8 {
				wg.Go(func() {
					_, err := SettleAffiliateReferral(d.Id)
					assert.NoError(t, err)
				})
			}
			wg.Wait()
			assert.Len(t, affiliateTestCredits(t, d.Id), 2)
			assert.Equal(t, dollars(5), affiliateTestBalance(t, c.Id))

			// With the program off, consumption moves the marks but earns
			// nothing, and turning it back on pays nothing for that period.
			operation_setting.GetAffiliateSetting().Enabled = false
			consumeAffiliateTestQuota(t, d.Id, 20)
			settleAffiliateTestUser(t, d.Id)
			operation_setting.GetAffiliateSetting().Enabled = true
			settleAffiliateTestUser(t, d.Id)
			assert.Len(t, affiliateTestCredits(t, d.Id), 2)

			// A disabled inviter earns nothing.
			require.NoError(t, DB.Model(&User{}).Where("id = ?", c.Id).Update("status", common.UserStatusDisabled).Error)
			consumeAffiliateTestQuota(t, d.Id, 10)
			settleAffiliateTestUser(t, d.Id)
			assert.Len(t, affiliateTestCredits(t, d.Id), 2)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", c.Id).Update("status", common.UserStatusEnabled).Error)

			// An invitee bound while the program was off starts at its
			// consumption and payments of the moment the program finds it.
			operation_setting.GetAffiliateSetting().Enabled = false
			e := registerAffiliateTestUser(t, "aff_e", a.AffCode)
			assert.Equal(t, a.Id, e.InviterId)
			var count int64
			require.NoError(t, DB.Model(&AffiliateReferral{}).Where("user_id = ?", e.Id).Count(&count).Error)
			assert.Zero(t, count)
			payAffiliateTestTopUp(t, e.Id, 50, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, e.Id, 20)
			operation_setting.GetAffiliateSetting().Enabled = true
			started, err := StartMissingAffiliateReferrals(10)
			require.NoError(t, err)
			assert.Equal(t, 1, started)
			started, err = StartMissingAffiliateReferrals(10)
			require.NoError(t, err)
			assert.Zero(t, started)
			consumeAffiliateTestQuota(t, e.Id, 20)
			settleAffiliateTestUser(t, e.Id)
			assert.Empty(t, affiliateTestCredits(t, e.Id), "the ¥50 paid before counting started earns nothing")
			payAffiliateTestTopUp(t, e.Id, 30, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, e.Id, 40)
			settleAffiliateTestUser(t, e.Id)
			assert.Equal(t, []affiliateTestCredit{{a.Id, 1, 30, dollars(9)}}, affiliateTestCredits(t, e.Id))

			// The settlement query finds exactly the invitees whose consumption grew.
			consumeAffiliateTestQuota(t, b.Id, 1)
			ids, _, err := AffiliateReferralsToSettle(0, 10)
			require.NoError(t, err)
			assert.Equal(t, []int{b.Id}, ids)

			// Transfers move commission into the wallet.
			require.NoError(t, TransferAffiliateBalance(b.Id, int(dollars(15))))
			assert.Equal(t, dollars(5), affiliateTestBalance(t, b.Id))
			var wallet User
			require.NoError(t, DB.Select("quota").First(&wallet, b.Id).Error)
			assert.Equal(t, int(dollars(15)), wallet.Quota)
			assert.ErrorIs(t, TransferAffiliateBalance(b.Id, int(dollars(6))), ErrAffiliateBalanceInsufficient)

			// Only channels withdraw; a rejection returns the quota.
			_, err = RequestAffiliateWithdrawal(b.Id, dollars(5), "alipay b")
			assert.ErrorIs(t, err, ErrAffiliateNotChannel)
			_, err = SetAffiliate(a.Id, 30, AffiliateTierDistributor, 1)
			require.NoError(t, err)
			require.NoError(t, DB.Model(&Affiliate{}).Where("user_id = ?", a.Id).Update("balance", dollars(250)).Error)
			_, err = RequestAffiliateWithdrawal(a.Id, dollars(99), "alipay a")
			assert.ErrorIs(t, err, ErrAffiliateWithdrawalTooSmall)
			_, err = RequestAffiliateWithdrawal(a.Id, dollars(100), " ")
			assert.ErrorIs(t, err, ErrAffiliateAccountInvalid)
			first, err := RequestAffiliateWithdrawal(a.Id, dollars(100), "alipay a")
			require.NoError(t, err)
			assert.Equal(t, 100.0, first.Money)
			second, err := RequestAffiliateWithdrawal(a.Id, dollars(150), "alipay a")
			require.NoError(t, err)
			assert.Zero(t, affiliateTestBalance(t, a.Id))
			_, err = RequestAffiliateWithdrawal(a.Id, dollars(100), "alipay a")
			assert.ErrorIs(t, err, ErrAffiliateBalanceInsufficient)
			rejected, err := ProcessAffiliateWithdrawal(first.Id, false, 1, "wrong account")
			require.NoError(t, err)
			assert.Equal(t, AffiliateWithdrawalRejected, rejected.Status)
			assert.Equal(t, dollars(100), affiliateTestBalance(t, a.Id))
			paid, err := ProcessAffiliateWithdrawal(second.Id, true, 1, "")
			require.NoError(t, err)
			assert.Equal(t, AffiliateWithdrawalPaid, paid.Status)
			_, err = ProcessAffiliateWithdrawal(first.Id, true, 1, "")
			assert.ErrorIs(t, err, ErrAffiliateWithdrawalProcessed)
			assert.Equal(t, dollars(100), affiliateTestBalance(t, a.Id))
			paidList, total, err := ListAffiliateWithdrawals(0, AffiliateWithdrawalPaid, &common.PageInfo{Page: 1, PageSize: 10})
			require.NoError(t, err)
			assert.EqualValues(t, 1, total)
			assert.Equal(t, "aff_a", paidList[0].Username)

			// An administrator's rate 0 removes invite rights; the default
			// rate does not come back.
			_, err = SetAffiliate(b.Id, 0, "", 1)
			require.NoError(t, err)
			assert.Zero(t, InviterIdForAffCode(b.AffCode))
			require.NoError(t, EnsureDefaultAffiliate(b.Id))
			bAffiliate, err = GetAffiliate(b.Id)
			require.NoError(t, err)
			assert.Zero(t, bAffiliate.Rate)

			// An invite made while the program was off earns the default rate
			// from the inviter's first settlement after it is turned on.
			operation_setting.GetAffiliateSetting().Enabled = false
			x := registerAffiliateTestUser(t, "aff_x", "")
			y := registerAffiliateTestUser(t, "aff_y", x.AffCode)
			assert.Equal(t, x.Id, y.InviterId)
			operation_setting.GetAffiliateSetting().Enabled = true
			backfilled, err := StartMissingAffiliateReferrals(100)
			require.NoError(t, err)
			assert.Positive(t, backfilled)
			payAffiliateTestTopUp(t, y.Id, 50, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, y.Id, 20)
			settleAffiliateTestUser(t, y.Id)
			assert.Equal(t, []affiliateTestCredit{{x.Id, 1, 10, dollars(2)}}, affiliateTestCredits(t, y.Id))

			commissions, total, err := ListAffiliateCommissions(a.Id, &common.PageInfo{Page: 1, PageSize: 2}, true)
			require.NoError(t, err)
			assert.EqualValues(t, 4, total)
			require.Len(t, commissions, 2)
			assert.Equal(t, "af***", commissions[0].SourceName, "an affiliate sees invitees masked")
			commissions, _, err = ListAffiliateCommissions(a.Id, &common.PageInfo{Page: 1, PageSize: 2}, false)
			require.NoError(t, err)
			assert.Equal(t, "aff_e", commissions[0].SourceName, "an administrator sees them whole")
		})
	}
}

func TestAffiliateInviteesDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			dollars := func(n int) int64 { return int64(n * affiliateDollar) }

			// A is a channel; B, D and E are A's invitees, and C is B's.
			a := registerAffiliateTestUser(t, "aff_a", "")
			_, err := SetAffiliate(a.Id, 30, AffiliateTierDistributor, 1)
			require.NoError(t, err)
			b := registerAffiliateTestUser(t, "aff_b", a.AffCode)
			_, err = SetAffiliate(b.Id, 10, "", 1)
			require.NoError(t, err)
			c := registerAffiliateTestUser(t, "aff_c", b.AffCode)
			d := registerAffiliateTestUser(t, "aff_d", a.AffCode)
			e := registerAffiliateTestUser(t, "aff_e", a.AffCode)
			// F is D's invitee and has not paid.
			registerAffiliateTestUser(t, "aff_f", d.AffCode)
			for _, user := range []*User{b, c, d} {
				payAffiliateTestTopUp(t, user.Id, 1000, PaymentProviderEpay)
			}
			// E paid ¥5 and consumed $20, the rest from quota they did not pay for.
			payAffiliateTestTopUp(t, e.Id, 5, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, b.Id, 100)
			consumeAffiliateTestQuota(t, c.Id, 200)
			consumeAffiliateTestQuota(t, d.Id, 7)
			consumeAffiliateTestQuota(t, e.Id, 20)
			for _, user := range []*User{b, c, d, e} {
				settleAffiliateTestUser(t, user.Id)
			}

			invitees, total, err := ListAffiliateInvitees(a.Id, &common.PageInfo{Page: 1, PageSize: 10})
			require.NoError(t, err)
			assert.EqualValues(t, 3, total, "C is B's invitee, not A's")
			require.Len(t, invitees, 3)
			assert.Equal(t, AffiliateInvitee{Id: e.Id, Name: "aff_e", CreatedAt: e.CreatedAt, UsedQuota: dollars(20), CommissionBase: dollars(5), Commission: 750000}, *invitees[0],
				"newest first; only the $5 E paid for earns commission")
			assert.Equal(t, AffiliateInvitee{Id: d.Id, Name: "aff_d", CreatedAt: d.CreatedAt, UsedQuota: dollars(7), CommissionBase: dollars(7), Commission: 1050000}, *invitees[1])
			assert.Equal(t, AffiliateInvitee{Id: b.Id, Name: "aff_b", CreatedAt: b.CreatedAt, UsedQuota: dollars(100), CommissionBase: dollars(100), Commission: dollars(30)}, *invitees[2],
				"A's 5% on C's consumption is second-level and stays off B's row")

			totals, err := SumAffiliateInvitees(a.Id)
			require.NoError(t, err)
			assert.Equal(t, AffiliateInviteeTotals{UsedQuota: dollars(127), CommissionBase: dollars(112), Commission: dollars(30) + 1050000 + 750000}, totals)

			// C and F are A's second-level users; only C paid, so only C earned A 5%.
			secondLevel, err := SumAffiliateSecondLevel(a.Id)
			require.NoError(t, err)
			assert.Equal(t, AffiliateSecondLevel{
				InviteeCount: 2, CommissionBase: dollars(200), Commission: dollars(10), SourceCount: 2,
				Sources: []AffiliateSecondLevelSource{
					{Id: b.Id, Name: "aff_b", InviteeCount: 1, CommissionBase: dollars(200), Commission: dollars(10)},
					{Id: d.Id, Name: "aff_d", InviteeCount: 1},
				},
			}, secondLevel, "sources earning the most come first")
			earned, err := GetAffiliate(a.Id)
			require.NoError(t, err)
			assert.Equal(t, earned.Earned, totals.Commission+secondLevel.Commission, "the two levels add up to everything A earned")

			page, total, err := ListAffiliateInvitees(a.Id, &common.PageInfo{Page: 3, PageSize: 1})
			require.NoError(t, err)
			assert.EqualValues(t, 3, total)
			require.Len(t, page, 1)
			assert.Equal(t, dollars(100), page[0].UsedQuota)

			// A user who invited nobody gets an empty page and zero totals.
			invitees, total, err = ListAffiliateInvitees(e.Id, &common.PageInfo{Page: 1, PageSize: 10})
			require.NoError(t, err)
			assert.Zero(t, total)
			assert.Empty(t, invitees)
			totals, err = SumAffiliateInvitees(e.Id)
			require.NoError(t, err)
			assert.Zero(t, totals)
			// D invited F, who invited nobody: D has no second level.
			secondLevel, err = SumAffiliateSecondLevel(d.Id)
			require.NoError(t, err)
			assert.Equal(t, AffiliateSecondLevel{Sources: []AffiliateSecondLevelSource{}}, secondLevel)
		})
	}
}

func TestAffiliateSignupGiftDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			setting := operation_setting.GetAffiliateSetting()

			trial := &SubscriptionPlan{Title: "trial", PriceAmount: 9.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true}
			retailTrial := &SubscriptionPlan{Title: "retail trial", DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true}
			for _, plan := range []*SubscriptionPlan{trial, retailTrial} {
				require.NoError(t, DB.Create(plan).Error)
				InvalidateSubscriptionPlanCache(plan.Id)
				t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
			}

			// O is an ordinary inviter, D a distributor and R a retail channel.
			o := registerAffiliateTestUser(t, "aff_o", "")
			d := registerAffiliateTestUser(t, "aff_d", "")
			_, err := SetAffiliate(d.Id, 30, AffiliateTierDistributor, 1)
			require.NoError(t, err)
			r := registerAffiliateTestUser(t, "aff_r", "")
			_, err = SetAffiliate(r.Id, 30, AffiliateTierRetail, 1)
			require.NoError(t, err)
			ip := 0
			signUp := func(name string, inviter *User, email string) (*User, *SubscriptionPlan) {
				t.Helper()
				user := registerAffiliateTestUser(t, name, inviter.AffCode)
				if email != "" {
					require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Update("email", email).Error)
				}
				ip++
				plan, _, err := GiveAffiliateSignupGift(user.Id, user.InviterId, fmt.Sprintf("203.0.%d.113", ip), true)
				require.NoError(t, err)
				return user, plan
			}
			giftStatus := func(user *User) string {
				t.Helper()
				var gift AffiliateSignupGift
				if err := DB.Where("user_id = ?", user.Id).First(&gift).Error; err != nil {
					return ""
				}
				return gift.Status
			}

			// With no plan configured for a tier, its invitees receive nothing.
			_, plan := signUp("aff_d0", d, "")
			assert.Nil(t, plan)
			setting.GiftPlanId, setting.RetailGiftPlanId = trial.Id, retailTrial.Id

			_, plan = signUp("aff_o1", o, "")
			assert.Nil(t, plan, "an ordinary inviter's invitees receive nothing")

			d1, plan := signUp("aff_d1", d, "d1@example.com")
			require.NotNil(t, plan)
			assert.Equal(t, trial.Id, plan.Id, "a distributor's invitees receive the distributor plan")
			var subscription UserSubscription
			require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", d1.Id, trial.Id).First(&subscription).Error)
			assert.Equal(t, SubscriptionSourceAffiliateGift, subscription.Source)
			assert.Equal(t, "active", subscription.Status)
			again, _, err := GiveAffiliateSignupGift(d1.Id, d.Id, "198.51.1.100", true)
			require.NoError(t, err)
			assert.Nil(t, again, "a user is handled once")

			r1, plan := signUp("aff_r1", r, "")
			require.NotNil(t, plan)
			assert.Equal(t, retailTrial.Id, plan.Id, "a retail channel's invitees receive the retail plan")

			// The gifted invitee cannot buy the plan, but an administrator can
			// still bind it.
			assert.ErrorIs(t, CheckSubscriptionPurchase(d1.Id, trial), ErrSubscriptionGifted)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", d1.Id).Update("quota", 100*affiliateDollar).Error)
			assert.ErrorIs(t, PurchaseSubscriptionWithBalance(d1.Id, trial.Id), ErrSubscriptionGifted)
			_, err = AdminBindSubscription(d1.Id, trial.Id, "")
			require.NoError(t, err)

			// A second sign-up from an address that received a gift in the last
			// 24 hours receives none; the row records why.
			r2 := registerAffiliateTestUser(t, "aff_r2", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(r2.Id, r.Id, fmt.Sprintf("203.0.%d.113", ip), true)
			require.NoError(t, err)
			assert.Nil(t, plan)
			assert.Equal(t, AffiliateSignupGiftIpUsed, giftStatus(r2))
			r3 := registerAffiliateTestUser(t, "aff_r3", r.AffCode)
			require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("user_id = ?", r1.Id).
				Update("created_at", common.GetTimestamp()-affiliateSignupGiftWindow-1).Error)
			require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("user_id = ?", r2.Id).Update("ip", "").Error)
			r1Ip := fmt.Sprintf("203.0.%d.113", ip)
			plan, _, err = GiveAffiliateSignupGift(r3.Id, r.Id, r1Ip, true)
			require.NoError(t, err)
			require.NotNil(t, plan, "an address's earlier gift stops counting after 24 hours")

			// Another address in a gifted /24 receives nothing; an older row
			// without a network still counts by its address.
			r6 := registerAffiliateTestUser(t, "aff_r6", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(r6.Id, r.Id, fmt.Sprintf("203.0.%d.200", ip), true)
			require.NoError(t, err)
			assert.Nil(t, plan, "the address shares r3's /24")
			assert.Equal(t, AffiliateSignupGiftIpUsed, giftStatus(r6))
			require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("user_id = ?", r3.Id).Update("network", "").Error)
			r7 := registerAffiliateTestUser(t, "aff_r7", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(r7.Id, r.Id, r1Ip, true)
			require.NoError(t, err)
			assert.Nil(t, plan, "a row from before networks were stored matches by address")
			assert.Equal(t, AffiliateSignupGiftIpUsed, giftStatus(r7))

			// A sign-up by email rather than an OAuth provider receives
			// nothing; the row records why, and the address stays free.
			byEmail := registerAffiliateTestUser(t, "aff_mail", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(byEmail.Id, r.Id, "198.51.7.100", false)
			require.NoError(t, err)
			assert.Nil(t, plan)
			assert.Equal(t, AffiliateSignupGiftEmailSignup, giftStatus(byEmail))
			viaOAuth := registerAffiliateTestUser(t, "aff_oauth", r.AffCode)
			plan, _, err = GiveAffiliateSignupGift(viaOAuth.Id, r.Id, "198.51.7.101", true)
			require.NoError(t, err)
			assert.NotNil(t, plan, "a withheld email sign-up does not use up its network")

			// A blocked address domain, or a parent of it, receives nothing.
			setting.GiftBlockedEmailDomains = "mailinator.com\n@throwaway.test"
			blocked, plan := signUp("aff_r4", r, "r4@inbox.throwaway.test")
			assert.Nil(t, plan)
			assert.Equal(t, AffiliateSignupGiftEmailBlocked, giftStatus(blocked))
			_, plan = signUp("aff_r5", r, "r5@notthrowaway.test")
			assert.NotNil(t, plan, "only the domain and its subdomains are blocked")

			// The daily cap counts one channel's gifts; concurrent sign-ups
			// through that channel never pass it.
			setting.GiftDailyCap = 5
			var given int64
			countGiven := func() {
				t.Helper()
				require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("inviter_id = ? AND status = ? AND created_at >= ?",
					r.Id, AffiliateSignupGiftGiven, common.GetTimestamp()-affiliateSignupGiftWindow).Count(&given).Error)
			}
			countGiven()
			require.EqualValues(t, 3, given, "R's gifts inside the window: r3, aff_oauth and r5")
			users := make([]*User, 0, 8)
			for i := range 8 {
				users = append(users, registerAffiliateTestUser(t, fmt.Sprintf("aff_cap%d", i), r.AffCode))
			}
			var wg sync.WaitGroup
			for i, user := range users {
				wg.Go(func() {
					_, _, err := GiveAffiliateSignupGift(user.Id, r.Id, fmt.Sprintf("192.0.%d.2", i), true)
					assert.NoError(t, err)
				})
			}
			wg.Wait()
			countGiven()
			assert.EqualValues(t, 5, given)
			var capped int64
			require.NoError(t, DB.Model(&AffiliateSignupGift{}).Where("inviter_id = ? AND status = ?", r.Id, AffiliateSignupGiftCapReached).Count(&capped).Error)
			assert.EqualValues(t, 6, capped, "two of the eight fit under the cap")
			_, plan = signUp("aff_d2", d, "")
			assert.NotNil(t, plan, "another channel has its own cap")
			setting.GiftDailyCap = 0

			// A channel at rate 0, a disabled plan, and the program off give
			// nothing.
			_, err = SetAffiliate(r.Id, 0, AffiliateTierRetail, 1)
			require.NoError(t, err)
			late := registerAffiliateTestUser(t, "aff_late", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", late.Id).Update("inviter_id", r.Id).Error)
			plan, _, err = GiveAffiliateSignupGift(late.Id, r.Id, "198.51.2.100", true)
			require.NoError(t, err)
			assert.Nil(t, plan)
			require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", trial.Id).Update("enabled", false).Error)
			InvalidateSubscriptionPlanCache(trial.Id)
			_, plan = signUp("aff_d3", d, "")
			assert.Nil(t, plan)
			require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", trial.Id).Update("enabled", true).Error)
			InvalidateSubscriptionPlanCache(trial.Id)
			setting.Enabled = false
			stray := registerAffiliateTestUser(t, "aff_stray", d.AffCode)
			setting.Enabled = true
			plan, _, err = GiveAffiliateSignupGift(stray.Id, d.Id, "198.51.3.100", true)
			require.NoError(t, err)
			assert.NotNil(t, plan, "the binding, not the program at sign-up, decides; the program is on again")
			setting.Enabled = false
			offline := registerAffiliateTestUser(t, "aff_offline", d.AffCode)
			plan, _, err = GiveAffiliateSignupGift(offline.Id, d.Id, "198.51.4.100", true)
			require.NoError(t, err)
			assert.Nil(t, plan, "the program is off")
			setting.Enabled = true

			// The gift is for the inviter the user is bound to.
			plan, _, err = GiveAffiliateSignupGift(offline.Id, r.Id, "198.51.5.100", true)
			require.NoError(t, err)
			assert.Nil(t, plan)

			// The invitee list shows who received the plan at sign-up.
			e := registerAffiliateTestUser(t, "aff_e", d.AffCode)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", e.Id).Update("quota", 100*affiliateDollar).Error)
			require.NoError(t, PurchaseSubscriptionWithBalance(e.Id, trial.Id))
			invitees, _, err := ListAffiliateInvitees(d.Id, &common.PageInfo{Page: 1, PageSize: 20})
			require.NoError(t, err)
			byName := map[string]*AffiliateInvitee{}
			for _, invitee := range invitees {
				byName[invitee.Name] = invitee
			}
			assert.Equal(t, "owned", byName["aff_e"].GiftPlan)
			assert.Equal(t, "gifted", byName["aff_d1"].GiftPlan, "a gift outranks the administrator's later binding")
			assert.Equal(t, "d1@example.com", byName["aff_d1"].Email)
			assert.Empty(t, byName["aff_d0"].GiftPlan)

			// A plan only for users registered before a cutoff is still given
			// at sign-up to a later registrant, who cannot buy it; a newcomer
			// plan takes the opposite side of the same cutoff.
			const cutoff = int64(2_000_000_000)
			require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", trial.Id).Update("registered_before", cutoff).Error)
			InvalidateSubscriptionPlanCache(trial.Id)
			trial.RegisteredBefore = cutoff
			early := registerAffiliateTestUser(t, "aff_early", "")
			require.NoError(t, DB.Model(&User{}).Where("id = ?", early.Id).Update("created_at", cutoff-1).Error)
			newcomer := registerAffiliateTestUser(t, "aff_newcomer", d.AffCode)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", newcomer.Id).Update("created_at", cutoff).Error)
			assert.NoError(t, CheckSubscriptionPurchase(early.Id, trial))
			assert.ErrorIs(t, CheckSubscriptionPurchase(newcomer.Id, trial), ErrSubscriptionNotEligible)
			plan, _, err = GiveAffiliateSignupGift(newcomer.Id, d.Id, "198.51.6.100", true)
			require.NoError(t, err)
			assert.NotNil(t, plan, "a gift ignores the registration window")

			newcomerPlan := &SubscriptionPlan{Title: "newcomer", PriceAmount: 29.9, DurationUnit: SubscriptionDurationDay, DurationValue: 7, Enabled: true, RegisteredAfter: cutoff}
			require.NoError(t, DB.Create(newcomerPlan).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", early.Id).Update("quota", 100*affiliateDollar).Error)
			assert.ErrorIs(t, PurchaseSubscriptionWithBalance(early.Id, newcomerPlan.Id), ErrSubscriptionNotEligible)
			assert.NoError(t, CheckSubscriptionPurchase(newcomer.Id, newcomerPlan))
			_, err = AdminBindSubscription(early.Id, newcomerPlan.Id, "")
			require.NoError(t, err, "an administrator can bind it to anyone")
		})
	}
}

func TestAffiliateTiersDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			dollars := func(n int) int64 { return int64(n * affiliateDollar) }

			// A channel from before tiers becomes a distributor; others keep no tier.
			legacy := registerAffiliateTestUser(t, "aff_legacy", "")
			plain := registerAffiliateTestUser(t, "aff_plain", "")
			require.NoError(t, DB.Create(&Affiliate{UserId: legacy.Id, Rate: 30, Channel: true}).Error)
			require.NoError(t, EnsureDefaultAffiliate(plain.Id))
			require.NoError(t, MigrateAffiliateTiers())
			require.NoError(t, MigrateAffiliateTiers(), "migrating twice changes nothing more")
			legacyAffiliate, err := GetAffiliate(legacy.Id)
			require.NoError(t, err)
			assert.Equal(t, AffiliateTierDistributor, legacyAffiliate.Tier)
			plainAffiliate, err := GetAffiliate(plain.Id)
			require.NoError(t, err)
			assert.Empty(t, plainAffiliate.Tier)

			// A retail channel earns its own rate but nothing at the second
			// level, and can withdraw.
			r := registerAffiliateTestUser(t, "aff_r", "")
			retail, err := SetAffiliate(r.Id, 30, AffiliateTierRetail, 1)
			require.NoError(t, err)
			assert.True(t, retail.Channel, "both tiers are channels")
			b := registerAffiliateTestUser(t, "aff_b", r.AffCode)
			c := registerAffiliateTestUser(t, "aff_c", b.AffCode)
			payAffiliateTestTopUp(t, b.Id, 100, PaymentProviderEpay)
			payAffiliateTestTopUp(t, c.Id, 100, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, b.Id, 100)
			consumeAffiliateTestQuota(t, c.Id, 100)
			settleAffiliateTestUser(t, b.Id)
			settleAffiliateTestUser(t, c.Id)
			assert.Equal(t, []affiliateTestCredit{{r.Id, 1, 30, dollars(30)}}, affiliateTestCredits(t, b.Id))
			assert.Equal(t, []affiliateTestCredit{{b.Id, 1, 10, dollars(10)}}, affiliateTestCredits(t, c.Id), "no second level for a retail channel")
			operation_setting.GetAffiliateSetting().MinWithdrawal = 10
			_, err = RequestAffiliateWithdrawal(r.Id, dollars(30), "alipay:r")
			require.NoError(t, err)

			// Clearing the tier makes the user an ordinary inviter.
			ordinary, err := SetAffiliate(r.Id, 10, "", 1)
			require.NoError(t, err)
			assert.False(t, ordinary.Channel)
			assert.Empty(t, ordinary.Tier)

			items, _, err := ListAffiliates(AffiliateListFilter{Type: AffiliateTierDistributor}, &common.PageInfo{Page: 1, PageSize: 10})
			require.NoError(t, err)
			require.Len(t, items, 1)
			assert.Equal(t, legacy.Id, items[0].UserId)
			assert.Equal(t, AffiliateTierDistributor, items[0].Tier)
		})
	}
}

func TestSetUserInviterDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			dollars := func(n int) int64 { return int64(n * affiliateDollar) }

			// B is A's invitee and D is B's; C signed up without a code and
			// has already paid and consumed.
			a := registerAffiliateTestUser(t, "aff_a", "")
			b := registerAffiliateTestUser(t, "aff_b", a.AffCode)
			d := registerAffiliateTestUser(t, "aff_d", b.AffCode)
			c := registerAffiliateTestUser(t, "aff_c", "")
			payAffiliateTestTopUp(t, c.Id, 100, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, c.Id, 50)

			assert.ErrorIs(t, SetUserInviter(c.Id, c.Id), ErrAffiliateInviterInvalid)
			assert.ErrorIs(t, SetUserInviter(c.Id, 1_000_000), ErrAffiliateInviterInvalid)
			assert.ErrorIs(t, SetUserInviter(a.Id, b.Id), ErrAffiliateInviterLoop)
			assert.ErrorIs(t, SetUserInviter(a.Id, d.Id), ErrAffiliateInviterLoop, "D was invited through B")

			require.NoError(t, SetUserInviter(c.Id, a.Id))
			count, err := CountAffiliateInvitees(a.Id)
			require.NoError(t, err)
			assert.EqualValues(t, 2, count)

			// What C paid and consumed before the change earns A nothing; what
			// C pays for and consumes after it does.
			_, err = StartMissingAffiliateReferrals(10)
			require.NoError(t, err)
			consumeAffiliateTestQuota(t, c.Id, 10)
			settleAffiliateTestUser(t, c.Id)
			assert.Empty(t, affiliateTestCredits(t, c.Id))
			payAffiliateTestTopUp(t, c.Id, 100, PaymentProviderEpay)
			consumeAffiliateTestQuota(t, c.Id, 10)
			settleAffiliateTestUser(t, c.Id)
			assert.Equal(t, []affiliateTestCredit{{a.Id, 1, 10, dollars(1)}}, affiliateTestCredits(t, c.Id))

			// Moving C to B sends later commission to B; clearing it sends none.
			require.NoError(t, SetUserInviter(c.Id, b.Id))
			consumeAffiliateTestQuota(t, c.Id, 10)
			settleAffiliateTestUser(t, c.Id)
			require.NoError(t, SetUserInviter(c.Id, 0))
			consumeAffiliateTestQuota(t, c.Id, 10)
			settleAffiliateTestUser(t, c.Id)
			assert.Equal(t, []affiliateTestCredit{{a.Id, 1, 10, dollars(1)}, {b.Id, 1, 10, dollars(1)}}, affiliateTestCredits(t, c.Id))
			var cleared User
			require.NoError(t, DB.Select("inviter_id").Where("id = ?", c.Id).First(&cleared).Error)
			assert.Zero(t, cleared.InviterId)
		})
	}
}
