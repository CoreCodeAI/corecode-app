package service

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

// CoreCode addition: the daily Feishu digest of the root dashboard. Once a
// day, from the configured Beijing hour, it reads the previous calendar day
// and the day before it with the dashboard's own readers and posts the
// headline figures and the signals the page would color as needing attention.
//
// The rules are a Go mirror of a subset of the console's. Each threshold
// below names the TypeScript constant it copies (web/src/features/site-insights),
// so a change on one side is found by reading the other. The digest runs on
// the master node as a system task (every ten minutes, one run at a time
// across both release colors); the day it sent lives in the database
// (model.ClaimSiteInsightsDigestDay), so a second server or a restart cannot
// send it again.

// Thresholds mirrored from the console.
const (
	digestSmallSample         = 100  // SMALL_SAMPLE, lib.ts: requests needed to judge a rate
	digestMinTasks            = 20   // MIN_TASKS, lib.ts: finished tasks needed to judge a task rate
	digestMinOrders           = 5    // MIN_ORDERS, lib.ts: checkouts needed in each period
	digestSignupSpikeFloor    = 5    // SIGNUP_SPIKE_FLOOR, lib.ts
	digestSpikeFactor         = 3    // SPIKE_FACTOR, lib.ts
	digestDebtAlertUSD        = -1.0 // DEBT_ALERT_USD, lib.ts: a balance below this is debt
	digestCostStaleSeconds    = 1800 // COST_STALE_SECONDS, lib.ts
	digestHeadroomShare       = 0.8  // HEADROOM_SHARE, lib.ts: pool peak near its slots
	digestFailingRate         = 0.05 // FAILING_RATE, components/overview-analysis.ts
	digestWarningRate         = 0.02 // failureTone's warning bound, lib.ts
	digestCompletionDropShare = 0.5  // COMPLETION_DROP_SHARE, components/overview-signals.ts
	digestRemainingWarning    = 0.25 // REMAINING_WARNING, components/overview-tab.tsx
	digestRemainingDanger     = 0.1  // REMAINING_DANGER, components/overview-tab.tsx
	digestEligibleLow         = 2    // ELIGIBLE_ACCOUNTS_LOW, components/overview-tab.tsx
	digestMaxFindings         = 8
	digestPoolReadStale       = 2 * time.Minute
)

// digestAttentionStatuses mirrors ATTENTION in lib.ts: pool account statuses
// that need a person.
var digestAttentionStatuses = []string{"reauthorization_required", "suspended", "blacklisted", "quota_observation_unavailable"}

// digestBeijing is Asia/Shanghai as a fixed zone, which needs no tz database.
var digestBeijing = time.FixedZone("Asia/Shanghai", 8*3600)

const digestDayLayout = "2006-01-02"

// digestDayFigures is what the readers return for one Beijing day.
type digestDayFigures struct {
	Finance         *model.FinanceInsights
	Quality         *model.QualityInsights
	Capacity        *model.CapacityInsights
	Upstream        *model.UpstreamInsights
	Growth          *model.GrowthInsights
	Activity        *model.ActivityInsights
	LimitRejections int64
}

// digestInput is everything one message reads. Pool is the engine's pool as
// last read; it is zero when the engine is not configured.
type digestInput struct {
	Day      time.Time // the reported day's start, Beijing
	Now      time.Time
	Current  digestDayFigures
	Previous digestDayFigures
	Pool     EnginePool
	Link     string
}

// digestFinding is one line of the attention list. Severity 0 is danger, 1
// warning, 2 a note; lines are listed by severity, then as produced.
type digestFinding struct {
	Severity int
	Text     string
}

// SiteInsightsDigestResult is one run's task result.
type SiteInsightsDigestResult struct {
	ReportDay string `json:"report_day,omitempty"`
	Sent      bool   `json:"sent"`
	Skipped   string `json:"skipped,omitempty"`
}

// sendSiteInsightsDigest posts the text. Tests replace it.
var sendSiteInsightsDigest = SendFeishuBotText

// readSiteInsightsDigestDay reads one Beijing day with the dashboard's
// readers. Tests replace it.
var readSiteInsightsDigestDay = readDigestDay

