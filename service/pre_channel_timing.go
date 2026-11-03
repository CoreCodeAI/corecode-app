package service

import (
	"math"
	"time"

	"github.com/gin-gonic/gin"
)

const preChannelTimingKey = "pre_channel_timing"

// Pre-channel stages, in the order Relay runs them. The log's
// other.admin_info.pre_channel_ms holds each one's first run in milliseconds,
// plus their sum as total.
const (
	// PreChannelParse is the body decode into the request and the relay info.
	PreChannelParse = "parse"
	// PreChannelRiskGate is the risk gate, or the violation guard with it off.
	PreChannelRiskGate = "risk_gate"
	// PreChannelBillingEstimate is the request-token estimate.
	PreChannelBillingEstimate = "billing_estimate"
	// PreChannelBillingReserve is the pricing lookup and the quota reservation.
	PreChannelBillingReserve = "billing_reserve"
	// PreChannelSelect is the first channel selection.
	PreChannelSelect = "select"
)

type preChannelTiming struct {
	stages map[string]float64
	total  float64
}

// TimePreChannel starts timing a stage and returns the function that stops it.
// Only a stage's first run is kept, so a retry's second channel selection does
// not replace the one that delayed the first byte. It costs one clock read
// per call and allocates once per request.
func TimePreChannel(c *gin.Context, stage string) func() {
	if c == nil {
		return func() {}
	}
	started := time.Now()
	return func() {
		timing, _ := c.Get(preChannelTimingKey)
		recorded, ok := timing.(*preChannelTiming)
		if !ok {
			recorded = &preChannelTiming{stages: make(map[string]float64, 6)}
			c.Set(preChannelTimingKey, recorded)
		}
		if _, done := recorded.stages[stage]; done {
			return
		}
		milliseconds := math.Round(float64(time.Since(started).Microseconds())/100) / 10
		recorded.stages[stage] = milliseconds
		recorded.total = math.Round((recorded.total+milliseconds)*10) / 10
	}
}

// preChannelMilliseconds returns the recorded stages and their total, or nil
// when the request never reached the first one.
func preChannelMilliseconds(c *gin.Context) map[string]float64 {
	if c == nil {
		return nil
	}
	timing, _ := c.Get(preChannelTimingKey)
	recorded, ok := timing.(*preChannelTiming)
	if !ok || len(recorded.stages) == 0 {
		return nil
	}
	out := make(map[string]float64, len(recorded.stages)+1)
	for stage, milliseconds := range recorded.stages {
		out[stage] = milliseconds
	}
	out["total"] = recorded.total
	return out
}
