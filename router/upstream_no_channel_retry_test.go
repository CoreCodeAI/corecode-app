package router

import (
	"io"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The answer another new-api gives when its group has no channel for the model.
const upstreamNoChannelBody = `{"error":{"message":"No available channel for model gpt-4o-mini under group welfare (distributor)","type":"new_api_error","param":"","code":"model_not_found"}}`

func respondNoChannelTo(key string) func(w http.ResponseWriter, attempt int, request capturedRequest) {
	return func(w http.ResponseWriter, _ int, request capturedRequest) {
		if request.Header.Get("Authorization") != "Bearer "+key {
			writeChat(w, request)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, upstreamNoChannelBody)
	}
}

// installChannels replaces every channel with channels, stored in order.
func (h *relayHarness) installChannels(t *testing.T, channels ...*model.Channel) {
	t.Helper()
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.Ability{}).Error)
	require.NoError(t, model.DB.Where("1 = 1").Delete(&model.Channel{}).Error)
	for _, channel := range channels {
		channel.Id = 0
		require.NoError(t, channel.Insert())
	}
	model.InitChannelCache()
}

func (h *relayHarness) errorLogs(t *testing.T) []model.Log {
	t.Helper()
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("type = ?", model.LogTypeError).Order("id").Find(&logs).Error)
	return logs
}

func TestUpstreamWithoutChannelIsNotAskedAgain(t *testing.T) {
	previousRetry, previousErrorLog := common.RetryTimes, constant.ErrorLogEnabled
	common.RetryTimes, constant.ErrorLogEnabled = 2, true
	t.Cleanup(func() { common.RetryTimes, constant.ErrorLogEnabled = previousRetry, previousErrorLog })

	t.Run("its only channel", func(t *testing.T) {
		harness := newRelayHarness(t)
		harness.upstream.respond = respondNoChannelTo("empty-pool")
		harness.installChannels(t, harness.newChannel(constant.ChannelTypeOpenAI, "empty-pool"))

		outcome := harness.post(t, "/v1/chat/completions", relayTestBody)

		assert.Equal(t, http.StatusServiceUnavailable, outcome.status, outcome.body)
		assert.Contains(t, outcome.body, "No available channel for model gpt-4o-mini under group welfare", "the client sees the upstream's answer")
		assert.Len(t, harness.upstream.captured(), 1, "the retries are not sent to the same upstream")
		assert.Len(t, harness.errorLogs(t), 1, "one failed attempt writes one error log")
		assert.Zero(t, outcome.quota)
	})

	t.Run("another channel serves the retry", func(t *testing.T) {
		harness := newRelayHarness(t)
		harness.upstream.respond = respondNoChannelTo("empty-pool")
		empty := harness.newChannel(constant.ChannelTypeOpenAI, "empty-pool")
		empty.Priority = common.GetPointer(int64(10))
		serving := harness.newChannel(constant.ChannelTypeOpenAI, "serving-pool")
		serving.Priority = common.GetPointer(int64(5))
		harness.installChannels(t, empty, serving)

		outcome := harness.post(t, "/v1/chat/completions", relayTestBody)

		require.Equal(t, http.StatusOK, outcome.status, outcome.body)
		requests := harness.upstream.captured()
		require.Len(t, requests, 2)
		assert.Equal(t, "Bearer empty-pool", requests[0].Header.Get("Authorization"))
		assert.Equal(t, "Bearer serving-pool", requests[1].Header.Get("Authorization"))
	})

	t.Run("other 503s still retry the same channel", func(t *testing.T) {
		harness := newRelayHarness(t)
		harness.upstream.respond = func(w http.ResponseWriter, _ int, _ capturedRequest) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":{"message":"overloaded","type":"upstream_error","code":"server_overloaded"}}`)
		}
		harness.installChannels(t, harness.newChannel(constant.ChannelTypeOpenAI, "busy-pool"))

		outcome := harness.post(t, "/v1/chat/completions", relayTestBody)

		assert.Equal(t, http.StatusServiceUnavailable, outcome.status, outcome.body)
		assert.Len(t, harness.upstream.captured(), 3, "a pool may answer the next attempt from another account")
	})
}