// siteInsightsDigestDue reports the report day a run at now sends, and
// whether the send hour has come. The digest for a day is sent on the day
// after it, from the configured hour until midnight; a digest not sent by
// then is skipped, and the next day's covers the next report day.
func siteInsightsDigestDue(now time.Time, hour int) (time.Time, bool) {
	local := now.In(digestBeijing)
	if local.Hour() < hour {
		return time.Time{}, false
	}
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, digestBeijing)
	return today.AddDate(0, 0, -1), true
}

// RunSiteInsightsDigest runs the digest once at now. The day is claimed
// before anything is read, so a run after the send costs one read of the
// option row. A reader or send error releases the claim, so the next run (ten
// minutes later) tries again until midnight; a partial digest is never sent.
func RunSiteInsightsDigest(ctx context.Context, now time.Time) (SiteInsightsDigestResult, error) {
	setting := operation_setting.GetSiteInsightsDigestSetting()
	if !setting.Ready() {
		return SiteInsightsDigestResult{Skipped: "disabled"}, nil
	}
	reportDay, due := siteInsightsDigestDue(now, setting.Hour)
	if !due {
		return SiteInsightsDigestResult{Skipped: "before the send hour"}, nil
	}
	result := SiteInsightsDigestResult{ReportDay: reportDay.Format(digestDayLayout)}
	previous, claimed, err := model.ClaimSiteInsightsDigestDay(result.ReportDay)
	if err != nil {
		return result, err
	}
	if !claimed {
		result.Skipped = "already sent"
		return result, nil
	}
	release := func(err error) (SiteInsightsDigestResult, error) {
		if releaseErr := model.ReleaseSiteInsightsDigestDay(previous, result.ReportDay); releaseErr != nil {
			err = errors.Join(err, releaseErr)
		}
		return result, err
	}
	input, err := collectSiteInsightsDigest(now, reportDay)
	if err != nil {
		return release(err)
	}
	if err := sendSiteInsightsDigest(setting.FeishuWebhook, setting.FeishuSecret, siteInsightsDigestText(input)); err != nil {
		logger.LogWarn(ctx, common.LogText("site insights digest: send failed, will retry: %v", err))
		return release(err)
	}
	result.Sent = true
	return result, nil
}

// SendSiteInsightsDigestNow sends yesterday's digest to the saved bot at
// once, for the settings page's test button. It claims nothing, so the
// scheduled digest still goes out later.
func SendSiteInsightsDigestNow(now time.Time) error {
	setting := operation_setting.GetSiteInsightsDigestSetting()
	if strings.TrimSpace(setting.FeishuWebhook) == "" {
		return errors.New("save a Feishu webhook first")
	}
	local := now.In(digestBeijing)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, digestBeijing)
	input, err := collectSiteInsightsDigest(now, today.AddDate(0, 0, -1))
	if err != nil {
		return err
	}
	return sendSiteInsightsDigest(setting.FeishuWebhook, setting.FeishuSecret, siteInsightsDigestText(input))
}

// collectSiteInsightsDigest reads the reported day and the day before it.
func collectSiteInsightsDigest(now time.Time, reportDay time.Time) (digestInput, error) {
	input := digestInput{Day: reportDay, Now: now, Link: siteInsightsDigestLink()}
	var err error
	if input.Current, err = readSiteInsightsDigestDay(reportDay, reportDay.AddDate(0, 0, 1)); err != nil {
		return input, err
	}
	if input.Previous, err = readSiteInsightsDigestDay(reportDay.AddDate(0, 0, -1), reportDay); err != nil {
		return input, err
	}
	input.Pool = RecentEnginePool(digestPoolReadStale)
	return input, nil
}

func siteInsightsDigestLink() string {
	address := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	if address == "" {
		return ""
	}
	return address + "/site-insights"
}

