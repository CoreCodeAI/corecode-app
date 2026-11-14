package service

import (
	"math"
	"time"

	"github.com/gin-gonic/gin"
)

const outboundBuildTimingKey = "outbound_build_ms"

// DefaultCacheTTLLogKey names the admin log field recording the relay's
// default prompt cache ttl on a Claude request: the ttl it gave the
// breakpoints, or "rejected" when the upstream refused them and the client's
// body was resent.
const DefaultCacheTTLLogKey = "default_cache_ttl"

// TimeOutboundBuild starts timing the outbound body build of a relay attempt:
// the request copy, model mapping, conversion, marshal and body staging that
// run after a channel is chosen and before the upstream call. It returns the
// function that stops it. Only the first attempt is kept, as with the
// pre-channel stages; the log's other.admin_info.outbound_build_ms holds it in
// milliseconds, to 0.1 ms. It is not part of pre_channel_ms.total.
func TimeOutboundBuild(c *gin.Context) func() {
	if c == nil {
		return func() {}
	}
	started := time.Now()
	return func() {
		if _, done := c.Get(outboundBuildTimingKey); done {
			return
		}
		c.Set(outboundBuildTimingKey, math.Round(float64(time.Since(started).Microseconds())/100)/10)
	}
}

// outboundBuildMilliseconds returns the first attempt's build time, or false
// when no attempt reached the upstream call.
func outboundBuildMilliseconds(c *gin.Context) (float64, bool) {
	if c == nil {
		return 0, false
	}
	value, ok := c.Get(outboundBuildTimingKey)
	if !ok {
		return 0, false
	}
	milliseconds, ok := value.(float64)
	return milliseconds, ok
}
