package service

import (
	"context"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	siteInsightsRollupTickInterval = 10 * time.Minute
	// siteInsightsRollupBatch bounds one tick's work; a new install fills
	// the last 92 days of hours over a few ticks.
	siteInsightsRollupBatch = 200
	// siteInsightsBehaviorBatch bounds the behavior hours one tick stores.
	siteInsightsBehaviorBatch = 24
)

var siteInsightsRollupOnce sync.Once

// StartSiteInsightsRollupTask stores finished hours of the request logs for
// the root dashboard every ten minutes on the master node. During a release
// both colors run it; storing an hour replaces it whole, so a second runner
// writes the same figures.
func StartSiteInsightsRollupTask() {
	siteInsightsRollupOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(siteInsightsRollupTickInterval)
			defer ticker.Stop()
			for {
				filled, err := model.FillInsightHours(model.InsightsMaxLogDays, siteInsightsRollupBatch)
				if err != nil {
					logger.LogWarn(context.Background(), common.LogText("site insights rollup failed after %d hours: %v", filled, err))
				}
				// The behavior hours fill a few per tick so the backfill of the last
				// weeks does not read the log table in one go.
				if _, err := model.FillInsightBehavior(siteInsightsBehaviorBatch); err != nil {
					logger.LogWarn(context.Background(), common.LogText("site insights behavior rollup failed: %v", err))
				}
				<-ticker.C
			}
		})
	})
}