// readDigestDay runs the dashboard's readers over [start, end) in Beijing time.
func readDigestDay(start time.Time, end time.Time) (digestDayFigures, error) {
	r := model.InsightsRange{Start: start.Unix(), End: end.Unix(), Offset: 8 * 3600}
	var figures digestDayFigures
	var err error
	if figures.Finance, err = model.GetFinanceInsights(r); err != nil {
		return figures, err
	}
	if figures.Quality, err = model.GetQualityInsights(r, nil); err != nil {
		return figures, err
	}
	if figures.Capacity, err = model.GetCapacityInsights(r, ""); err != nil {
		return figures, err
	}
	if figures.Upstream, err = model.GetUpstreamInsights(r); err != nil {
		return figures, err
	}
	if figures.Growth, err = model.GetGrowthInsights(r); err != nil {
		return figures, err
	}
	if figures.Activity, err = model.GetActivityInsights(r); err != nil {
		return figures, err
	}
	points, _, err := model.ReadUserConcurrencyRejections(r.Start, r.End)
	if err != nil {
		return figures, err
	}
	for _, point := range points {
		figures.LimitRejections += point.Count
	}
	return figures, nil
}

// buildSiteInsightsDigest turns one day's figures into the message.
func siteInsightsDigestText(in digestInput) string {
	var text strings.Builder
	day := in.Day.Format(digestDayLayout)
	fmt.Fprintf(&text, "【站点日报】%s（北京时间），与前一日对比\n", day)
	cur, prev := in.Current, in.Previous
	fmt.Fprintf(&text, "付费收入 %s%s，订单 %d%s，付费用户 %d%s\n",
		digestYuan(cur.Finance.Revenue), digestVersusMoney(cur.Finance.Revenue, prev.Finance.Revenue),
		cur.Finance.Orders, digestVersusCount(cur.Finance.Orders, prev.Finance.Orders),
		cur.Finance.PayingUsers, digestVersusCount(cur.Finance.PayingUsers, prev.Finance.PayingUsers))
	fmt.Fprintf(&text, "请求 %s%s，服务失败率 %s\n",
		digestCount(cur.Quality.Requests), digestVersusCount(cur.Quality.Requests, prev.Quality.Requests),
		digestRateVersus(digestServiceRate(cur.Quality), digestServiceRate(prev.Quality)))
	fmt.Fprintf(&text, "新注册 %d%s，活跃用户 %d%s\n",
		cur.Growth.Funnel.Registered, digestVersusCount(cur.Growth.Funnel.Registered, prev.Growth.Funnel.Registered),
		cur.Activity.ActiveUsers, digestVersusCount(cur.Activity.ActiveUsers, prev.Activity.ActiveUsers))

	findings := siteInsightsDigestFindings(in)
	if len(findings) == 0 {
		text.WriteString("无需关注的事项\n")
	} else {
		text.WriteString("需要关注：\n")
		for i, finding := range findings {
			if i == digestMaxFindings {
				fmt.Fprintf(&text, "另有 %d 项，见控制台\n", len(findings)-digestMaxFindings)
				break
			}
			fmt.Fprintf(&text, "%d. %s\n", i+1, finding.Text)
		}
	}
	if in.Link != "" {
		text.WriteString("详情：" + in.Link)
	}
	return strings.TrimRight(text.String(), "\n")
}

