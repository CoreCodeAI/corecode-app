package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Setting a contract rate inserts it, setting it again replaces it, and 0
// removes it, on every database; an invalid rate or a missing user changes
// nothing.
func TestSetContractBonusRateUpsertsAndRemoves(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useAffiliateTestDB(t, dialect)
			require.NoError(t, DB.Migrator().DropTable(&UserContractBonus{}))
			require.NoError(t, DB.AutoMigrate(&UserContractBonus{}))
			company := registerAffiliateTestUser(t, "contract_company", "")

			rate, err := GetContractBonusRate(company.Id)
			require.NoError(t, err)
			assert.Zero(t, rate)

			previous, err := SetContractBonusRate(company.Id, 0.1, 7)
			require.NoError(t, err)
			assert.Zero(t, previous)
			previous, err = SetContractBonusRate(company.Id, 0.3, 8)
			require.NoError(t, err)
			assert.Equal(t, 0.1, previous)
			var row UserContractBonus
			require.NoError(t, DB.Where("user_id = ?", company.Id).First(&row).Error)
			assert.Equal(t, 0.3, row.Rate)
			assert.Equal(t, 8, row.UpdatedBy)

			_, err = SetContractBonusRate(company.Id, 1.5, 8)
			assert.Error(t, err)
			_, err = SetContractBonusRate(company.Id+100000, 0.1, 8)
			assert.Error(t, err)
			rate, err = GetContractBonusRate(company.Id)
			require.NoError(t, err)
			assert.Equal(t, 0.3, rate)

			previous, err = SetContractBonusRate(company.Id, 0, 8)
			require.NoError(t, err)
			assert.Equal(t, 0.3, previous)
			var rows int64
			require.NoError(t, DB.Model(&UserContractBonus{}).Count(&rows).Error)
			assert.Zero(t, rows)
		})
	}
}
