package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const noAccountsBody = `{"error":{"message":"No eligible accounts","type":"no_eligible_account"}}`

// A video channel whose vendor has no capacity answers 503. The retry then
// found no other channel and the client got "no available channel (retry)",
// which hid both the cause and that nothing was charged.
func TestTaskSubmissionRetryWithoutAnotherChannelKeepsTheUpstreamError(t *testing.T) {
	require.NoError(t, i18n.Init())
	previous := common.RetryTimes
	common.RetryTimes = 2
	t.Cleanup(func() { common.RetryTimes = previous })
	events := make([]string, 0, 3)
	setupTaskSubmissionDatabase(t, false, &events)
	billing := &taskSubmissionTestBilling{events: &events}
	c := taskSubmissionTestContext()
	c.Set("channel_id", 10)
	info := taskSubmissionRelayInfo(billing)
	// The distributor picked the first channel; retries select again.
	info.TaskRelayInfo.LockedChannel = nil
	info.ChannelMeta = nil
	info.TokenGroup = "default"

	attempts := 0
	outcome, taskErr := executeTaskSubmissionWith(c, info, func(_ *gin.Context, info *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		attempts++
		info.ChannelMeta = &relaycommon.ChannelMeta{ChannelId: 10, ChannelType: constant.ChannelTypeTaskPlugin}
		return nil, service.TaskErrorWrapper(errors.New(noAccountsBody), "fail_to_fetch_task", http.StatusServiceUnavailable)
	})

	assert.Nil(t, outcome)
	require.NotNil(t, taskErr)
	assert.Equal(t, 1, attempts, "the retry found no channel to attempt")
	assert.Equal(t, "fail_to_fetch_task", taskErr.Code)
	assert.Equal(t, http.StatusServiceUnavailable, taskErr.StatusCode)
	assert.Equal(t, noAccountsBody, taskErr.Message)
	assert.Equal(t, 1, billing.refunds)
}

func TestTaskSubmissionWithoutAnyChannelStillSaysSo(t *testing.T) {
	require.NoError(t, i18n.Init())
	events := make([]string, 0, 3)
	setupTaskSubmissionDatabase(t, false, &events)
	c := taskSubmissionTestContext()
	info := taskSubmissionRelayInfo(&taskSubmissionTestBilling{events: &events})
	info.TaskRelayInfo.LockedChannel = nil
	info.TokenGroup = "default"

	_, taskErr := executeTaskSubmissionWith(c, info, func(*gin.Context, *relaycommon.RelayInfo) (*relay.TaskSubmitResult, *dto.TaskError) {
		t.Fatal("no channel, so no attempt")
		return nil, nil
	})

	require.NotNil(t, taskErr)
	assert.Equal(t, "get_channel_failed", taskErr.Code)
}

func TestSubmissionErrorExplainsAnUpstreamOutage(t *testing.T) {
	require.NoError(t, i18n.Init())
	respond := func(taskErr *dto.TaskError) (int, dto.TaskError) {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
		respondTaskSubmissionError(c, taskErr)
		var body dto.TaskError
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &body))
		return recorder.Code, body
	}

	status, body := respond(service.TaskErrorWrapper(errors.New(noAccountsBody), "fail_to_fetch_task", http.StatusServiceUnavailable))
	assert.Equal(t, http.StatusServiceUnavailable, status)
	assert.Equal(t, "fail_to_fetch_task", body.Code)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)
	assert.Equal(t, i18n.T(c, i18n.MsgRelayTaskUpstreamUnavailable)+" (No eligible accounts)", body.Message)

	// A plain-text reply is kept as text, and a 4xx is the client's to fix, so it is left alone.
	_, body = respond(service.TaskErrorWrapper(errors.New("bad gateway"), "fail_to_fetch_task", http.StatusBadGateway))
	assert.Contains(t, body.Message, "(bad gateway)")
	_, body = respond(service.TaskErrorWrapper(errors.New(`{"error":{"message":"prompt is required"}}`), "fail_to_fetch_task", http.StatusBadRequest))
	assert.Equal(t, `{"error":{"message":"prompt is required"}}`, body.Message)
	// A local failure is not the vendor's.
	_, body = respond(service.TaskErrorWrapperLocal(errors.New("insert failed"), "task_insert_failed", http.StatusInternalServerError))
	assert.Equal(t, "insert failed", body.Message)
}