// siteInsightsDigestFindings applies the rules. Each rule reads the figures
// the console reads for the same day; the comment on it names the console's
// rule.
func siteInsightsDigestFindings(in digestInput) []digestFinding {
	var found []digestFinding
	add := func(severity int, format string, args ...any) {
		found = append(found, digestFinding{Severity: severity, Text: fmt.Sprintf(format, args...)})
	}
	cur, prev := in.Current, in.Previous
	capacity := cur.Capacity
	pool := in.Pool
	poolReadable := pool.Configured && pool.Error == ""

	// overview-signals.ts poolPeakAgainstSlots and peakTone.
	if poolReadable && pool.EffectiveSlots > 0 && capacity.PoolPeak != nil {
		peak := *capacity.PoolPeak
		share := float64(peak) / float64(pool.EffectiveSlots)
		switch {
		case share >= 1:
			add(0, "号池峰值 %d 达到全部 %d 个槽位", peak, pool.EffectiveSlots)
		case share >= digestHeadroomShare:
			add(1, "号池峰值 %d，占 %d 个槽位的 %s", peak, pool.EffectiveSlots, digestPercent(share, 0))
		}
	}
	// overview-signals.ts: the pool was full (engine_concurrency) and the
	// engine's budget refusals (engine_budget).
	if full := digestCategory(capacity.ErrorCategories, model.ErrorEngineConcurrency); full > 0 {
		add(0, "号池满载，拒绝 %d 次请求", full)
	}
	if budget := digestCategory(capacity.ErrorCategories, model.ErrorEngineBudget); budget > 0 {
		add(1, "%d 次请求找不到还有速率或额度的号池账户", budget)
	}
	// overview-signals.ts: upstream_auth.
	if auth := digestCategory(capacity.ErrorCategories, model.ErrorUpstreamAuth); auth > 0 {
		add(1, "上游拒绝了我们的 key %d 次（401/402/403），检查渠道的 key、余额或套餐", auth)
	}
	// overview-signals.ts: quality-no-channel.
	if cur.Quality.Refusals != nil && cur.Quality.Refusals.NoChannel > 0 {
		add(1, "%d 个请求找不到可用渠道", cur.Quality.Refusals.NoChannel)
	}
	// overview-signals.ts: quality-rate. Judged only over digestSmallSample
	// requests; warning above digestWarningRate, danger above digestFailingRate.
	if cur.Quality.Requests >= digestSmallSample {
		rate := digestServiceRate(cur.Quality)
		if rate > digestFailingRate {
			add(0, "服务失败率 %s（%d 次请求失败）", digestPercent(rate, 2), digestServiceFailures(cur.Quality))
		} else if rate > digestWarningRate {
			add(1, "服务失败率 %s（%d 次请求失败）", digestPercent(rate, 2), digestServiceFailures(cur.Quality))
		}
	}
	// overview-signals.ts failingTasks: the total over digestSmallSample
	// finished tasks, judged by FAILING_RATE.
	if tasks := cur.Quality.Tasks; tasks != nil {
		finished := tasks.Total.Succeeded + tasks.Total.Failed
		if finished >= digestSmallSample && tasks.Total.FailureRate > digestFailingRate {
			add(1, "图片和视频任务失败率 %s（%d/%d 失败）", digestPercent(tasks.Total.FailureRate, 1), tasks.Total.Failed, finished)
		}
	}
	// overview-signals.ts completionDrop: checkout completion under half the
	// day before, both days with digestMinOrders checkouts opened.
	if drop, ok := digestCompletionDrop(cur.Finance, prev.Finance); ok {
		add(1, "收银台完成率 %s，前日 %s（%s）", digestPercent(drop.rate, 1), digestPercent(drop.previous, 1), drop.lowest)
	}
	// overview-analysis.ts failingChannels: attempts (requests + errors) over
	// digestSmallSample and a failure rate above FAILING_RATE.
	if failing := digestFailingChannels(cur.Upstream); len(failing) > 0 {
		names := make([]string, 0, 3)
		for _, row := range failing[:min(3, len(failing))] {
			names = append(names, fmt.Sprintf("%s %s", row.Name, digestPercent(row.FailureRate, 1)))
		}
		add(1, "%d 个上游渠道失败率超过 5%%：%s", len(failing), strings.Join(names, "，"))
	}
	// overview-analysis.ts staleCostChannels: channels that earned in the day
	// but whose upstream bill was last read more than digestCostStaleSeconds
	// before now.
	if stale := digestStaleCostChannels(cur.Upstream, in.Now.Unix()); len(stale) > 0 {
		add(2, "%d 个渠道的上游账单超过 30 分钟未读取：%s", len(stale), strings.Join(stale, "，"))
	}
	// overview-tab.tsx: finance-debt. The balance is current, not the day's.
	if cur.Finance.DebtUSD < digestDebtAlertUSD {
		add(0, "%d 位客户共欠费 ¥%s", len(cur.Finance.Debtors), digestMoney(-cur.Finance.DebtUSD))
	}
	// overview-tab.tsx: capacity-limit.
	if cur.LimitRejections > 0 {
		add(1, "单用户并发限制拒绝 %d 次（含重试）", cur.LimitRejections)
	}
	// overview-tab.tsx: pool-five and pool-seven, against the pool's budget.
	if poolReadable {
		for _, horizon := range []struct {
			label string
			value *EngineHorizon
		}{{"5 小时", pool.FiveHour}, {"7 天", pool.Week}} {
			if horizon.value == nil {
				continue
			}
			left := 1.0
			if horizon.value.CapacityUSD > 0 {
				left = horizon.value.RemainingUSD / horizon.value.CapacityUSD
			}
			switch {
			case left < digestRemainingDanger:
				add(0, "%s额度仅剩 %s 的号池预算", horizon.label, digestPercent(left, 0))
			case left < digestRemainingWarning:
				add(1, "%s额度仅剩 %s 的号池预算", horizon.label, digestPercent(left, 0))
			}
		}
		// overview-tab.tsx: pool-eligible, pool-attention.
		if pool.EligibleAccounts <= digestEligibleLow {
			add(0, "只有 %d 个号池账户可调度", pool.EligibleAccounts)
		}
		var attention []string
		for _, account := range pool.Accounts {
			if slices.Contains(digestAttentionStatuses, account.Status) {
				attention = append(attention, fmt.Sprintf("#%d %s", account.CredentialID, account.Status))
			}
		}
		if len(attention) > 0 {
			add(0, "%d 个号池账户需要处理：%s", len(attention), strings.Join(attention, "，"))
		}
	}
	// risk-analysis.ts signupSurges, by day: the day before stands in for the
	// previous period's median day.
	if digestSignupSpike(cur.Growth.Funnel.Registered, prev.Growth.Funnel.Registered) {
		add(1, "新注册 %d，前日 %d，异常增长", cur.Growth.Funnel.Registered, prev.Growth.Funnel.Registered)
	}

	// Severity first; the sort is stable, so each rule keeps its place.
	slices.SortStableFunc(found, func(a, b digestFinding) int { return a.Severity - b.Severity })
	return found
}

