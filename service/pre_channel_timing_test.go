package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreChannelTiming(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	assert.Nil(t, preChannelMilliseconds(c))

	stop := TimePreChannel(c, PreChannelParse)
	time.Sleep(3 * time.Millisecond)
	stop()
	TimePreChannel(c, PreChannelRiskGate)()
	first := preChannelMilliseconds(c)
	require.Contains(t, first, PreChannelParse)
	assert.GreaterOrEqual(t, first[PreChannelParse], 3.0)
	assert.Contains(t, first, PreChannelRiskGate)
	assert.InDelta(t, first[PreChannelParse]+first[PreChannelRiskGate], first["total"], 0.11)

	// A second run of a stage, as a retry's channel selection is, keeps the first.
	TimePreChannel(c, PreChannelSelect)()
	selected := preChannelMilliseconds(c)[PreChannelSelect]
	time.Sleep(2 * time.Millisecond)
	retry := TimePreChannel(c, PreChannelSelect)
	time.Sleep(2 * time.Millisecond)
	retry()
	assert.Equal(t, selected, preChannelMilliseconds(c)[PreChannelSelect])

	// Nil context and admin-only placement.
	TimePreChannel(nil, PreChannelParse)()
	other := model.NewLogOther()
	AppendRelayLogAdminInfo(c, nil, other)
	snapshot := other.Snapshot()
	adminInfo, ok := snapshot["admin_info"].(map[string]any)
	require.True(t, ok)
	timing, ok := adminInfo["pre_channel_ms"].(map[string]float64)
	require.True(t, ok)
	assert.Contains(t, timing, "total")
	assert.NotContains(t, snapshot, "pre_channel_ms")
}
