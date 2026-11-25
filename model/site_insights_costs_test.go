package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The funds view prorates each IP cost over the range by its billing cycle,
// keeps dollars and yuan apart, and names the exempt accounts with the part
// of the commission they earned.
func TestFundsIPCostsAndCommissionExempt(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })

			const day1 = int64(1759248000)
			r := InsightsRange{Start: day1, End: day1 + 3*86400}
			require.NoError(t, SaveIPCosts([]IPCost{
				// Quarterly in dollars, running before and after the range.
				{Name: "sixtynet #3937", Amount: 90, Currency: "USD", CycleMonths: 3, Start: day1 - 86400},
				// Monthly in yuan, ending one day into the range.
				{Name: "aaitr #6756", Amount: 150, Currency: "CNY", CycleMonths: 1, Start: day1 - 86400, End: day1 + 86400},
				// Starts after the range: costs nothing in it.
				{Name: "later", Amount: 999, Currency: "CNY", CycleMonths: 1, Start: day1 + 10*86400},
			}))

			own := registerAffiliateTestUser(t, "own-channel", "")
			outside := registerAffiliateTestUser(t, "outside-affiliate", "")
			payer := registerAffiliateTestUser(t, "payer", "")
			dollar := int64(common.QuotaPerUnit)
			require.NoError(t, DB.Create(&[]AffiliateCommission{
				{UserId: own.Id, SourceUserId: payer.Id, Level: 1, Rate: 30, Amount: 7 * dollar, CreatedAt: day1 + 600},
				{UserId: own.Id, SourceUserId: payer.Id, Level: 1, Rate: 30, Amount: 50 * dollar, CreatedAt: day1 - 600},
				{UserId: outside.Id, SourceUserId: payer.Id, Level: 1, Rate: 10, Amount: 2 * dollar, CreatedAt: day1 + 700},
			}).Error)
			require.NoError(t, SaveCommissionExempt([]int{own.Id, own.Id}))

			finance, err := GetFinanceInsights(r)
			require.NoError(t, err)
			assert.InDelta(t, 30.0*3/30, finance.IPCostUSD, 0.01, "a quarterly $90 is $30 a month")
			assert.InDelta(t, 150.0*1/30, finance.IPCostCNY, 0.01, "one day of ¥150 a month")
			assert.Len(t, finance.IPCosts, 3)
			assert.Equal(t, []UserRef{{UserID: own.Id, Username: "own-channel"}}, finance.CommissionExempt)
			assert.InDelta(t, 9, finance.CommissionUSD, 0.001)
			assert.InDelta(t, 7, finance.CommissionExemptUSD, 0.001, "only the range's commission of the exempt account")
		})
	}
}

func TestSaveIPCostsRejectsBadEntries(t *testing.T) {
	valid := IPCost{Name: "host", Amount: 10, Currency: "CNY", CycleMonths: 1, Start: 1}
	for name, change := range map[string]func(*IPCost){
		"no name":        func(c *IPCost) { c.Name = "  " },
		"currency":       func(c *IPCost) { c.Currency = "EUR" },
		"cycle":          func(c *IPCost) { c.CycleMonths = 2 },
		"no start":       func(c *IPCost) { c.Start = 0 },
		"end before":     func(c *IPCost) { c.End = 1 },
		"negative price": func(c *IPCost) { c.Amount = -1 },
	} {
		cost := valid
		change(&cost)
		assert.ErrorIs(t, SaveIPCosts([]IPCost{cost}), errInvalidIPCost, name)
	}
	assert.ErrorIs(t, SaveCommissionExempt([]int{0}), errInvalidCommissionExempt)
}
