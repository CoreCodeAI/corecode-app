package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// GetUserContractBonus answers a user's contract bonus rate, 0 for none.
func GetUserContractBonus(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	rate, err := model.GetContractBonusRate(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"user_id": userId, "rate": rate})
}

// SetUserContractBonus sets the top-up bonus a user was promised outside the
// site's tiers. The user earns it or the site's tier, whichever is higher, on
// every top-up from now on; 0 removes it. Orders already created keep their
// bonus.
func SetUserContractBonus(c *gin.Context) {
	userId, err := strconv.Atoi(c.Param("id"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req struct {
		Rate *float64 `json:"rate"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Rate == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	// A rate is kept to a hundredth of a percent, as a percent typed in the
	// console arrives.
	rate := decimal.NewFromFloat(*req.Rate).Round(4).InexactFloat64()
	previous, err := model.SetContractBonusRate(userId, rate, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, userId, "user.contract_bonus", map[string]any{
		"from": previous,
		"to":   rate,
	})
	common.ApiSuccess(c, gin.H{"user_id": userId, "rate": rate})
}

// GetOfflineTopUpQuote answers the bonus an offline payment buying amount
// whole quota dollars earns the user: the user's contract rate or the site's
// tier for amount, whichever is higher, of amount, rounded down to a whole
// dollar. POST /api/user/topup/offline takes it as bonus.
func GetOfflineTopUpQuote(c *gin.Context) {
	userId, err := strconv.Atoi(c.Query("user_id"))
	if err != nil || userId <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	amount, err := strconv.ParseInt(c.Query("amount"), 10, 64)
	if err != nil || amount <= 0 || amount > chainDepositMaxQuoteAmount {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	contract, err := model.GetContractBonusRate(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	_, siteRate := operation_setting.TopUpBonusTier(amount)
	_, rate := operation_setting.BonusTierIn(operation_setting.BonusTiersWithContract(contract), amount)
	bonus := decimal.NewFromInt(amount).Mul(decimal.NewFromFloat(rate)).Floor().IntPart()
	common.ApiSuccess(c, gin.H{
		"user_id":       userId,
		"amount":        amount,
		"contract_rate": contract,
		"site_rate":     siteRate,
		"rate":          rate,
		"bonus":         bonus,
	})
}
