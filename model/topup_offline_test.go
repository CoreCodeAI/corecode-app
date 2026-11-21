package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An enterprise customer pays by bank transfer and an administrator adds the
// quota by hand: until the payment is recorded the funds view counts its use
// as gifted. A backfill makes the same use paid and the money revenue,
// without crediting the wallet again.
func TestOfflineBackfillTurnsHandAddedQuotaIntoPaidCredit(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const day1 = int64(1759248000)
	dollar := int64(common.QuotaPerUnit)
	r := InsightsRange{Start: day1, End: day1 + 86400, Offset: 8 * 3600}
	company := registerAffiliateTestUser(t, "company", "")
	target := UserRef{UserID: company.Id, Username: "company"}
	require.NoError(t, LOG_DB.Create(&[]AuditLog{
		quotaAdjustmentLog("trial", target, day1+60, true, 100*dollar),
		quotaAdjustmentLog("contract", target, day1+120, true, 5800*dollar),
	}).Error)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", company.Id).Update("quota", 5900*dollar).Error)
	require.NoError(t, LOG_DB.Create(&Log{UserId: company.Id, Username: "company", Type: LogTypeConsume, CreatedAt: day1 + 3600,
		ModelName: "opus", Quota: int(50 * dollar), Other: `{"billing_source":"wallet"}`}).Error)

	finance, err := financeInsightsAt(r, day1+86400)
	require.NoError(t, err)
	assert.Equal(t, 50.0, finance.GiftConsumptionUSD, "hand-added quota with no payment is gifted")
	assert.Zero(t, finance.PaidUseUSD)

	_, err = RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 10000, Amount: 5901, PaidAt: day1, Backfill: true})
	assert.ErrorIs(t, err, ErrOfflineBackfillExceedsGrants, "more than was added by hand")
	order, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 10000, Amount: 5900, PaidAt: day1, Backfill: true})
	require.NoError(t, err)
	assert.Equal(t, PaymentProviderOfflineBackfill, order.PaymentProvider)
	assert.Equal(t, PaymentMethodOffline, order.PaymentMethod)
	assert.Equal(t, day1, order.CreateTime, "the order counts at the payment's time")
	_, err = RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 1, Amount: 1, PaidAt: day1, Backfill: true})
	assert.ErrorIs(t, err, ErrOfflineBackfillExceedsGrants, "the hand-added quota is paid for once")

	stored, err := GetUserById(company.Id, false)
	require.NoError(t, err)
	assert.Equal(t, int(5900*dollar), stored.Quota, "a backfill credits nothing")

	finance, err = financeInsightsAt(r, day1+86400)
	require.NoError(t, err)
	assert.Equal(t, 10000.0, finance.Revenue)
	assert.Zero(t, finance.GiftConsumptionUSD)
	assert.Equal(t, 50.0, finance.PaidUseUSD)
	history, err := readWalletHistory(day1 + 86400)
	require.NoError(t, err)
	assert.Equal(t, 1.0, history.paidShare(company.Id, day1+3600), "the channels view reads the use as paid too")
}

// Without Backfill the payment credits the wallet. Offline payments count in
// the user's paid total but earn the inviter no commission.
func TestOfflinePaymentCreditsTheWalletAndEarnsNoCommission(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	company := registerAffiliateTestUser(t, "company", "")
	order, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 90.004, Amount: 100, PaidAt: common.GetTimestamp()})
	require.NoError(t, err)
	assert.Equal(t, PaymentProviderOffline, order.PaymentProvider)
	assert.Equal(t, 90.0, order.Money)
	stored, err := GetUserById(company.Id, false)
	require.NoError(t, err)
	assert.Equal(t, company.Quota+int(100*common.QuotaPerUnit), stored.Quota)

	payAffiliateTestTopUp(t, company.Id, 10, PaymentProviderStripe)
	paid, err := AffiliatePaidMoney(DB, company.Id)
	require.NoError(t, err)
	assert.Equal(t, 100.0, paid)
	cents, err := affiliatePaidCents(DB, company.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 1000, cents, "only the gateway payment")

	_, err = RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 1, Amount: 1, PaidAt: common.GetTimestamp() + 3600})
	assert.Error(t, err, "a payment cannot be dated in the future")
}

