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

func TestOutboundBuildTiming(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	_, ok := outboundBuildMilliseconds(c)
	assert.False(t, ok)

	stop := TimeOutboundBuild(c)
	time.Sleep(3 * time.Millisecond)
	stop()
	first, ok := outboundBuildMilliseconds(c)
	require.True(t, ok)
	assert.GreaterOrEqual(t, first, 3.0)

	// A retry's build keeps the first attempt's time.
	retry := TimeOutboundBuild(c)
	time.Sleep(2 * time.Millisecond)
	retry()
	again, _ := outboundBuildMilliseconds(c)
	assert.Equal(t, first, again)

	// Nil context, admin-only placement, and kept out of the pre-channel total.
	TimeOutboundBuild(nil)()
	other := model.NewLogOther()
	AppendRelayLogAdminInfo(c, nil, other)
	snapshot := other.Snapshot()
	adminInfo, ok := snapshot["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, first, adminInfo["outbound_build_ms"])
	assert.NotContains(t, adminInfo, "pre_channel_ms")
	assert.NotContains(t, snapshot, "outbound_build_ms")
}
