package middleware

import (
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// TokenDailyQuota rejects a request that spends quota while its token has
// used its daily quota in the current Beijing day. It runs where
// ModelRequestRateLimit does, after TokenAuth, so listing models and reading
// a task's result stay open once the cap is reached. It admits a request while
// use is below the cap, so requests already in flight may end the day above
// it. A 403 rather than a 429, since a client that retries a 429 would only
// wait for midnight.
func TokenDailyQuota() gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := c.GetInt("token_daily_quota")
		if limit <= 0 || c.GetBool("token_unlimited_quota") {
			c.Next()
			return
		}
		tokenID := c.GetInt("token_id")
		used, err := model.TokenDailyUsed(tokenID, time.Now())
		if err != nil {
			common.SysLog(common.LogText("TokenDailyQuota error for token %d: %v", tokenID, err))
			abortWithOpenAiMessage(c, http.StatusInternalServerError, common.TranslateMessage(c, i18n.MsgDatabaseError))
			return
		}
		if used >= limit {
			abortWithOpenAiMessage(c, http.StatusForbidden,
				i18n.T(c, i18n.MsgTokenDailyQuotaExhausted, map[string]any{"Quota": logger.FormatQuota(limit)}))
			return
		}
		c.Next()
	}
}
