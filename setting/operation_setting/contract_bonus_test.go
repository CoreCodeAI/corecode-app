package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func withAmountBonus(t *testing.T, tiers map[int]float64) {
	t.Helper()
	previous := paymentSetting.AmountBonus
	paymentSetting.AmountBonus = tiers
	t.Cleanup(func() { paymentSetting.AmountBonus = previous })
}

// A contract rate and the site's tiers never add up: each amount earns the
// higher of the two, and each merged tier starts where its rate begins.
func TestBonusTiersWithContractTakesTheHigherRate(t *testing.T) {
	site := map[int]float64{300: 0.03, 1000: 0.05, 5000: 0.07, 10000: 0.1}
	withAmountBonus(t, site)

	assert.Equal(t, site, BonusTiersWithContract(0), "no contract leaves the site's tiers")
	assert.Equal(t, map[int]float64{1: 0.06, 5000: 0.07, 10000: 0.1}, BonusTiersWithContract(0.06),
		"site tiers below the contract rate are left out")
	assert.Equal(t, map[int]float64{1: 0.1}, BonusTiersWithContract(0.1),
		"a site tier equal to the contract rate does not start a new tier")
	assert.Equal(t, map[int]float64{1: 0.3}, BonusTiersWithContract(0.3))

	tiers := BonusTiersWithContract(0.06)
	for _, test := range []struct {
		amount  int64
		minimum int64
		rate    float64
	}{
		{1, 1, 0.06},
		{299, 1, 0.06},
		{1000, 1, 0.06},
		{4999, 1, 0.06},
		{5000, 5000, 0.07},
		{20000, 10000, 0.1},
	} {
		minimum, rate := BonusTierIn(tiers, test.amount)
		assert.Equal(t, test.minimum, minimum, "minimum at %d", test.amount)
		assert.Equal(t, test.rate, rate, "rate at %d", test.amount)
	}

	withAmountBonus(t, map[int]float64{})
	assert.Equal(t, map[int]float64{1: 0.1}, BonusTiersWithContract(0.1), "a contract rate applies without site tiers")
}

func TestValidateContractBonusRate(t *testing.T) {
	for _, rate := range []float64{0, 0.0001, 0.1, 1} {
		assert.NoError(t, ValidateContractBonusRate(rate), "%v", rate)
	}
	for _, rate := range []float64{-0.1, 1.0001, 10} {
		assert.Error(t, ValidateContractBonusRate(rate), "%v", rate)
	}
}
