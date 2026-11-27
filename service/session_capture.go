package service

import (
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/sessioncapture"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// Session capture is the internal audit copy of a customer request and each of
// its upstream responses. These helpers keep the relay code to one call per
// hook: the switch, the sampling and the pipeline decide whether anything is
// copied, and a capture failure never surfaces to the request.

const (
	sessionCaptureProtocolChatCompletions = "openai-completions"
	sessionCaptureProtocolResponses       = "openai-responses"
	sessionCaptureProtocolImages          = "openai-images"
	sessionCaptureProtocolVideo           = "video"
)

// StartSessionCapture begins recording a relay request when the
// session_capture_setting switch is on, the customer is sampled and the
// process has a capture pipeline. It returns nil when nothing is captured.
func StartSessionCapture(c *gin.Context) *sessioncapture.Request {
	if request := sessioncapture.RequestFrom(c); request != nil {
		return request
	}
	pipeline := sessioncapture.Current()
	if pipeline == nil {
		return nil
	}
	setting := operation_setting.GetSessionCaptureSetting()
	if setting == nil || !setting.Enabled {
		return nil
	}
	requestID := c.GetString(common.RequestIdKey)
	if !sessioncapture.ValidRequestID(requestID) {
		return nil
	}
	if !sessioncapture.Sampled(strconv.Itoa(c.GetInt("id")), setting.SamplePercent) {
		return nil
	}
	request := pipeline.Begin(requestID)
	sessioncapture.AttachRequest(c, request)
	return request
}

// BeginSessionCaptureAttempt opens the attempt for the channel selected for
// the next upstream call. Attempts on channels outside the option's list are
// not copied.
func BeginSessionCaptureAttempt(c *gin.Context, channel *model.Channel) {
	request := sessioncapture.RequestFrom(c)
	if request == nil || channel == nil {
		return
	}
	setting := operation_setting.GetSessionCaptureSetting()
	if setting == nil || !slices.Contains(setting.ChannelIDs, channel.Id) {
		return
	}
	attempt := request.StartAttempt(channel.Id, constant.GetChannelTypeName(channel.Type))
	sessioncapture.AttachAttempt(c, attempt)
}

// EndSessionCaptureAttempt closes the attempt BeginSessionCaptureAttempt
// opened with what the attempt settled: the upstream model it used, the
// status the client got, and "ok" or the error code. It does nothing when no
// attempt is open.
func EndSessionCaptureAttempt(c *gin.Context, upstreamModel string, status int, failureCategory string) {
	attempt := sessioncapture.TakeAttempt(c)
	if attempt == nil {
		return
	}
	attempt.End(upstreamModel, status, failureCategory)
}

// CompleteSessionCapture publishes the request's capture once, after its final
// attempt. status is the status the client received; 0 derives it from the
// writer. Nothing is copied when no attempt ran on a listed channel.
func CompleteSessionCapture(c *gin.Context, request *sessioncapture.Request, info *relaycommon.RelayInfo, format types.RelayFormat, status int) {
	if request == nil || info == nil {
		return
	}
	if status == 0 {
		status = http.StatusOK
		if c.Writer.Written() {
			status = c.Writer.Status()
		}
	}
	var duration time.Duration
	if !info.StartTime.IsZero() {
		duration = time.Since(info.StartTime)
	}
	request.Complete(c, sessioncapture.Completion{
		RequestID:  c.GetString(common.RequestIdKey),
		Protocol:   sessionCaptureProtocol(format),
		Model:      info.OriginModelName,
		Status:     status,
		Stream:     info.IsStream,
		DurationMs: duration.Milliseconds(),
		Usage:      sessionCaptureUsage(c),
	})
}

func sessionCaptureProtocol(format types.RelayFormat) string {
	switch format {
	case types.RelayFormatOpenAI:
		return sessionCaptureProtocolChatCompletions
	case types.RelayFormatOpenAIResponses:
		return sessionCaptureProtocolResponses
	case types.RelayFormatOpenAIImage:
		return sessionCaptureProtocolImages
	case types.RelayFormatTask:
		return sessionCaptureProtocolVideo
	default:
		return string(format)
	}
}

// sessionCaptureUsage reads the settled token usage from the request's consume
// log, which is recorded whether or not consume logs are kept. input_tokens
// excludes the cache tokens when the log counted them inside prompt_tokens.
func sessionCaptureUsage(c *gin.Context) sessioncapture.Usage {
	params, ok := common.GetContextKeyType[*model.RecordConsumeLogParams](c, constant.ContextKeyConsumeLog)
	if !ok || params == nil {
		return sessioncapture.Usage{}
	}
	other := params.Other.Snapshot()
	usage := sessioncapture.Usage{
		InputTokens:      int64(params.PromptTokens),
		CacheReadTokens:  int64(logOtherInt(other, "cache_tokens")),
		CacheWriteTokens: int64(logOtherInt(other, "cache_write_tokens")),
		OutputTokens:     int64(params.CompletionTokens),
	}
	if usage.CacheWriteTokens == 0 {
		usage.CacheWriteTokens = int64(logOtherInt(other, "cache_creation_tokens"))
	}
	if params.PromptIncludesCache {
		usage.InputTokens -= usage.CacheReadTokens + usage.CacheWriteTokens
		if usage.InputTokens < 0 {
			usage.InputTokens = 0
		}
	}
	return usage
}

func logOtherInt(other map[string]any, key string) int {
	switch value := other[key].(type) {
	case int:
		return value
	case int32:
		return int(value)
	case int64:
		return int(value)
	case float64:
		return int(value)
	default:
		return 0
	}
}
