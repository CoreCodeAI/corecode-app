package model

import (
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
