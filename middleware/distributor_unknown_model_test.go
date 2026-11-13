package middleware

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A model no channel lists is answered on /v1/messages the way Anthropic
// answers it, so Claude Code falls back at once instead of retrying a 503.
func TestDistributeAnswersUnlistedClaudeModelWithNotFound(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousDB, previousMain, previousLog := model.DB, common.MainDatabaseType(), common.LogDatabaseType()
	previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
	previousCache, previousRedis := common.MemoryCacheEnabled, common.RedisEnabled
	common.SQLitePath, common.IsMasterNode, common.RedisEnabled = t.TempDir()+"/unknown-model.db", false, false
	t.Setenv("SQL_DSN", "")
	require.NoError(t, model.InitDB())
	database := model.DB
	require.NoError(t, database.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.Log{}, &model.User{}))
	previousLogDB, previousErrorLog := model.LOG_DB, constant.ErrorLogEnabled
	model.LOG_DB, constant.ErrorLogEnabled = database, true
	t.Cleanup(func() {
		model.DB = previousDB
		model.LOG_DB, constant.ErrorLogEnabled = previousLogDB, previousErrorLog
		common.SetDatabaseTypes(previousMain, previousLog)
		common.SQLitePath, common.IsMasterNode = previousPath, previousMaster
		common.MemoryCacheEnabled, common.RedisEnabled = previousCache, previousRedis
		if previousDB != nil {
			model.InitChannelCache()
		}
		sqlDB, err := database.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})

	const group = "unknown-model-test"
	for _, channel := range []*model.Channel{
		{Type: constant.ChannelTypeAnthropic, Status: common.ChannelStatusEnabled, Name: "served", Key: "served-key", Group: group, Models: "claude-opus-5-5"},
		{Type: constant.ChannelTypeAnthropic, Status: common.ChannelStatusAutoDisabled, Name: "down", Key: "down-key", Group: group, Models: "claude-haiku-5-5"},
	} {
		require.NoError(t, channel.Insert())
	}

	for _, memoryCache := range []bool{false, true} {
		common.MemoryCacheEnabled = memoryCache
		model.InitChannelCache()
		for _, tc := range []struct {
			name, path, model string
			wantStatus        int
			wantBody          string
			// recorded is whether the refusal is written as a no_channel
			// error log. A model no channel lists is the customer's mistake,
			// with or without the channel cache, so it is never recorded.
			recorded bool
		}{
			{name: "unlisted model on messages", path: "/v1/messages", model: "claude-sonnet-5", wantStatus: http.StatusNotFound,
				wantBody: `{"type":"error","error":{"type":"not_found_error","message":"model: claude-sonnet-5 (request id: %s)"}}`},
			{name: "listed model with every channel down", path: "/v1/messages", model: "claude-haiku-5-5", wantStatus: http.StatusServiceUnavailable, recorded: true},
			{name: "unlisted model on chat completions", path: "/v1/chat/completions", model: "claude-sonnet-5", wantStatus: http.StatusNotFound},
			{name: "served model", path: "/v1/messages", model: "claude-opus-5-5", wantStatus: http.StatusNoContent},
		} {
			t.Run(fmt.Sprintf("memory_cache=%t/%s", memoryCache, tc.name), func(t *testing.T) {
				require.NoError(t, database.Where("1 = 1").Delete(&model.Log{}).Error)
				router := gin.New()
				router.POST(tc.path, RequestId(), func(c *gin.Context) {
					common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
				}, Distribute(), func(c *gin.Context) {
					c.Status(http.StatusNoContent)
				})
				body := []byte(fmt.Sprintf(`{"model":%q,"max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`, tc.model))
				request := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)

				require.Equal(t, tc.wantStatus, recorder.Code, recorder.Body.String())
				switch {
				case tc.wantStatus == http.StatusNotFound && tc.path != "/v1/messages":
					assert.Contains(t, recorder.Body.String(), `"code":"model_not_found"`)
				case tc.wantStatus == http.StatusNotFound:
					assert.JSONEq(t, fmt.Sprintf(tc.wantBody, recorder.Header().Get(common.RequestIdKey)), recorder.Body.String())
				case tc.wantStatus == http.StatusServiceUnavailable:
					assert.Contains(t, recorder.Body.String(), `"code":"model_not_found"`)
				}

				var logs []model.Log
				require.NoError(t, database.Find(&logs).Error)
				if !tc.recorded {
					assert.Empty(t, logs)
					return
				}
				require.Len(t, logs, 1)
				assert.Equal(t, model.LogTypeError, logs[0].Type)
				assert.Zero(t, logs[0].ChannelId, "no channel was tried")
				assert.Equal(t, tc.model, logs[0].ModelName)
				assert.Equal(t, group, logs[0].Group)
				assert.Equal(t, model.NoChannelErrorContent(http.StatusServiceUnavailable, group), logs[0].Content)
				assert.Equal(t, recorder.Header().Get(common.RequestIdKey), logs[0].RequestId)
				assert.Contains(t, logs[0].Other, `"error_code":"no_channel"`)
			})
		}
	}

	constant.ErrorLogEnabled = false
	require.NoError(t, database.Where("1 = 1").Delete(&model.Log{}).Error)
	router := gin.New()
	router.POST("/v1/messages", RequestId(), func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
	}, Distribute())
	request := httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader([]byte(`{"model":"claude-haiku-5-5","max_tokens":16,"messages":[]}`)))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	var count int64
	require.NoError(t, database.Model(&model.Log{}).Count(&count).Error)
	assert.Zero(t, count, "the switch that gates error logs gates the refusal too")
}
