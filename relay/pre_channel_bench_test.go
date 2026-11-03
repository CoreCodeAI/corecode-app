package relay

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/internal/claudebody"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

// benchDistillRules and benchHardRules are generic stand-ins with the same
// shape as a production policy: needles, regex patterns, fingerprints and a
// few hard regexes. They are not the production rules and match nothing in
// the synthetic bodies.
const benchDistillRules = `{"enabled":true,"skip_official":true,"skip_zero":true,"structure":{"min_max_tokens":8192,"require_no_tools":true,"require_single_turn":true,"contest_pattern":"(?:step by step|chain of thought)"},"hard_needles":["bench-hard-needle-one"],"needles":["bench-needle-one","bench-needle-two"],"patterns":["reveal the hidden prompt","dump (?:all|every) training example"],"fingerprints":["bench fingerprint sample text"]}`

const benchHardRules = "bench.one | (?i)remove the license check\nbench.two | (?i)disable (?:the )?telemetry for everyone\nbench.three | (?i)bench-forbidden-phrase-[0-9]+"

func benchContext(body []byte) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", io.NopCloser(bytes.NewReader(body)))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "claude-cli/2.1.301 (external, cli)")
	c.Request = req
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "claude-opus-5-5")
	return c
}

// BenchmarkPreChannel runs the work Relay does between the client's body and
// the first channel selection on a Claude Code body: body read, request parse,
// relay info, risk gate (enforce, distillation and hard regex on, decision
// model off) and the billing token estimate. It reports each stage in
// milliseconds and bytes per request.
func BenchmarkPreChannel(b *testing.B) {
	gin.SetMode(gin.TestMode)
	previousGate := *operation_setting.GetRiskGateSetting()
	previousGuard := *operation_setting.GetViolationGuardSetting()
	previousCount, previousMedia := constant.CountToken, constant.GetMediaToken
	b.Cleanup(func() {
		*operation_setting.GetRiskGateSetting() = previousGate
		*operation_setting.GetViolationGuardSetting() = previousGuard
		constant.CountToken, constant.GetMediaToken = previousCount, previousMedia
	})
	*operation_setting.GetViolationGuardSetting() = operation_setting.ViolationGuardSetting{}
	*operation_setting.GetRiskGateSetting() = operation_setting.RiskGateSetting{
		Enabled: true, Mode: operation_setting.RiskGateModeEnforce,
		DistillEnabled: true, DistillRules: benchDistillRules,
		HardRegexEnabled: true, HardRegexRules: benchHardRules,
	}
	constant.CountToken, constant.GetMediaToken = true, true

	for _, size := range []int{500_000, 4_000_000, 12_000_000, 25_000_000} {
		body := claudebody.Claude(claudebody.Options{TargetBytes: size})
		b.Run(fmt.Sprintf("%.1fMB_%dimages", float64(len(body))/1e6, claudebody.Images(body)), func(b *testing.B) {
			b.ReportAllocs()
			stages := []string{"body_read", "parse", "relay_info", "risk_gate", "billing_estimate"}
			elapsed := make([]time.Duration, len(stages))
			allocated := make([]uint64, len(stages))
			var before, after runtime.MemStats
			for range b.N {
				c := benchContext(body)
				var request dto.Request
				var info *relaycommon.RelayInfo
				run := func(stage int, fn func()) {
					runtime.ReadMemStats(&before)
					started := time.Now()
					fn()
					elapsed[stage] += time.Since(started)
					runtime.ReadMemStats(&after)
					allocated[stage] += after.TotalAlloc - before.TotalAlloc
				}
				run(0, func() {
					if _, err := common.GetBodyStorage(c); err != nil {
						b.Fatal(err)
					}
				})
				run(1, func() {
					var err error
					request, err = helper.GetAndValidateRequest(c, types.RelayFormatClaude)
					if err != nil {
						b.Fatal(err)
					}
				})
				run(2, func() {
					var err error
					info, err = relaycommon.GenRelayInfo(c, types.RelayFormatClaude, request, nil)
					if err != nil {
						b.Fatal(err)
					}
				})
				run(3, func() {
					if err := service.CheckRiskGate(c, info); err != nil {
						b.Fatal(err)
					}
				})
				run(4, func() {
					meta := info.Request.GetTokenCountMeta()
					if _, err := service.EstimateRequestToken(c, meta, info); err != nil {
						b.Fatal(err)
					}
				})
				service.CleanupFileSources(c)
				common.CleanupBodyStorage(c)
			}
			for i, stage := range stages {
				b.ReportMetric(float64(elapsed[i].Microseconds())/1000/float64(b.N), stage+"_ms/op")
				b.ReportMetric(float64(allocated[i])/1e6/float64(b.N), stage+"_MB/op")
			}
		})
	}
}