// An enterprise pays ¥5000 for $5000 and is promised 10% on top: the wallet
// holds $5500 because administrators added it by hand. Recorded as 5000 plus
// a 500 bonus, the backfill covers the whole $5500 hand-added: nothing of it
// counts as gifted, and the funds view's three figures agree.
func TestOfflineBackfillWithBonusCoversTheBoughtAndTheBonusQuota(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 86400, Offset: 8 * 3600}
			company := registerAffiliateTestUser(t, "company", "")
			target := UserRef{UserID: company.Id, Username: "company"}
			require.NoError(t, LOG_DB.Create(&[]AuditLog{quotaAdjustmentLog("contract", target, day1+60, true, 5500*dollar)}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", company.Id).Update("quota", 5500*dollar).Error)
			require.NoError(t, LOG_DB.Create(&Log{UserId: company.Id, Username: "company", Type: LogTypeConsume, CreatedAt: day1 + 3600,
				ModelName: "opus", Quota: int(50 * dollar), Other: `{"billing_source":"wallet"}`}).Error)

			_, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 5000, Amount: 5000, Bonus: 501, PaidAt: day1, Backfill: true})
			assert.ErrorIs(t, err, ErrOfflineBackfillExceedsGrants, "the bonus counts against what was added by hand")
			_, err = RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 5000, Amount: 5000, Bonus: -1, PaidAt: day1, Backfill: true})
			assert.Error(t, err, "a bonus cannot be negative")
			order, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 5000, Amount: 5000, Bonus: 500, PaidAt: day1, Backfill: true})
			require.NoError(t, err)
			assert.EqualValues(t, 5000, order.Amount)
			assert.Equal(t, 500*dollar, order.BonusQuota)
			_, err = RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 1, Amount: 1, PaidAt: day1, Backfill: true})
			assert.ErrorIs(t, err, ErrOfflineBackfillExceedsGrants, "the bonus was paid for once too")

			stored, err := GetUserById(company.Id, false)
			require.NoError(t, err)
			assert.Equal(t, int(5500*dollar), stored.Quota, "a backfill credits nothing")

			finance, err := financeInsightsAt(r, day1+86400)
			require.NoError(t, err)
			assert.Equal(t, 5000.0, finance.Revenue)
			assert.Equal(t, 5000.0, finance.TopupCreditUSD)
			assert.Equal(t, 500.0, finance.BonusUSD)
			assert.Equal(t, 5500.0, finance.AdjustmentNetUSD)
			assert.Equal(t, finance.AdjustmentNetUSD, finance.TopupCreditUSD+finance.BonusUSD, "given, bought and bonus agree")
			// The bonus is given quota, as an online order's is: of the $50 use,
			// 500/5500 counts as gifted. Without the bonus in backfilled() the
			// hand-added quota would be priced as 6000 and the share would be off.
			assert.InDelta(t, 50.0*500/5500, finance.GiftConsumptionUSD, 1e-3)
			assert.InDelta(t, 50.0*5000/5500, finance.PaidUseUSD, 1e-3)
			history, err := readWalletHistory(day1 + 86400)
			require.NoError(t, err)
			assert.Equal(t, 1.0, history.paidShare(company.Id, day1+3600), "the channels view counts a bonus as paid, as for an online order")
		})
	}
}

// Without Backfill a bonus is credited with the payment, as an online order's
// is, and the order keeps it as its bonus quota.
func TestOfflinePaymentCreditsItsBonus(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	dollar := int64(common.QuotaPerUnit)
	company := registerAffiliateTestUser(t, "company", "")
	order, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 100, Amount: 100, Bonus: 10, PaidAt: common.GetTimestamp()})
	require.NoError(t, err)
	assert.EqualValues(t, 100, order.Amount)
	assert.Equal(t, 10*dollar, order.BonusQuota)
	stored, err := GetUserById(company.Id, false)
	require.NoError(t, err)
	assert.Equal(t, company.Quota+int(110*dollar), stored.Quota)
	var logs []Log
	require.NoError(t, LOG_DB.Where("user_id = ? AND type = ?", company.Id, LogTypeTopup).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Contains(t, logs[0].Content, "including a bonus of")
}

