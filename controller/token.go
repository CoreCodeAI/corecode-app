package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type tokenAutoGroupsInput struct {
	Set    bool
	Groups []string
}

func (input *tokenAutoGroupsInput) UnmarshalJSON(data []byte) error {
	input.Set = true
	if strings.TrimSpace(string(data)) == "null" {
		input.Groups = nil
		return nil
	}
	return common.Unmarshal(data, &input.Groups)
}

type tokenRequest struct {
	model.Token
	AutoGroups tokenAutoGroupsInput `json:"auto_groups"`
	// 指针区分“未传”和显式 false：新建时未传即开启，更新时未传则保留原值。
	AllowUserQuotaQuery *bool `json:"allow_user_quota_query"`
}

type tokenResponse struct {
	*model.Token
	AutoGroups []string `json:"auto_groups"`
}

func maxTokenQuota() int {
	quota, err := common.WalletQuotaFromDecimalStrict(
		decimal.NewFromInt(1_000_000_000).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
	)
	if err != nil {
		return common.MaxWalletQuota
	}
	return quota
}

func buildMaskedTokenResponse(token *model.Token) *tokenResponse {
	if token == nil {
		return nil
	}
	maskedToken := *token
	maskedToken.Key = token.GetMaskedKey()
	autoGroups, err := token.GetAutoGroups()
	if err != nil {
		common.SysError(common.LogText("failed to parse auto groups for token %d: %v", token.Id, err))
		autoGroups = nil
	}
	if len(autoGroups) == 0 {
		autoGroups = nil
	}
	return &tokenResponse{Token: &maskedToken, AutoGroups: autoGroups}
}

func buildMaskedTokenResponses(tokens []*model.Token) []*tokenResponse {
	maskedTokens := make([]*tokenResponse, 0, len(tokens))
	for _, token := range tokens {
		maskedTokens = append(maskedTokens, buildMaskedTokenResponse(token))
	}
	return maskedTokens
}

// getTokenRequestUserGroup returns the group that bounds the auto groups of a token owned by ownerId.
func getTokenRequestUserGroup(c *gin.Context, ownerId int) (string, error) {
	if ownerId == c.GetInt("id") {
		if userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup); userGroup != "" {
			return userGroup, nil
		}
		if userGroup := c.GetString("group"); userGroup != "" {
			return userGroup, nil
		}
	}
	return model.GetUserGroup(ownerId, false)
}

func setTokenAutoGroups(c *gin.Context, token *model.Token, groups []string) bool {
	if len(groups) == 0 {
		if err := token.SetAutoGroups(nil); err != nil {
			common.ApiError(c, err)
			return false
		}
		return true
	}

	maxCount := setting.GetMaxTokenAutoGroups()
	if len(groups) > maxCount {
		common.ApiErrorT(c, "A token can select at most {{max}} Auto groups", map[string]any{"max": maxCount})
		return false
	}

	userGroup, err := getTokenRequestUserGroup(c, token.UserId)
	if err != nil {
		common.ApiError(c, err)
		return false
	}
	seen := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		if _, ok := seen[group]; ok {
			common.ApiErrorT(c, "Auto group {{group}} is duplicated", map[string]any{"group": group})
			return false
		}
		seen[group] = struct{}{}
		if !service.IsUserSelectableGroup(userGroup, group) {
			common.ApiErrorT(c, "Auto group {{group}} is unavailable or unauthorized", map[string]any{"group": group})
			return false
		}
	}

	if err := token.SetAutoGroups(groups); err != nil {
		common.ApiError(c, err)
		return false
	}
	return true
}