// digestServiceFailures and digestServiceRate mirror serviceFailureRate
// (quality-analysis.ts): requests no channel could take and customers' own 4xx
// are left out of both counts. The raw rate is the fallback when no request is
// left.
func digestServiceFailures(q *model.QualityInsights) int64 {
	return max(0, q.Errors-digestExcluded(q))
}

func digestServiceRate(q *model.QualityInsights) float64 {
	if q == nil {
		return 0
	}
	requests := q.Requests - digestExcluded(q)
	if requests <= 0 {
		return q.ErrorRate
	}
	return float64(digestServiceFailures(q)) / float64(requests)
}

// digestExcluded is the requests the service could not have served: refused
// for want of a channel, or the customers' own errors (ErrorClient).
func digestExcluded(q *model.QualityInsights) int64 {
	return digestCategory(q.ErrorCategories, model.ErrorClient) + digestCategory(q.ErrorCategories, model.ErrorNoChannel)
}

func digestCategory(categories []model.NamedCount, name string) int64 {
	for _, item := range categories {
		if item.Name == name {
			return item.Count
		}
	}
	return 0
}

type digestCheckoutDrop struct {
	rate, previous float64
	lowest         string
}

// digestCompletionDrop mirrors checkoutCompletion and completionDrop
// (overview-signals.ts). A checkout still pending and opened within the hour
// is left out of the rate.
func digestCompletionDrop(current, previous *model.FinanceInsights) (digestCheckoutDrop, bool) {
	now, nowRate, nowOK := digestCheckoutRate(current.OrderMethods)
	before, beforeRate, beforeOK := digestCheckoutRate(previous.OrderMethods)
	if now < digestMinOrders || before < digestMinOrders || !nowOK || !beforeOK || nowRate >= beforeRate*digestCompletionDropShare {
		return digestCheckoutDrop{}, false
	}
	drop := digestCheckoutDrop{rate: nowRate, previous: beforeRate}
	lowest := -1
	for i, row := range current.OrderMethods {
		if row.Created < digestMinOrders {
			continue
		}
		if lowest < 0 || row.CompletionRate < current.OrderMethods[lowest].CompletionRate {
			lowest = i
		}
	}
	if lowest >= 0 {
		drop.lowest = fmt.Sprintf("最低：%s %s", current.OrderMethods[lowest].PaymentMethod, digestPercent(current.OrderMethods[lowest].CompletionRate, 1))
	}
	return drop, true
}

