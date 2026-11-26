package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An enterprise promised 10% on every top-up earns 10% or the site's tier,
// whichever is higher, whether it pays online, on chain or offline; the two
// never add up, and removing the rate leaves the site's tiers.
func TestContractBonusRateTakesTheHigherOfItAndTheSiteTier(t *testing.T) {
	_, identity, target := setupAdminUserTest(t)
	require.NoError(t, model.DB.AutoMigrate(&model.UserContractBonus{}, &model.TopUp{}))
	previous := operation_setting.GetPaymentSetting().AmountBonus
	previousPerUnit := common.QuotaPerUnit
	operation_setting.GetPaymentSetting().AmountBonus = map[int]float64{300: 0.03, 1000: 0.05, 5000: 0.07, 10000: 0.1}
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		operation_setting.GetPaymentSetting().AmountBonus = previous
		common.QuotaPerUnit = previousPerUnit
	})
	params := gin.Params{{Key: "id", Value: strconv.Itoa(target.Id)}}
	set := func(body string) map[string]any {
		response := adminUserRequest(http.MethodPut, "/api/user/"+strconv.Itoa(target.Id)+"/contract-bonus", body, "", identity, common.RoleRootUser, params, SetUserContractBonus)
		var result map[string]any
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		return result
	}
	quote := func(amount int64) map[string]any {
		path := fmt.Sprintf("/api/user/topup/offline/quote?user_id=%d&amount=%d", target.Id, amount)
		response := adminUserRequest(http.MethodGet, path, "", "", identity, common.RoleRootUser, nil, GetOfflineTopUpQuote)
		var result struct {
			Success bool           `json:"success"`
			Data    map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success)
		return result.Data
	}
	onlineBonus := func(amount int64) int {
		bonus, err := topUpBonusQuota(target.Id, amount)
		require.NoError(t, err)
		return bonus
	}
	dollars := func(n float64) int { return int(n * 500000) }

	assert.Equal(t, dollars(350), onlineBonus(5000), "no contract: the site's 7%")
	assert.EqualValues(t, 350, quote(5000)["bonus"])

	for _, body := range []string{`{}`, `{"rate":-0.1}`, `{"rate":1.5}`} {
		assert.Equal(t, false, set(body)["success"], body)
	}
	missing := adminUserRequest(http.MethodPut, "/api/user/999999/contract-bonus", `{"rate":0.1}`, "", identity, common.RoleRootUser, gin.Params{{Key: "id", Value: "999999"}}, SetUserContractBonus)
	assert.Contains(t, missing.Body.String(), `"success":false`)

	require.Equal(t, true, set(`{"rate":0.1}`)["success"])
	assert.Equal(t, dollars(500), onlineBonus(5000), "10% beats the site's 7%")
	assert.Equal(t, dollars(10), onlineBonus(100), "the contract rate starts at any amount")
	assert.Equal(t, dollars(2000), onlineBonus(20000), "the site's 10% equals it: not 20%")
	q := quote(5000)
	assert.EqualValues(t, 500, q["bonus"])
	assert.Equal(t, 0.1, q["contract_rate"])
	assert.Equal(t, 0.07, q["site_rate"])
	assert.Equal(t, 0.1, q["rate"])
	assert.EqualValues(t, 1, quote(15)["bonus"], "1.5 rounds down to a whole dollar")
	assert.Equal(t, map[int]float64{1: 0.1}, topUpInfoBonusTiers(target.Id), "the wallet shows the merged tiers")

	require.Equal(t, true, set(`{"rate":0.3}`)["success"])
	assert.Equal(t, dollars(1500), onlineBonus(5000))

	var audits []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("action = ?", "user.contract_bonus").Order("id").Find(&audits).Error)
	require.Len(t, audits, 2)
	auditParams, err := common.Marshal(audits[1].Other.Op.Params)
	require.NoError(t, err)
	assert.Contains(t, string(auditParams), `"from":0.1`)
	assert.Contains(t, string(auditParams), `"to":0.3`)

	require.Equal(t, true, set(`{"rate":0}`)["success"])
	assert.Equal(t, dollars(350), onlineBonus(5000), "removing the rate leaves the site's tiers")
	assert.Equal(t, operation_setting.GetPaymentSetting().AmountBonus, topUpInfoBonusTiers(target.Id))
	var rows int64
	require.NoError(t, model.DB.Model(&model.UserContractBonus{}).Count(&rows).Error)
	assert.Zero(t, rows)
}