func GetAllTokens(c *gin.Context) {
	userId := c.GetInt("id")
	pageInfo := common.GetPageQuery(c)
	tokens, err := model.GetAllUserTokens(userId, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	total, _ := model.CountUserTokens(userId)
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func SearchTokens(c *gin.Context) {
	userId := c.GetInt("id")
	keyword := c.Query("keyword")
	token := c.Query("token")

	pageInfo := common.GetPageQuery(c)

	tokens, total, err := model.SearchUserTokens(userId, keyword, token, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

func GetToken(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, buildMaskedTokenResponse(token))
}

func GetTokenAutoGroups(c *gin.Context) {
	userGroup, err := getTokenRequestUserGroup(c, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"groups":    service.GetUserAutoGroup(userGroup),
		"max_count": setting.GetMaxTokenAutoGroups(),
	})
}

func GetTokenKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, gin.H{
		"key": token.GetFullKey(),
	})
}

func GetTokenStatus(c *gin.Context) {
	tokenId := c.GetInt("token_id")
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(tokenId, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"object":          "credit_summary",
		"total_granted":   token.RemainQuota,
		"total_used":      0, // not supported currently
		"total_available": token.RemainQuota,
		"expires_at":      expiredAt * 1000,
	})
}

func GetTokenUsage(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "No Authorization header",
		})
		return
	}

	parts := strings.Split(authHeader, " ")
	if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "Invalid Bearer token",
		})
		return
	}
	tokenKey := parts[1]

	token, err := model.GetTokenByKey(strings.TrimPrefix(tokenKey, "sk-"), false)
	if err != nil {
		common.SysError(common.LogText("failed to get token by key: %s", err.Error()))
		common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
		return
	}

	expiredAt := token.ExpiredTime
	if expiredAt == -1 {
		expiredAt = 0
	}

	data := gin.H{
		"object":               "token_usage",
		"name":                 token.Name,
		"total_granted":        token.RemainQuota + token.UsedQuota,
		"total_used":           token.UsedQuota,
		"total_available":      token.RemainQuota,
		"unlimited_quota":      token.UnlimitedQuota,
		"model_limits":         token.GetModelLimitsMap(),
		"model_limits_enabled": token.ModelLimitsEnabled,
		"expires_at":           expiredAt,
	}
	// 用户额度只在令牌允许时返回；IP 白名单已由 TokenAuthReadOnly 检查。
	if token.AllowUserQuotaQuery {
		userQuota, err := model.GetUserQuota(token.UserId, false)
		var userUsedQuota int
		if err == nil {
			userUsedQuota, err = model.GetUserUsedQuota(token.UserId)
		}
		if err != nil {
			common.SysError(common.LogText("failed to get user quota: %s", err.Error()))
			common.ApiErrorI18n(c, i18n.MsgTokenGetInfoFailed)
			return
		}
		data["user_quota"] = gin.H{
			"total_available": userQuota,
			"total_used":      userUsedQuota,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code":    true,
		"message": "ok",
		"data":    data,
	})
}

func AddToken(c *gin.Context) {
	request := tokenRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["name"] = request.Name
	request.Token.AllowUserQuotaQuery = request.AllowUserQuotaQuery == nil || *request.AllowUserQuotaQuery
	token := createUserToken(c, c.GetInt("id"), request.Token, request.AutoGroups.Groups)
	if token == nil {
		return
	}
	params["id"] = token.Id
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	// CoreCode fork: the id lets the console open the new key's setup guide.
	// The key itself is never returned here; reading it still goes through
	// POST /api/token/:id/key and its checks.
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"id": token.Id, "name": token.Name},
	})
}