// digestCheckoutRate returns the checkouts opened, and the completion rate
// over the settled ones; ok is false when none is settled.
func digestCheckoutRate(methods []model.OrderMethodFunnel) (created int64, rate float64, ok bool) {
	var paid, open int64
	for _, row := range methods {
		created += row.Created
		paid += row.Paid
		open += max(row.Pending-row.PendingStale, 0)
	}
	settled := created - open
	if settled <= 0 {
		return created, 0, false
	}
	return created, float64(paid) / float64(settled), true
}

// digestFailingChannels mirrors failingChannels (overview-analysis.ts).
func digestFailingChannels(upstream *model.UpstreamInsights) []model.UpstreamChannel {
	if upstream == nil {
		return nil
	}
	var failing []model.UpstreamChannel
	for _, row := range upstream.Channels {
		attempts := row.Requests + row.Errors
		if attempts >= digestSmallSample && row.FailureRate > digestFailingRate {
			failing = append(failing, row)
		}
	}
	slices.SortStableFunc(failing, func(a, b model.UpstreamChannel) int { return cmp.Compare(b.Errors, a.Errors) })
	return failing
}

// digestStaleCostChannels mirrors staleCostChannels (overview-analysis.ts),
// with now as the reference time.
func digestStaleCostChannels(upstream *model.UpstreamInsights, now int64) []string {
	if upstream == nil {
		return nil
	}
	var names []string
	for _, row := range upstream.Channels {
		if row.CostSource == "upstream" && row.RevenueUSD > 0 && row.LatestCostAt > 0 && now-row.LatestCostAt > digestCostStaleSeconds {
			names = append(names, row.Name)
		}
	}
	return names
}

// digestSignupSpike mirrors the spike test in analysis.ts findSpikes: at
// least digestSignupSpikeFloor sign-ups, and digestSpikeFactor times the
// baseline (or the floor times the factor when the baseline is zero).
func digestSignupSpike(value, baseline int64) bool {
	if value < digestSignupSpikeFloor {
		return false
	}
	if baseline > 0 {
		return value >= digestSpikeFactor*baseline
	}
	return value >= digestSignupSpikeFloor*digestSpikeFactor
}

// Formatting.

func digestPercent(value float64, places int) string {
	return strconv.FormatFloat(value*100, 'f', places, 64) + "%"
}

func digestCount(n int64) string {
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	digits := strconv.FormatInt(n, 10)
	var out []byte
	for i := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, digits[i])
	}
	return sign + string(out)
}

func digestMoney(value float64) string {
	whole, fraction, _ := strings.Cut(strconv.FormatFloat(math.Abs(value), 'f', 2, 64), ".")
	n, _ := strconv.ParseInt(whole, 10, 64)
	sign := ""
	if value < 0 && (n != 0 || fraction != "00") {
		sign = "-"
	}
	return sign + digestCount(n) + "." + fraction
}

func digestYuan(value float64) string {
	return "¥" + digestMoney(value)
}

func digestVersusCount(current, previous int64) string {
	if previous == 0 {
		return "（前日 0）"
	}
	return fmt.Sprintf("（前日 %s，%+.1f%%）", digestCount(previous), float64(current-previous)/float64(previous)*100)
}

func digestVersusMoney(current, previous float64) string {
	if previous == 0 {
		return "（前日 ¥0.00）"
	}
	return fmt.Sprintf("（前日 %s，%+.1f%%）", digestYuan(previous), (current-previous)/previous*100)
}

func digestRateVersus(current, previous float64) string {
	return fmt.Sprintf("%s（前日 %s，%+.2f 个百分点）", digestPercent(current, 2), digestPercent(previous, 2), (current-previous)*100)
}
