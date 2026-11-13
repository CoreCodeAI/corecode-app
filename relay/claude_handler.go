package relay

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relay/requestplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"

	"github.com/gin-gonic/gin"
)

func ClaudeHelper(c *gin.Context, info *relaycommon.RelayInfo) (newAPIError *types.NewAPIError) {

	info.InitChannelMeta(c)

	claudeReq, ok := info.Request.(*dto.ClaudeRequest)

	if !ok {
		return types.NewErrorWithStatusCode(fmt.Errorf("invalid request type, expected *dto.ClaudeRequest, got %T", info.Request), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}

	stopOutboundBuild := service.TimeOutboundBuild(c)
	passThrough := model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled
	var request *dto.ClaudeRequest
	if passThrough {
		// The received body goes upstream unchanged, so this copy is never
		// sent. The steps below only assign its top-level fields (model,
		// system), which a shallow copy keeps off info.Request.
		shallow := *claudeReq
		request = &shallow
	} else {
		copied, err := common.DeepCopy(claudeReq)
		if err != nil {
			return types.NewError(fmt.Errorf("failed to copy request to ClaudeRequest: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		}
		request = copied
	}

	err := helper.ModelMappedHelper(c, info, request)
	if err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ApplyReasoningModelSuffix(c, info, request); err != nil {
		return newConvertRequestFailedError(c, info, err)
	}

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	// Each attempt decides the ttl beta afresh: a retry on another channel
	// must not inherit the previous attempt's rewrite.
	common.SetContextKey(c, constant.ContextKeyClaudeDefaultCacheTTL, false)
	c.Set(service.DefaultCacheTTLLogKey, "")

	if info.ChannelSetting.SystemPrompt != "" {
		if request.System == nil {
			request.SetStringSystem(info.ChannelSetting.SystemPrompt)
		} else if info.ChannelSetting.SystemPromptOverride {
			common.SetContextKey(c, constant.ContextKeySystemPromptOverride, true)
			if request.IsStringSystem() {
				existing := strings.TrimSpace(request.GetStringSystem())
				if existing == "" {
					request.SetStringSystem(info.ChannelSetting.SystemPrompt)
				} else {
					request.SetStringSystem(info.ChannelSetting.SystemPrompt + "\n" + existing)
				}
			} else {
				systemContents := request.ParseSystem()
				newSystem := dto.ClaudeMediaMessage{Type: dto.ContentTypeText}
				newSystem.SetText(info.ChannelSetting.SystemPrompt)
				if len(systemContents) == 0 {
					request.System = []dto.ClaudeMediaMessage{newSystem}
				} else {
					request.System = append([]dto.ClaudeMediaMessage{newSystem}, systemContents...)
				}
			}
		}
	}

	if !passThrough &&
		service.ShouldChatCompletionsUseResponsesGlobal(info.ChannelId, info.ChannelType, info.OriginModelName) {
		usage, newApiErr := textRequestViaResponses(c, info, adaptor, request)
		if newApiErr != nil {
			return newApiErr
		}

		service.PostTextConsumeQuota(c, info, usage, nil)
		return nil
	}

	var requestBody io.Reader
	// bodyBeforeDefaultTTL is the body as it was before the relay gave its
	// breakpoints the default ttl, kept until the upstream answers so a
	// rejection of the rewrite can be resent without it.
	var bodyBeforeDefaultTTL []byte
	if passThrough {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if newAPIError = requestplugin.PassThrough(c, info, storage); newAPIError != nil {
			return newAPIError
		}
		requestBody = common.NewReplayableBodyReader(storage)
	} else {
		convertedRequest, err := adaptor.ConvertClaudeRequest(c, info, request)
		if err != nil {
			return newConvertRequestFailedError(c, info, err)
		}
		relaycommon.AppendRequestConversionFromRequest(info, convertedRequest)
		jsonData, err := common.Marshal(convertedRequest)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}

		// remove disabled fields for Claude API
		jsonData, err = relaycommon.RemoveDisabledFields(jsonData, info.ChannelOtherSettings, info.ChannelSetting.PassThroughBodyEnabled)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}

		if jsonData, newAPIError = requestplugin.Outbound(c, info, jsonData); newAPIError != nil {
			return newAPIError
		}
		// apply param override
		if len(info.ParamOverride) > 0 {
			jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
			if err != nil {
				return newAPIErrorFromParamOverride(err)
			}
		}
		// Claude Code's breakpoints default to 5 minutes, which a pause while
		// a task runs outlasts; give a long prompt 1 hour unless the client
		// chose. A short prompt keeps 5 minutes: rewriting it after a pause is
		// cheap, and the 1h write price on every turn would cost more. A
		// non-stream request is skipped: Claude Code sends those for auto
		// mode checks, whose cache writes are never read back. Switching ttl
		// between turns keeps the cached prefix, so crossing the threshold
		// costs no rewrite. It runs after the param override, so a ttl an
		// operator's override wrote counts as the client's choice.
		claudeSettings := model_setting.GetClaudeSettings()
		if info.ChannelType == constant.ChannelTypeAnthropic && info.IsStream &&
			claudeSettings.DefaultPromptCacheTTL == "1h" &&
			info.GetEstimatePromptTokens() >= claudeSettings.DefaultPromptCacheTTLMinTokens {
			if rewritten, changed := relaycommon.DefaultPromptCacheTTL(jsonData, claudeSettings.DefaultPromptCacheTTL); changed {
				bodyBeforeDefaultTTL = jsonData
				jsonData = rewritten
				common.SetContextKey(c, constant.ContextKeyClaudeDefaultCacheTTL, true)
				c.Set(service.DefaultCacheTTLLogKey, claudeSettings.DefaultPromptCacheTTL)
			}
		}

		if newAPIError = requestplugin.Egress(c, info, jsonData); newAPIError != nil {
			return newAPIError
		}

		logger.LogDebug(c, "requestBody: %s", jsonData)
		body, closer, err := relaycommon.NewOutboundJSONBody(jsonData)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
		defer closer.Close()
		jsonData = nil
		requestBody = body
	}

	stopOutboundBuild()

	statusCodeMappingStr := c.GetString("status_code_mapping")
	var httpResp *http.Response
	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}

	if resp != nil && bodyBeforeDefaultTTL != nil && rejectsDefaultCacheTTL(resp.(*http.Response)) {
		// The upstream refused the breakpoints the relay rewrote. Send the
		// client's body once more, as it came and without the beta, so the
		// default can never fail a request the client's own body would pass.
		logger.LogWarn(c, "upstream rejected the default prompt cache ttl; resending the client's breakpoints")
		_ = resp.(*http.Response).Body.Close()
		common.SetContextKey(c, constant.ContextKeyClaudeDefaultCacheTTL, false)
		c.Set(service.DefaultCacheTTLLogKey, "rejected")
		body, closer, err := relaycommon.NewOutboundJSONBody(bodyBeforeDefaultTTL)
		if err != nil {
			return types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
		}
		defer closer.Close()
		resp, err = adaptor.DoRequest(c, info, body)
		if err != nil {
			return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
		}
	}
	bodyBeforeDefaultTTL = nil

	if resp != nil {
		httpResp = resp.(*http.Response)
		info.IsStream = info.IsStream || strings.HasPrefix(httpResp.Header.Get("Content-Type"), "text/event-stream")
		if httpResp.StatusCode != http.StatusOK {
			newAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			// reset status code 重置状态码
			service.ResetStatusCode(newAPIError, statusCodeMappingStr)
			return newAPIError
		}
	}

	usage, newAPIError := adaptor.DoResponse(c, httpResp, info)
	if newAPIError != nil {
		// reset status code 重置状态码
		service.ResetStatusCode(newAPIError, statusCodeMappingStr)
		return newAPIError
	}

	service.PostTextConsumeQuota(c, info, usage.(*dto.Usage), nil)
	return nil
}

// rejectsDefaultCacheTTL reports whether a response is a 400 about cache
// breakpoints or the extended cache ttl beta. It reads at most 64 KB of the
// body and puts what it read back in front of the rest, so a response it
// does not claim reaches the error handler unchanged.
func rejectsDefaultCacheTTL(resp *http.Response) bool {
	if resp == nil || resp.StatusCode != http.StatusBadRequest || resp.Body == nil {
		return false
	}
	head, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	resp.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytes.NewReader(head), resp.Body), resp.Body}
	text := string(head)
	return strings.Contains(text, "cache_control") || strings.Contains(text, relaycommon.ExtendedCacheTTLBeta)
}