// createUserToken validates a token request and inserts a token owned by userId. It writes the
// error response and returns nil when the request is rejected.
func createUserToken(c *gin.Context, userId int, token model.Token, autoGroups []string) *model.Token {
	if len(token.Name) > 50 {
		common.ApiErrorT(c, "Token name is too long")
		return nil
	}
	// 非无限额度时，检查额度值是否超出有效范围
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorT(c, "Quota value cannot be negative")
			return nil
		}
		maxQuotaValue := maxTokenQuota()
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorT(c, "Quota value exceeds valid range, maximum is {{max}}", map[string]any{"max": logger.FormatQuota(maxQuotaValue)})
			return nil
		}
	}
	// 检查用户令牌数量是否已达上限
	maxTokens := operation_setting.GetMaxUserTokens()
	count, err := model.CountUserTokens(userId)
	if err != nil {
		common.ApiError(c, err)
		return nil
	}
	if int(count) >= maxTokens {
		common.ApiErrorT(c, "Maximum number of tokens reached ({{max}})", map[string]any{"max": maxTokens})
		return nil
	}
	token.UserId = userId
	if token.Group == "auto" {
		if !setTokenAutoGroups(c, &token, autoGroups) {
			return nil
		}
	} else {
		token.CrossGroupRetry = false
		_ = token.SetAutoGroups(nil)
	}
	key, err := common.GenerateKey()
	if err != nil {
		common.ApiErrorT(c, "Failed to generate token")
		common.SysLog(common.LogText("failed to generate token key: %s", err.Error()))
		return nil
	}
	cleanToken := model.Token{
		UserId:              userId,
		Name:                token.Name,
		Key:                 key,
		CreatedTime:         common.GetTimestamp(),
		AccessedTime:        common.GetTimestamp(),
		ExpiredTime:         token.ExpiredTime,
		RemainQuota:         token.RemainQuota,
		UnlimitedQuota:      token.UnlimitedQuota,
		ModelLimitsEnabled:  token.ModelLimitsEnabled,
		ModelLimits:         token.ModelLimits,
		AllowIps:            token.AllowIps,
		Group:               token.Group,
		CrossGroupRetry:     token.CrossGroupRetry,
		AutoGroups:          token.AutoGroups,
		UpstreamKey:         token.UpstreamKey,
		AllowUserQuotaQuery: token.AllowUserQuotaQuery,
	}
	if err := cleanToken.Insert(); err != nil {
		common.ApiError(c, err)
		return nil
	}
	return &cleanToken
}

func DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	userId := c.GetInt("id")
	token, err := model.GetTokenByIds(id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params := tokenAuditParams(c)
	params["id"], params["name"] = token.Id, token.Name
	err = token.Delete()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
}

func UpdateToken(c *gin.Context) {
	userId := c.GetInt("id")
	statusOnly := c.Query("status_only")
	request := tokenRequest{}
	err := c.ShouldBindJSON(&request)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token := request.Token
	params := tokenAuditParams(c)
	if token.Id > 0 {
		params["id"] = token.Id
	}
	if len(token.Name) > 50 {
		common.ApiErrorT(c, "Token name is too long")
		return
	}
	if !token.UnlimitedQuota {
		if token.RemainQuota < 0 {
			common.ApiErrorT(c, "Quota value cannot be negative")
			return
		}
		maxQuotaValue := maxTokenQuota()
		if token.RemainQuota > maxQuotaValue {
			common.ApiErrorT(c, "Quota value exceeds valid range, maximum is {{max}}", map[string]any{"max": logger.FormatQuota(maxQuotaValue)})
			return
		}
	}
	cleanToken, err := model.GetTokenByIds(token.Id, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params["name"] = cleanToken.Name
	previous := *cleanToken
	if token.Status == common.TokenStatusEnabled && !tokenEnableAllowed(c, cleanToken) {
		return
	}
	if statusOnly != "" {
		cleanToken.Status = token.Status
	} else {
		// If you add more fields, please also update token.Update()
		cleanToken.Name = token.Name
		cleanToken.ExpiredTime = token.ExpiredTime
		cleanToken.RemainQuota = token.RemainQuota
		cleanToken.UnlimitedQuota = token.UnlimitedQuota
		cleanToken.ModelLimitsEnabled = token.ModelLimitsEnabled
		cleanToken.ModelLimits = token.ModelLimits
		cleanToken.AllowIps = token.AllowIps
		if request.AllowUserQuotaQuery != nil {
			cleanToken.AllowUserQuotaQuery = *request.AllowUserQuotaQuery
		}
		cleanToken.Group = token.Group
		cleanToken.CrossGroupRetry = token.CrossGroupRetry
		if token.Group != "auto" {
			cleanToken.CrossGroupRetry = false
			_ = cleanToken.SetAutoGroups(nil)
		} else if request.AutoGroups.Set {
			if !setTokenAutoGroups(c, cleanToken, request.AutoGroups.Groups) {
				return
			}
		}
	}
	err = cleanToken.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params["name"] = cleanToken.Name
	if statusOnly != "" {
		params["from"], params["to"] = previous.Status, cleanToken.Status
	} else {
		changedFields := []string{}
		for _, field := range []struct {
			name    string
			changed bool
		}{
			{"name", previous.Name != cleanToken.Name},
			{"expired_time", previous.ExpiredTime != cleanToken.ExpiredTime},
			{"remain_quota", previous.RemainQuota != cleanToken.RemainQuota},
			{"unlimited_quota", previous.UnlimitedQuota != cleanToken.UnlimitedQuota},
			{"model_limits_enabled", previous.ModelLimitsEnabled != cleanToken.ModelLimitsEnabled},
			{"model_limits", previous.ModelLimits != cleanToken.ModelLimits},
			{"allow_ips", (previous.AllowIps == nil) != (cleanToken.AllowIps == nil) ||
				(previous.AllowIps != nil && cleanToken.AllowIps != nil && *previous.AllowIps != *cleanToken.AllowIps)},
			{"allow_user_quota_query", previous.AllowUserQuotaQuery != cleanToken.AllowUserQuotaQuery},
			{"group", previous.Group != cleanToken.Group},
			{"cross_group_retry", previous.CrossGroupRetry != cleanToken.CrossGroupRetry},
			{"auto_groups", previous.AutoGroups != cleanToken.AutoGroups},
		} {
			if field.changed {
				changedFields = append(changedFields, field.name)
			}
		}
		params["changed_fields"] = changedFields
	}
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    buildMaskedTokenResponse(cleanToken),
	})
}

