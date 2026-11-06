package controller

import (
	"errors"
	"io"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// affiliateSummary is what the wallet shows about the invitation program:
// the program terms and the user's rate, code and commission. While the
// program is on, every user has the default rate unless an administrator
// changed it.
type affiliateSummary struct {
	Enabled         bool             `json:"enabled"`
	SelfServeRate   int              `json:"self_serve_rate"`
	SecondLevelRate int              `json:"second_level_rate"`
	MinWithdrawal   int              `json:"min_withdrawal"`
	Affiliate       *model.Affiliate `json:"affiliate"`
	AffCode         string           `json:"aff_code"`
	InviteeCount    int64            `json:"invitee_count"`
	BalanceMoney    float64          `json:"balance_money"`
	EarnedMoney     float64          `json:"earned_money"`
}

func buildAffiliateSummary(userId int) (*affiliateSummary, error) {
	setting := operation_setting.GetAffiliateSetting()
	summary := &affiliateSummary{
		Enabled:         setting.Enabled,
		SelfServeRate:   setting.SelfServeRate,
		SecondLevelRate: setting.SecondLevelRate,
		MinWithdrawal:   setting.MinWithdrawal,
	}
	if err := model.EnsureDefaultAffiliate(userId); err != nil {
		return nil, err
	}
	affiliate, err := model.GetAffiliate(userId)
	if err != nil {
		return nil, err
	}
	if affiliate == nil {
		return summary, nil
	}
	summary.Affiliate = affiliate
	summary.BalanceMoney = model.AffiliateMoneyFromQuota(affiliate.Balance)
	summary.EarnedMoney = model.AffiliateMoneyFromQuota(affiliate.Earned)
	if affiliate.Rate > 0 {
		user, err := model.GetUserById(userId, false)
		if err != nil {
			return nil, err
		}
		summary.AffCode = user.AffCode
	}
	summary.InviteeCount, err = model.CountAffiliateInvitees(userId)
	if err != nil {
		return nil, err
	}
	return summary, nil
}

func GetSelfAffiliate(c *gin.Context) {
	summary, err := buildAffiliateSummary(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

func GetSelfAffiliateCommissions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	commissions, total, err := model.ListAffiliateCommissions(c.GetInt("id"), pageInfo, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(commissions)
	common.ApiSuccess(c, pageInfo)
}

// GetSelfAffiliateInvitees pages the users the caller invited, with totals
// over all of them, what the caller earned from the users they invited in
// turn, and the title of the plan they receive at sign-up, empty
// when the caller is not a promotion channel or their tier has no plan. It
// answers even when the program is off, because users invited earlier stay
// the caller's invitees.
func GetSelfAffiliateInvitees(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	invitees, total, err := model.ListAffiliateInvitees(userId, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	totals, err := model.SumAffiliateInvitees(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	secondLevel, err := model.SumAffiliateSecondLevel(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	giftPlan, err := model.AffiliateGiftPlan(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	giftPlanTitle := ""
	if giftPlan != nil {
		giftPlanTitle = giftPlan.Title
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invitees)
	common.ApiSuccess(c, gin.H{
		"page": pageInfo.Page, "page_size": pageInfo.PageSize, "total": pageInfo.Total,
		"items": pageInfo.Items, "totals": totals, "second_level": secondLevel, "gift_plan_title": giftPlanTitle,
	})
}

// giveAffiliateSignupGift gives a user who just signed up their channel
// inviter's gift plan. A failure is logged and never fails the sign-up, which
// has already committed.
func giveAffiliateSignupGift(c *gin.Context, userId int, inviterId int) {
	if userId <= 0 || inviterId <= 0 {
		return
	}
	if _, _, err := model.GiveAffiliateSignupGift(userId, inviterId, c.ClientIP()); err != nil {
		common.SysLog(common.LogText("failed to give user %d the sign-up gift of inviter %d: %v", userId, inviterId, err))
	}
}

// GiftSelfAffiliateInvitee is the retired manual gift. Invitees receive the
// plan when they sign up; the route answers until no console calls it.
func GiftSelfAffiliateInvitee(c *gin.Context) {
	common.ApiError(c, model.ErrAffiliateGiftAutomatic)
}

type affiliateTransferRequest struct {
	Quota int `json:"quota"`
}

// SetSelfAffiliateCode replaces the user's invite code with one they chose.
// Only a user the wallet shows a link to may, so the new code binds.
func SetSelfAffiliateCode(c *gin.Context) {
	var req affCodeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId := c.GetInt("id")
	summary, err := buildAffiliateSummary(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if summary.AffCode == "" {
		common.ApiError(c, model.ErrAffiliateCodeUnavailable)
		return
	}
	summary.AffCode, err = model.SetSelfAffCode(userId, req.AffCode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// TransferSelfAffiliate moves commission into the user's wallet.
func TransferSelfAffiliate(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req affiliateTransferRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Quota <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.TransferAffiliateBalance(c.GetInt("id"), req.Quota); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Transfer successful", nil)
}

func GetSelfAffiliateWithdrawals(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	withdrawals, total, err := model.ListAffiliateWithdrawals(c.GetInt("id"), "", pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(withdrawals)
	common.ApiSuccess(c, pageInfo)
}

type affiliateWithdrawalRequest struct {
	Quota   int64  `json:"quota"`
	Account string `json:"account"`
}

// RequestSelfAffiliateWithdrawal queues a channel's payout for an
// administrator.
func RequestSelfAffiliateWithdrawal(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	var req affiliateWithdrawalRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.Quota <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	withdrawal, err := model.RequestAffiliateWithdrawal(c.GetInt("id"), req.Quota, req.Account)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, withdrawal)
}

// affiliateManagedUser loads the user an administrator acts on, refusing one
// at or above the administrator's own role.
func affiliateManagedUser(c *gin.Context) (*model.User, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return nil, false
	}
	user, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if !canManageTargetRole(c.GetInt("role"), user.Role) {
		common.ApiErrorT(c, "No permission to access users of same or higher level")
		return nil, false
	}
	return user, true
}

// adminAffiliateView is a user's invitation settings as an administrator
// sees them. Unlike the wallet's summary, AffCode is the user's code even
// when their rate is 0, so a root user can set one before granting a rate.
type adminAffiliateView struct {
	*affiliateSummary
	MaxRate     int    `json:"max_rate"`
	InviterId   int    `json:"inviter_id"`
	InviterName string `json:"inviter_name"`
}

func buildAdminAffiliateView(user *model.User) (*adminAffiliateView, error) {
	summary, err := buildAffiliateSummary(user.Id)
	if err != nil {
		return nil, err
	}
	// Building the summary may have given the user their first code.
	current, err := model.GetUserById(user.Id, false)
	if err != nil {
		return nil, err
	}
	summary.AffCode = current.AffCode
	view := &adminAffiliateView{
		affiliateSummary: summary,
		MaxRate:          operation_setting.GetAffiliateSetting().MaxRate,
		InviterId:        user.InviterId,
	}
	if user.InviterId != 0 {
		if inviter, err := model.GetUserById(user.InviterId, false); err == nil {
			view.InviterName = inviter.Username
		}
	}
	return view, nil
}

func AdminGetUserAffiliate(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	view, err := buildAdminAffiliateView(user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// adminAffiliateRequest sets a rate and a channel tier. A console from before
// tiers sends only Channel: true keeps the user's tier, or makes them a
// distributor, which is what a channel was; false makes them an ordinary
// inviter.
type adminAffiliateRequest struct {
	Rate    int     `json:"rate"`
	Channel bool    `json:"channel"`
	Tier    *string `json:"tier"`
}

// AdminSetUserAffiliate sets a user's commission rate, up to the configured
// maximum, and their promotion-channel tier.
func AdminSetUserAffiliate(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	var req adminAffiliateRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	maxRate := operation_setting.GetAffiliateSetting().MaxRate
	if req.Rate < 0 || req.Rate > maxRate {
		common.ApiErrorT(c, "Commission rate must be between 0 and {{max}}%", map[string]any{"max": maxRate})
		return
	}
	tier := ""
	if req.Tier != nil {
		tier = *req.Tier
	} else if req.Channel {
		tier = model.AffiliateTierDistributor
		if current, err := model.GetAffiliate(user.Id); err == nil && current != nil && current.Tier != "" {
			tier = current.Tier
		}
	}
	if !model.ValidAffiliateTier(tier) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if _, err := model.SetAffiliate(user.Id, req.Rate, tier, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
		"username":          user.Username,
		"id":                user.Id,
		"action":            "set_affiliate",
		"affiliate_rate":    req.Rate,
		"affiliate_channel": tier != "",
		"affiliate_tier":    tier,
	})
	view, err := buildAdminAffiliateView(user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

type adminInviterRequest struct {
	InviterId int `json:"inviter_id"`
}

// AdminSetUserInviter changes who invited a user, or clears it with 0.
func AdminSetUserInviter(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	var req adminInviterRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil || req.InviterId < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.SetUserInviter(user.Id, req.InviterId); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
		"username":       user.Username,
		"id":             user.Id,
		"action":         "set_inviter",
		"old_inviter_id": user.InviterId,
		"inviter_id":     req.InviterId,
	})
	user.InviterId = req.InviterId
	view, err := buildAdminAffiliateView(user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

type affCodeRequest struct {
	AffCode string `json:"aff_code"`
}

// AdminSetUserAffCode replaces a user's invite code with one a root user
// chose. Links carrying the old code stop binding new sign-ups.
func AdminSetUserAffCode(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	var req affCodeRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	code, err := model.SetUserAffCode(user.Id, req.AffCode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
		"username":     user.Username,
		"id":           user.Id,
		"action":       "set_aff_code",
		"old_aff_code": user.AffCode,
		"aff_code":     code,
	})
	view, err := buildAdminAffiliateView(user)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, view)
}

// AdminGetUserAffiliateInvitees pages the users a user invited, unmasked,
// with the same totals the user sees on their invitations page.
func AdminGetUserAffiliateInvitees(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	invitees, total, err := model.ListAffiliateInvitees(user.Id, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	totals, err := model.SumAffiliateInvitees(user.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(invitees)
	common.ApiSuccess(c, gin.H{
		"page": pageInfo.Page, "page_size": pageInfo.PageSize, "total": pageInfo.Total,
		"items": pageInfo.Items, "totals": totals,
	})
}

// AdminListAffiliates pages every user who can invite or has invited
// someone, for the root invitation page.
func AdminListAffiliates(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	items, total, err := model.ListAffiliates(model.AffiliateListFilter{
		Keyword: c.Query("keyword"),
		Type:    c.Query("type"),
		Sort:    c.Query("sort"),
	}, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

// AdminGetAffiliateOverview returns the program's totals and its current
// terms, with the commission amounts also in money.
func AdminGetAffiliateOverview(c *gin.Context) {
	overview, err := model.GetAffiliateOverview()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	setting := operation_setting.GetAffiliateSetting()
	common.ApiSuccess(c, gin.H{
		"overview":                 overview,
		"earned_money":             model.AffiliateMoneyFromQuota(overview.Earned),
		"balance_money":            model.AffiliateMoneyFromQuota(overview.Balance),
		"pending_withdrawal_money": model.AffiliateMoneyFromQuota(overview.PendingWithdrawalQuota),
		"enabled":                  setting.Enabled,
		"self_serve_rate":          setting.SelfServeRate,
		"max_rate":                 setting.MaxRate,
		"second_level_rate":        setting.SecondLevelRate,
	})
}

func AdminGetUserAffiliateCommissions(c *gin.Context) {
	user, ok := affiliateManagedUser(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	commissions, total, err := model.ListAffiliateCommissions(user.Id, pageInfo, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(commissions)
	common.ApiSuccess(c, pageInfo)
}

func AdminGetAffiliateWithdrawals(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	withdrawals, total, err := model.ListAffiliateWithdrawals(0, c.Query("status"), pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(withdrawals)
	common.ApiSuccess(c, pageInfo)
}

type adminAffiliateWithdrawalRequest struct {
	Note string `json:"note"`
}

// AdminPayAffiliateWithdrawal records that a pending withdrawal was paid
// out offline.
func AdminPayAffiliateWithdrawal(c *gin.Context) {
	processAffiliateWithdrawal(c, true)
}

// AdminRejectAffiliateWithdrawal rejects a pending withdrawal and returns
// its quota to the channel's balance.
func AdminRejectAffiliateWithdrawal(c *gin.Context) {
	processAffiliateWithdrawal(c, false)
}

func processAffiliateWithdrawal(c *gin.Context, paid bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req adminAffiliateWithdrawalRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil && !errors.Is(err, io.EOF) {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	withdrawal, err := model.ProcessAffiliateWithdrawal(id, paid, c.GetInt("id"), req.Note)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	action := "reject_affiliate_withdrawal"
	if paid {
		action = "pay_affiliate_withdrawal"
	}
	username := ""
	if owner, err := model.GetUserById(withdrawal.UserId, false); err == nil {
		username = owner.Username
	}
	recordManageAuditFor(c, withdrawal.UserId, "user.manage", map[string]any{
		"username":      username,
		"id":            withdrawal.UserId,
		"action":        action,
		"withdrawal_id": withdrawal.Id,
		"quota":         withdrawal.Quota,
		"money":         withdrawal.Money,
	})
	common.ApiSuccess(c, withdrawal)
}
