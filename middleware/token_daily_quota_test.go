package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTokenDailyQuota(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousDB, previousBatch, previousRedis := model.DB, common.BatchUpdateEnabled, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Token{}))
	model.DB, common.BatchUpdateEnabled, common.RedisEnabled = db, false, false
	t.Cleanup(func() {
		model.DB, common.BatchUpdateEnabled, common.RedisEnabled = previousDB, previousBatch, previousRedis
	})

	token := &model.Token{UserId: 1, Key: "daily-key", Name: "daily", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 10_000, DailyQuota: 300}
	require.NoError(t, db.Create(token).Error)
	// The router sets up the token the way TokenAuth does, then runs the cap.
	request := func(token *model.Token) *httptest.ResponseRecorder {
		router := gin.New()
		router.POST("/v1/messages", func(c *gin.Context) {
			require.NoError(t, SetupContextForToken(c, token))
		}, TokenDailyQuota(), func(c *gin.Context) { c.Status(http.StatusOK) })
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/v1/messages", nil))
		return recorder
	}

	assert.Equal(t, http.StatusOK, request(token).Code, "nothing used today")
	require.NoError(t, model.DecreaseTokenQuota(token.Id, token.Key, 299))
	assert.Equal(t, http.StatusOK, request(token).Code, "below the cap")

	require.NoError(t, model.DecreaseTokenQuota(token.Id, token.Key, 1))
	rejected := request(token)
	assert.Equal(t, http.StatusForbidden, rejected.Code, "at the cap")
	assert.Contains(t, rejected.Body.String(), "daily quota")

	unlimited := *token
	unlimited.UnlimitedQuota = true
	assert.Equal(t, http.StatusOK, request(&unlimited).Code, "an unlimited token has no daily cap")

	require.NoError(t, db.Model(token).Update("daily_used_until", time.Now().Add(-time.Hour).Unix()).Error)
	assert.Equal(t, http.StatusOK, request(token).Code, "yesterday's use does not count")
}