type TokenBatch struct {
	Ids []int `json:"ids"`
}

func DeleteTokenBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := tokenBatchAuditParams(c, tokenBatch.Ids)
	if len(tokenBatch.Ids) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId := c.GetInt("id")
	count, err := model.BatchDeleteTokens(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	params["count"] = count
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    count,
	})
}

func GetTokenKeysBatch(c *gin.Context) {
	tokenBatch := TokenBatch{}
	if err := c.ShouldBindJSON(&tokenBatch); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	params := tokenBatchAuditParams(c, tokenBatch.Ids)
	if len(tokenBatch.Ids) == 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if len(tokenBatch.Ids) > 100 {
		common.ApiErrorT(c, "Too many items in batch request, maximum is {{max}}", map[string]any{"max": 100})
		return
	}
	userId := c.GetInt("id")
	tokens, err := model.GetTokenKeysByIds(tokenBatch.Ids, userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	keysMap := make(map[int]string)
	returnedIDs := make([]int, 0, len(tokens))
	for _, t := range tokens {
		keysMap[t.Id] = t.GetFullKey()
		returnedIDs = append(returnedIDs, t.Id)
	}
	params["count"] = len(tokens)
	params["returned_ids"] = returnedIDs
	common.SetContextKey(c, constant.ContextKeyTokenAuditSucceeded, true)
	common.ApiSuccess(c, gin.H{"keys": keysMap})
}

// tokenEnableAllowed reports whether a stored expired or exhausted token may be enabled again.
// It writes the error response and returns false when it may not.
func tokenEnableAllowed(c *gin.Context, token *model.Token) bool {
	if token.Status == common.TokenStatusExpired && token.ExpiredTime <= common.GetTimestamp() && token.ExpiredTime != -1 {
		common.ApiErrorT(c, "Token has expired and cannot be enabled. Please modify the expiration time or set it to never expire")
		return false
	}
	if token.Status == common.TokenStatusExhausted && token.RemainQuota <= 0 && !token.UnlimitedQuota {
		common.ApiErrorT(c, "Token quota is exhausted and cannot be enabled. Please modify the remaining quota or set it to unlimited")
		return false
	}
	return true
}

const maxTokenUpstreamKeyLength = 256

// adminTokenOwner resolves the :id user of an administrator token route. The user must exist and
// rank below the caller, unless the caller is root.
func adminTokenOwner(c *gin.Context) (*model.User, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	owner, err := model.GetUserById(id, false)
	if err != nil {
		common.ApiError(c, err)
		return nil, false
	}
	if !canManageTargetRole(c.GetInt("role"), owner.Role) {
		common.ApiErrorT(c, "No permission to access users of same or higher level")
		return nil, false
	}
	return owner, true
}

// adminUserTokenRequest is the body of POST /api/admin/users/:id/tokens.
type adminUserTokenRequest struct {
	Name           string `json:"name"`
	Group          string `json:"group"`
	UnlimitedQuota bool   `json:"unlimited_quota"`
	RemainQuota    int    `json:"remain_quota"`
	ExpiredTime    int64  `json:"expired_time"`
	UpstreamKey    string `json:"upstream_key"`
}

// AdminCreateUserToken creates an API token for another user. The full key is returned once.
func AdminCreateUserToken(c *gin.Context) {
	owner, ok := adminTokenOwner(c)
	if !ok {
		return
	}
	var request adminUserTokenRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	upstreamKey := strings.TrimSpace(request.UpstreamKey)
	if len(upstreamKey) > maxTokenUpstreamKeyLength {
		common.ApiErrorT(c, "Upstream key is too long")
		return
	}
	token := createUserToken(c, owner.Id, model.Token{
		Name:           request.Name,
		Group:          request.Group,
		UnlimitedQuota: request.UnlimitedQuota,
		RemainQuota:    request.RemainQuota,
		ExpiredTime:    request.ExpiredTime,
		UpstreamKey:    upstreamKey,
		// Matches a user-created token that does not send the field.
		AllowUserQuotaQuery: true,
	}, nil)
	if token == nil {
		return
	}
	recordManageAuditFor(c, owner.Id, "user_token.create", map[string]any{"id": token.Id, "name": token.Name})
	// The stored key has no sk- prefix; users paste and see the prefixed form (see web api-keys).
	common.ApiSuccess(c, gin.H{"id": token.Id, "key": "sk-" + token.GetFullKey()})
}

// AdminListUserTokens lists one page of another user's API tokens. Keys are masked and the
// upstream key is never serialized.
func AdminListUserTokens(c *gin.Context) {
	owner, ok := adminTokenOwner(c)
	if !ok {
		return
	}
	pageInfo := common.GetPageQuery(c)
	tokens, err := model.GetAllUserTokens(owner.Id, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	total, err := model.CountUserTokens(owner.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(buildMaskedTokenResponses(tokens))
	common.ApiSuccess(c, pageInfo)
}

// AdminUpdateUserTokenStatus enables (1) or disables (2) one API token of another user.
func AdminUpdateUserTokenStatus(c *gin.Context) {
	owner, ok := adminTokenOwner(c)
	if !ok {
		return
	}
	tokenID, err := strconv.Atoi(c.Param("token_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var request struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		common.ApiError(c, err)
		return
	}
	if request.Status != common.TokenStatusEnabled && request.Status != common.TokenStatusDisabled {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	token, err := model.GetTokenByIds(tokenID, owner.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	previousStatus := token.Status
	if request.Status == common.TokenStatusEnabled && !tokenEnableAllowed(c, token) {
		return
	}
	token.Status = request.Status
	if err := token.SelectUpdate(); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, owner.Id, "user_token.update_status", map[string]any{"id": token.Id, "from": previousStatus, "to": token.Status})
	common.ApiSuccess(c, buildMaskedTokenResponse(token))
}

// AdminDeleteUserToken deletes one API token of another user.
func AdminDeleteUserToken(c *gin.Context) {
	owner, ok := adminTokenOwner(c)
	if !ok {
		return
	}
	tokenID, err := strconv.Atoi(c.Param("token_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetTokenByIds(tokenID, owner.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := token.Delete(); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, owner.Id, "user_token.delete", map[string]any{"id": token.Id, "name": token.Name})
	common.ApiSuccess(c, nil)
}