// PathPal's three transfers were recorded as backfills of 5900, 5500 and 5100
// when each was 5000 bought plus 500 bonus. The correction moves the split
// only: wallet, money and the funds view's total stay, the bonus is counted,
// and a second run changes nothing.
func TestCorrectOfflineBackfillsMovesTheBonusOutOfTheBoughtAmount(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const day1 = int64(1759248000)
			dollar := int64(common.QuotaPerUnit)
			r := InsightsRange{Start: day1, End: day1 + 86400, Offset: 8 * 3600}
			company := registerAffiliateTestUser(t, "company", "")
			target := UserRef{UserID: company.Id, Username: "company"}
			operator := registerAffiliateTestUser(t, "root", "")
			require.NoError(t, LOG_DB.Create(&[]AuditLog{quotaAdjustmentLog("contract", target, day1+60, true, 16500*dollar)}).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", company.Id).Update("quota", 16500*dollar).Error)
			require.NoError(t, DB.Model(&User{}).Where("id = ?", operator.Id).Update("role", common.RoleRootUser).Error)
			var ids []int
			for i, amount := range []int64{5900, 5500, 5100} {
				order := &TopUp{UserId: company.Id, Amount: amount, Money: 5000, TradeNo: fmt.Sprintf("OFFLINE-%d", i),
					PaymentMethod: PaymentMethodOffline, PaymentProvider: PaymentProviderOfflineBackfill,
					CreateTime: day1 + int64(i), CompleteTime: day1 + int64(i), Status: common.TopUpStatusSuccess}
				require.NoError(t, DB.Create(order).Error)
				ids = append(ids, order.Id)
			}
			plan := []OfflineBackfillCorrection{
				{Id: ids[0], FromAmount: 5900, Amount: 5000, Bonus: 500},
				{Id: ids[1], FromAmount: 5500, Amount: 5000, Bonus: 500},
				{Id: ids[2], FromAmount: 5100, Amount: 5000, Bonus: 500},
			}
			orders := func() (amount, bonus int64) {
				var rows []TopUp
				require.NoError(t, DB.Where("user_id = ?", company.Id).Find(&rows).Error)
				for _, row := range rows {
					amount += row.Amount
					bonus += row.BonusQuota
					assert.Equal(t, 5000.0, row.Money)
					assert.Equal(t, common.TopUpStatusSuccess, row.Status)
					assert.Equal(t, row.CreateTime, row.CompleteTime)
				}
				return amount, bonus
			}
			audits := func() int64 {
				var count int64
				require.NoError(t, LOG_DB.Model(&AuditLog{}).Where("action = ?", "user.topup_offline_correct").Count(&count).Error)
				return count
			}
			finance, err := financeInsightsAt(r, day1+86400)
			require.NoError(t, err)
			assert.Equal(t, 16500.0, finance.TopupCreditUSD)
			assert.Zero(t, finance.BonusUSD)

			// A wrong expectation fails the whole batch, and so does a changed total.
			wrong := append([]OfflineBackfillCorrection{}, plan...)
			wrong[2].FromAmount = 5200
			wrong[2].Amount, wrong[2].Bonus = 5100, 100
			_, err = CorrectOfflineBackfills(wrong, true, operator.Id, "test")
			assert.Error(t, err)
			_, err = CorrectOfflineBackfills([]OfflineBackfillCorrection{{Id: ids[0], FromAmount: 5900, Amount: 5000, Bonus: 400}}, true, operator.Id, "test")
			assert.Error(t, err, "a user's total must stay")
			_, err = CorrectOfflineBackfills(plan, true, 0, "")
			assert.Error(t, err, "applying needs an operator and a reason")
			_, err = CorrectOfflineBackfills(plan, true, company.Id, "test")
			assert.Error(t, err, "and the operator must be an administrator")
			amount, bonus := orders()
			assert.EqualValues(t, 16500, amount)
			assert.Zero(t, bonus)

			results, err := CorrectOfflineBackfills(plan, false, 0, "")
			require.NoError(t, err)
			assert.True(t, results[0].Changed)
			amount, _ = orders()
			assert.EqualValues(t, 16500, amount, "a dry run changes nothing")

			results, err = CorrectOfflineBackfills(plan, true, operator.Id, "companies get 10% on top")
			require.NoError(t, err)
			require.Len(t, results, 3)
			assert.EqualValues(t, 5900, results[0].Before.Amount)
			amount, bonus = orders()
			assert.EqualValues(t, 15000, amount)
			assert.Equal(t, 1500*dollar, bonus)
			assert.EqualValues(t, 3, audits())
			var entry AuditLog
			require.NoError(t, LOG_DB.Where("action = ?", "user.topup_offline_correct").Order("id").First(&entry).Error)
			assert.Equal(t, operator.Id, entry.UserId)
			assert.Equal(t, "root", entry.Username)
			params, err := common.Marshal(entry.Other.Op.Params)
			require.NoError(t, err)
			assert.Contains(t, string(params), `"reason":"companies get 10% on top"`)
			targetId, _ := auditInt(entry.Other.Op.Params, "target_user_id")
			assert.EqualValues(t, company.Id, targetId)

			results, err = CorrectOfflineBackfills(plan, true, operator.Id, "companies get 10% on top")
			require.NoError(t, err)
			for _, result := range results {
				assert.False(t, result.Changed, "a second run finds the orders corrected")
			}
			assert.EqualValues(t, 3, audits(), "and writes no audit entry")

			stored, err := GetUserById(company.Id, false)
			require.NoError(t, err)
			assert.Equal(t, int(16500*dollar), stored.Quota)
			finance, err = financeInsightsAt(r, day1+86400)
			require.NoError(t, err)
			assert.Equal(t, 15000.0, finance.TopupCreditUSD)
			assert.Equal(t, 1500.0, finance.BonusUSD)
			assert.Equal(t, finance.AdjustmentNetUSD, finance.TopupCreditUSD+finance.BonusUSD)
			assert.Equal(t, 15000.0, finance.Revenue)
		})
	}
}

// An order that is not a backfill is never corrected.
func TestCorrectOfflineBackfillsRefusesOtherOrders(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	company := registerAffiliateTestUser(t, "company", "")
	order, err := RecordOfflineTopUp(OfflineTopUpInput{UserId: company.Id, Money: 100, Amount: 100, PaidAt: common.GetTimestamp()})
	require.NoError(t, err)
	_, err = CorrectOfflineBackfills([]OfflineBackfillCorrection{{Id: order.Id, FromAmount: 100, Amount: 90, Bonus: 10}}, true, 1, "test")
	assert.Error(t, err)
}
