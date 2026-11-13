package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A request no channel of its groups can ever take is answered with a 4xx
// that says what to change, never a 503 a client retries: a model only other
// groups serve names the groups the user may switch to, and a model sent to
// an endpoint its channels do not serve is a 400. An outage keeps the 503.
func TestDistributeExplainsModelsTheRequestCannotReach(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousDB, previousMain, previousLog := model.DB, common.MainDatabaseType(), common.LogDatabaseType()
	previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
	previousCache, previousRedis := common.MemoryCacheEnabled, common.RedisEnabled
	previousUsable, previousAuto := setting.UserUsableGroups2JSONString(), setting.AutoGroups2JsonString()
	previousRatio := ratio_setting.GroupRatio2JSONString()
	common.SQLitePath, common.IsMasterNode, common.RedisEnabled = t.TempDir()+"/unservable-model.db", false, false
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
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(previousAuto))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatio))
		if previousDB != nil {
			model.InitChannelCache()
		}
		sqlDB, err := database.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})

	// The user may use claude and gpt; welfare is usable too but is not in
	// the auto list; staff is a group the user may not use.
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"claude":"","gpt":"","welfare":"","auto":""}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["claude","gpt"]`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"claude":1,"gpt":1,"welfare":0.5,"staff":1}`))

	chatOnly := &model.Channel{Type: constant.ChannelTypeAdvancedCustom, Status: common.ChannelStatusEnabled, Name: "chat-only", Key: "chat-only-key", Group: "gpt", Models: "chat-only-model"}
	chatOnly.SetOtherSettings(dto.ChannelOtherSettings{AdvancedCustom: &dto.AdvancedCustomConfig{
		Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/chat/completions", UpstreamPath: "/v1/chat/completions"}},
	}})
	for _, channel := range []*model.Channel{
		{Type: constant.ChannelTypeAnthropic, Status: common.ChannelStatusEnabled, Name: "claude", Key: "claude-key", Group: "claude", Models: "claude-opus-5-5"},
		{Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "gpt", Key: "gpt-key", Group: "gpt", Models: "gpt-6.1-sol"},
		{Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "welfare", Key: "welfare-key", Group: "welfare,staff", Models: "gpt-5.6-sol"},
		{Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Name: "staff", Key: "staff-key", Group: "staff", Models: "internal-model"},
		{Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusAutoDisabled, Name: "down", Key: "down-key", Group: "gpt", Models: "gpt-6-astra"},
		chatOnly,
	} {
		require.NoError(t, channel.Insert())
	}

	for _, memoryCache := range []bool{false, true} {
		common.MemoryCacheEnabled = memoryCache
		model.InitChannelCache()
		for _, tc := range []struct {
			name, group, path, model string
			wantStatus               int
			// wantMessage is a fragment of the error message; recorded is
			// whether the refusal is written as a no_channel error log.
			wantMessage string
			recorded    bool
		}{
			{name: "gpt model on a claude key, messages", group: "claude", path: "/v1/messages", model: "gpt-6.1-sol",
				wantStatus: http.StatusNotFound, wantMessage: "model: gpt-6.1-sol. This key's group claude does not offer model gpt-6.1-sol. Groups that offer it: gpt.", recorded: true},
			{name: "gpt model on a claude key, responses", group: "claude", path: "/v1/responses", model: "gpt-6.1-sol",
				wantStatus: http.StatusNotFound, wantMessage: "Groups that offer it: gpt. Change the key's group", recorded: true},
			{name: "model outside the auto list names its usable group", group: "auto", path: "/v1/responses", model: "gpt-5.6-sol",
				wantStatus: http.StatusNotFound, wantMessage: "This key's group auto does not offer model gpt-5.6-sol. Groups that offer it: welfare.", recorded: true},
			{name: "model only a group the user may not use serves", group: "gpt", path: "/v1/responses", model: "internal-model",
				wantStatus: http.StatusNotFound, wantMessage: "Model internal-model does not exist or has been retired", recorded: true},
			{name: "model on an endpoint its channel does not serve", group: "auto", path: "/v1/messages", model: "chat-only-model",
				wantStatus: http.StatusBadRequest, wantMessage: "Model chat-only-model is not served on /v1/messages", recorded: true},
			{name: "every channel of the model is down", group: "gpt", path: "/v1/responses", model: "gpt-6-astra",
				wantStatus: http.StatusServiceUnavailable, wantMessage: "No available channel for model gpt-6-astra under group gpt", recorded: true},
			{name: "unlisted model", group: "gpt", path: "/v1/responses", model: "gpt-9",
				wantStatus: http.StatusNotFound, wantMessage: "Model gpt-9 does not exist or has been retired"},
			{name: "served model through auto", group: "auto", path: "/v1/chat/completions", model: "chat-only-model", wantStatus: http.StatusNoContent},
			{name: "served model", group: "gpt", path: "/v1/responses", model: "gpt-6.1-sol", wantStatus: http.StatusNoContent},
		} {
			t.Run(fmt.Sprintf("memory_cache=%t/%s", memoryCache, tc.name), func(t *testing.T) {
				require.NoError(t, database.Where("1 = 1").Delete(&model.Log{}).Error)
				router := gin.New()
				router.POST(tc.path, RequestId(), func(c *gin.Context) {
					common.SetContextKey(c, constant.ContextKeyUsingGroup, tc.group)
					common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
				}, Distribute(), func(c *gin.Context) {
					c.Status(http.StatusNoContent)
				})
				body := []byte(fmt.Sprintf(`{"model":%q,"max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`, tc.model))
				request := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)

				require.Equal(t, tc.wantStatus, recorder.Code, recorder.Body.String())
				if tc.wantStatus == http.StatusNoContent {
					return
				}
				var answer struct {
					Error struct {
						Message string `json:"message"`
						Type    string `json:"type"`
						Code    string `json:"code"`
					} `json:"error"`
				}
				require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &answer), recorder.Body.String())
				assert.Contains(t, answer.Error.Message, tc.wantMessage)
				assert.NotContains(t, answer.Error.Message, "staff", "a group the user may not use is never named")
				switch {
				case tc.path == "/v1/messages" && tc.wantStatus == http.StatusNotFound:
					assert.Equal(t, "not_found_error", answer.Error.Type)
				case tc.wantStatus == http.StatusNotFound:
					assert.Equal(t, "model_not_found", answer.Error.Code)
				case tc.wantStatus == http.StatusBadRequest:
					assert.Equal(t, "invalid_request", answer.Error.Code)
				}

				var logs []model.Log
				require.NoError(t, database.Find(&logs).Error)
				if !tc.recorded {
					assert.Empty(t, logs)
					return
				}
				require.Len(t, logs, 1)
				assert.Equal(t, model.NoChannelErrorContent(tc.wantStatus, tc.group), logs[0].Content)
				assert.Contains(t, logs[0].Other, `"error_code":"no_channel"`)
			})
		}
	}
}
