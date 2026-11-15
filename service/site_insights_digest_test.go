package service

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// digestQuietDay is a day on which no rule fires: a healthy day of traffic.
func digestQuietDay() digestDayFigures {
	return digestDayFigures{
		Finance:  &model.FinanceInsights{Revenue: 1000, Orders: 10, PayingUsers: 8},
		Quality:  &model.QualityInsights{Requests: 44000, Errors: 136},
		Capacity: &model.CapacityInsights{},
		Upstream: &model.UpstreamInsights{},
		Growth:   &model.GrowthInsights{Funnel: model.FunnelRow{Registered: 18}},
		Activity: &model.ActivityInsights{ActiveUsers: 140},
	}
}

// digestFixture is the day the golden text was written for: a failure rate
// of 2.19%, which is a warning, and the day before it quiet.
func digestFixture() digestInput {
	current := digestQuietDay()
	current.Finance = &model.FinanceInsights{Revenue: 1234.56, Orders: 12, PayingUsers: 9}
	current.Quality = &model.QualityInsights{Requests: 45678, Errors: 1000}
	current.Growth = &model.GrowthInsights{Funnel: model.FunnelRow{Registered: 23}}
	current.Activity = &model.ActivityInsights{ActiveUsers: 150}
	return digestInput{
		Day:      time.Date(2026, 11, 14, 0, 0, 0, 0, digestBeijing),
		Now:      time.Date(2026, 11, 15, 9, 0, 0, 0, digestBeijing),
		Current:  current,
		Previous: digestQuietDay(),
		Link:     "https://corecode.live/site-insights",
	}
}

func TestSiteInsightsDigestDueBoundaries(t *testing.T) {
	at := func(s string) time.Time {
		parsed, err := time.ParseInLocation("2006-01-02 15:04:05", s, digestBeijing)
		require.NoError(t, err)
		return parsed
	}
	cases := []struct {
		name   string
		now    string
		hour   int
		due    bool
		report string
	}{
		{"one second before the hour", "2026-11-15 08:59:59", 9, false, ""},
		{"on the hour", "2026-11-15 09:00:00", 9, true, "2026-11-14"},
		{"last second of the send day", "2026-11-15 23:59:59", 9, true, "2026-11-14"},
		{"after midnight waits for the hour", "2026-11-16 00:00:00", 9, false, ""},
		{"next day at the hour reports the day before", "2026-11-16 09:00:00", 9, true, "2026-11-15"},
		{"hour zero is due at midnight", "2026-11-15 00:00:00", 0, true, "2026-11-14"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			day, due := siteInsightsDigestDue(at(tc.now), tc.hour)
			assert.Equal(t, tc.due, due)
			if tc.due {
				assert.Equal(t, tc.report, day.Format(digestDayLayout))
			}
		})
	}
	// 01:00 UTC is 09:00 Beijing, whatever the server's own zone.
	day, due := siteInsightsDigestDue(time.Date(2026, 11, 15, 1, 0, 0, 0, time.UTC), 9)
	assert.True(t, due)
	assert.Equal(t, "2026-11-14", day.Format(digestDayLayout))
}

func TestSiteInsightsDigestGoldenText(t *testing.T) {
	want := strings.Join([]string{
		"【站点日报】2026-11-14（北京时间），与前一日对比",
		"付费收入 ¥1,234.56（前日 ¥1,000.00，+23.5%），订单 12（前日 10，+20.0%），付费用户 9（前日 8，+12.5%）",
		"请求 45,678（前日 44,000，+3.8%），服务失败率 2.19%（前日 0.31%，+1.88 个百分点）",
		"新注册 23（前日 18，+27.8%），活跃用户 150（前日 140，+7.1%）",
		"需要关注：",
		"1. 服务失败率 2.19%（1000 次请求失败）",
		"详情：https://corecode.live/site-insights",
	}, "\n")
	assert.Equal(t, want, siteInsightsDigestText(digestFixture()))
}

func TestSiteInsightsDigestNothingToReport(t *testing.T) {
	input := digestFixture()
	input.Current = digestQuietDay()
	text := siteInsightsDigestText(input)
	assert.Contains(t, text, "无需关注的事项\n")
	assert.NotContains(t, text, "需要关注")
	assert.True(t, strings.HasSuffix(text, "详情：https://corecode.live/site-insights"))
}

func TestSiteInsightsDigestNoLinkWithoutServerAddress(t *testing.T) {
	system_setting.ServerAddress = ""
	t.Cleanup(func() { system_setting.ServerAddress = "http://localhost:3000" })
	input := digestFixture()
	input.Current = digestQuietDay()
	input.Link = siteInsightsDigestLink()
	assert.Empty(t, input.Link)
	assert.NotContains(t, siteInsightsDigestText(input), "详情")
}

// digestRuleCase changes one figure of a quiet day and says what the rules
// should print: the lines of the attention list, none when empty.
type digestRuleCase struct {
	name   string
	change func(in *digestInput)
	want   []string
}

func runDigestRules(t *testing.T, cases []digestRuleCase) {
	t.Helper()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := digestFixture()
			input.Current = digestQuietDay()
			input.Previous = digestQuietDay()
			tc.change(&input)
			var got []string
			for _, finding := range siteInsightsDigestFindings(input) {
				got = append(got, finding.Text)
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestSiteInsightsDigestServiceFailureRule(t *testing.T) {
	failures := func(requests, errors int64) func(*digestInput) {
		return func(in *digestInput) { in.Current.Quality = &model.QualityInsights{Requests: requests, Errors: errors} }
	}
	runDigestRules(t, []digestRuleCase{
		{"under the sample: 99 requests never fire", failures(99, 90), nil},
		{"at the warning bound (2%) does not fire", failures(1000, 20), nil},
		{"just past 2% warns", failures(1000, 21), []string{"服务失败率 2.10%（21 次请求失败）"}},
		{"at 5% still a warning", failures(1000, 50), []string{"服务失败率 5.00%（50 次请求失败）"}},
		{"past 5% is listed first", failures(1000, 51), []string{"服务失败率 5.10%（51 次请求失败）"}},
		{"customers' 4xx are left out", func(in *digestInput) {
			in.Current.Quality = &model.QualityInsights{Requests: 1000, Errors: 300, ErrorCategories: []model.NamedCount{{Name: model.ErrorClient, Count: 290}}}
		}, nil},
	})
}

func TestSiteInsightsDigestSignalRules(t *testing.T) {
	runDigestRules(t, []digestRuleCase{
		{"no channel for a request", func(in *digestInput) {
			in.Current.Quality.Refusals = &model.QualityRefusals{NoChannel: 3}
		}, []string{"3 个请求找不到可用渠道"}},
		{"pool full is danger", func(in *digestInput) {
			in.Current.Capacity.ErrorCategories = []model.NamedCount{{Name: model.ErrorEngineConcurrency, Count: 2}}
		}, []string{"号池满载，拒绝 2 次请求"}},
		{"upstream key refused", func(in *digestInput) {
			in.Current.Capacity.ErrorCategories = []model.NamedCount{{Name: model.ErrorUpstreamAuth, Count: 1}}
		}, []string{"上游拒绝了我们的 key 1 次（401/402/403），检查渠道的 key、余额或套餐"}},
		{"per-user limit refusals", func(in *digestInput) { in.Current.LimitRejections = 1 },
			[]string{"单用户并发限制拒绝 1 次（含重试）"}},
		{"customer debt past one dollar", func(in *digestInput) {
			in.Current.Finance.DebtUSD = -1.01
			in.Current.Finance.Debtors = []model.BalanceUser{{}, {}}
		}, []string{"2 位客户共欠费 ¥1.01"}},
		{"debt of exactly one dollar does not fire", func(in *digestInput) { in.Current.Finance.DebtUSD = -1 }, nil},
		{"a signup spike against a quiet day", func(in *digestInput) {
			in.Current.Growth.Funnel.Registered = 15
			in.Previous.Growth.Funnel.Registered = 0
		}, []string{"新注册 15，前日 0，异常增长"}},
		{"four sign-ups are below the floor", func(in *digestInput) {
			in.Current.Growth.Funnel.Registered = 4
			in.Previous.Growth.Funnel.Registered = 0
		}, nil},
		{"14 against 5 is under three times", func(in *digestInput) {
			in.Current.Growth.Funnel.Registered = 14
			in.Previous.Growth.Funnel.Registered = 5
		}, nil},
		{"15 against 5 is three times", func(in *digestInput) {
			in.Current.Growth.Funnel.Registered = 15
			in.Previous.Growth.Funnel.Registered = 5
		}, []string{"新注册 15，前日 5，异常增长"}},
	})
}

func TestSiteInsightsDigestTaskAndUpstreamRules(t *testing.T) {
	task := func(succeeded, failed int64) func(*digestInput) {
		return func(in *digestInput) {
			in.Current.Quality.Tasks = &model.TaskOutcomes{Total: model.TaskOutcome{Succeeded: succeeded, Failed: failed, FailureRate: float64(failed) / float64(succeeded+failed)}}
		}
	}
	channel := func(requests, errors int64, rate float64, latest int64) model.UpstreamChannel {
		return model.UpstreamChannel{Name: "ch", Requests: requests, Errors: errors, FailureRate: rate, RevenueUSD: 5, CostSource: "upstream", LatestCostAt: latest}
	}
	now := time.Date(2026, 11, 15, 9, 0, 0, 0, digestBeijing).Unix()
	runDigestRules(t, []digestRuleCase{
		{"99 finished tasks never judge a failure rate", task(0, 99), nil},
		{"100 finished tasks at 6% fail", task(94, 6), []string{"图片和视频任务失败率 6.0%（6/100 失败）"}},
		{"exactly 5% of tasks does not fire", task(95, 5), nil},
		{"99 attempts never name a channel", func(in *digestInput) {
			in.Current.Upstream.Channels = []model.UpstreamChannel{channel(89, 10, 0.1, now-60)}
		}, nil},
		{"100 attempts past 5% name the channel", func(in *digestInput) {
			in.Current.Upstream.Channels = []model.UpstreamChannel{channel(90, 10, 0.1, now-60)}
		}, []string{"1 个上游渠道失败率超过 5%：ch 10.0%"}},
		{"upstream bill read 30 minutes ago is fresh", func(in *digestInput) {
			in.Current.Upstream.Channels = []model.UpstreamChannel{channel(10, 0, 0, now-1800)}
		}, nil},
		{"upstream bill older than 30 minutes is stale", func(in *digestInput) {
			in.Current.Upstream.Channels = []model.UpstreamChannel{channel(10, 0, 0, now-1801)}
		}, []string{"1 个渠道的上游账单超过 30 分钟未读取：ch"}},
	})
}

func TestSiteInsightsDigestCheckoutRule(t *testing.T) {
	methods := func(created, paid int64) []model.OrderMethodFunnel {
		return []model.OrderMethodFunnel{{PaymentMethod: "alipay", Created: created, Paid: paid, CompletionRate: float64(paid) / float64(created)}}
	}
	runDigestRules(t, []digestRuleCase{
		{"four checkouts a day are not judged", func(in *digestInput) {
			in.Current.Finance.OrderMethods = methods(4, 0)
			in.Previous.Finance.OrderMethods = methods(4, 4)
		}, nil},
		{"five checkouts each, half the rate exactly", func(in *digestInput) {
			in.Current.Finance.OrderMethods = methods(10, 2)
			in.Previous.Finance.OrderMethods = methods(10, 4)
		}, nil},
		{"under half the day before fires", func(in *digestInput) {
			in.Current.Finance.OrderMethods = methods(10, 1)
			in.Previous.Finance.OrderMethods = methods(10, 4)
		}, []string{"收银台完成率 10.0%，前日 40.0%（最低：alipay 10.0%）"}},
	})
}

func TestSiteInsightsDigestPoolRules(t *testing.T) {
	peak := func(value int) *int { return &value }
	pool := func(slots int, eligible int) EnginePool {
		return EnginePool{Configured: true, EffectiveSlots: slots, EligibleAccounts: eligible}
	}
	horizon := func(remaining float64) *EngineHorizon {
		return &EngineHorizon{RemainingUSD: remaining, CapacityUSD: 100}
	}
	runDigestRules(t, []digestRuleCase{
		{"peak at 79% of slots does not fire", func(in *digestInput) {
			in.Pool, in.Current.Capacity.PoolPeak = pool(100, 9), peak(79)
		}, nil},
		{"peak at 80% warns", func(in *digestInput) {
			in.Pool, in.Current.Capacity.PoolPeak = pool(100, 9), peak(80)
		}, []string{"号池峰值 80，占 100 个槽位的 80%"}},
		{"peak at the slots is danger", func(in *digestInput) {
			in.Pool, in.Current.Capacity.PoolPeak = pool(100, 9), peak(100)
		}, []string{"号池峰值 100 达到全部 100 个槽位"}},
		{"a pool that errored is not judged", func(in *digestInput) {
			in.Pool, in.Current.Capacity.PoolPeak = EnginePool{Configured: true, Error: "down", EffectiveSlots: 100}, peak(100)
		}, nil},
		{"25% of the 5-hour budget left does not fire", func(in *digestInput) {
			in.Pool = pool(100, 9)
			in.Pool.FiveHour = horizon(25)
		}, nil},
		{"24% left warns", func(in *digestInput) {
			in.Pool = pool(100, 9)
			in.Pool.FiveHour = horizon(24)
		}, []string{"5 小时额度仅剩 24% 的号池预算"}},
		{"9% left in the week is danger", func(in *digestInput) {
			in.Pool = pool(100, 9)
			in.Pool.Week = horizon(9)
		}, []string{"7 天额度仅剩 9% 的号池预算"}},
		{"two schedulable accounts are danger", func(in *digestInput) {
			in.Pool = pool(100, 2)
		}, []string{"只有 2 个号池账户可调度"}},
		{"an account needing attention is listed", func(in *digestInput) {
			in.Pool = pool(100, 9)
			in.Pool.Accounts = []EngineAccount{{CredentialID: 7, Status: "suspended"}, {CredentialID: 8, Status: "active"}}
		}, []string{"1 个号池账户需要处理：#7 suspended"}},
	})
}

func TestSiteInsightsDigestSortsDangerFirstAndCapsTheList(t *testing.T) {
	input := digestFixture()
	input.Current = digestQuietDay()
	input.Current.Growth.Funnel.Registered = 15 // warning: 15 against 5
	input.Previous.Growth.Funnel.Registered = 5
	input.Current.Finance.DebtUSD = -5 // danger
	input.Current.Finance.Debtors = []model.BalanceUser{{}, {}}
	input.Current.Quality.Refusals = &model.QualityRefusals{NoChannel: 1} // warning
	text := siteInsightsDigestText(input)
	assert.Contains(t, text, "需要关注：\n1. 2 位客户共欠费 ¥5.00\n2. 1 个请求找不到可用渠道\n3. 新注册 15，前日 5，异常增长")

	// Twelve rules fire: eight are listed, the other four are counted.
	many := digestQuietDay()
	many.Finance.DebtUSD, many.Finance.Debtors = -5, []model.BalanceUser{{}, {}}
	many.Growth.Funnel.Registered = 15
	many.LimitRejections = 1
	many.Quality.Refusals = &model.QualityRefusals{NoChannel: 1}
	many.Capacity.PoolPeak = new(int)
	*many.Capacity.PoolPeak = 100
	many.Capacity.ErrorCategories = []model.NamedCount{{Name: model.ErrorEngineConcurrency, Count: 2}, {Name: model.ErrorEngineBudget, Count: 3}, {Name: model.ErrorUpstreamAuth, Count: 1}}
	input.Current = many
	input.Previous.Growth.Funnel.Registered = 5
	input.Pool = EnginePool{Configured: true, EffectiveSlots: 100, EligibleAccounts: 2,
		FiveHour: &EngineHorizon{RemainingUSD: 5, CapacityUSD: 100}, Week: &EngineHorizon{RemainingUSD: 5, CapacityUSD: 100},
		Accounts: []EngineAccount{{CredentialID: 7, Status: "suspended"}}}
	require.Len(t, siteInsightsDigestFindings(input), 12)
	text = siteInsightsDigestText(input)
	assert.Contains(t, text, "需要关注：\n1. ")
	assert.Contains(t, text, "\n8. ")
	assert.NotContains(t, text, "\n9. ")
	assert.Contains(t, text, "另有 4 项，见控制台")
}

func TestSiteInsightsDigestMoneyFormatting(t *testing.T) {
	assert.Equal(t, "0.00", digestMoney(0))
	assert.Equal(t, "1,234,567.89", digestMoney(1234567.891))
	assert.Equal(t, "-12.50", digestMoney(-12.5))
	assert.Equal(t, "¥999.99", digestYuan(999.994))
	assert.Equal(t, "45,678", digestCount(45678))
	assert.Equal(t, "-1,000", digestCount(-1000))
}

// useSiteInsightsDigestDB opens an in-memory database with the option table
// the claim uses.
func useSiteInsightsDigestDB(t *testing.T) {
	t.Helper()
	useViolationTestDB(t, "sqlite")
	require.NoError(t, model.DB.AutoMigrate(&model.Option{}))
}

func TestSiteInsightsDigestClaimOnceWithTwoRunners(t *testing.T) {
	useSiteInsightsDigestDB(t)
	var mu sync.Mutex
	var claimed []string
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, ok, err := model.ClaimSiteInsightsDigestDay("2026-11-14")
			assert.NoError(t, err)
			if ok {
				mu.Lock()
				claimed = append(claimed, "2026-11-14")
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	assert.Len(t, claimed, 1, "two runners on the same day: exactly one owns the send")

	_, again, err := model.ClaimSiteInsightsDigestDay("2026-11-14")
	require.NoError(t, err)
	assert.False(t, again, "a restart later the same day does not send again")

	previous, next, err := model.ClaimSiteInsightsDigestDay("2026-11-15")
	require.NoError(t, err)
	assert.True(t, next, "the next day is claimable")
	assert.Equal(t, "2026-11-14", previous)

	require.NoError(t, model.ReleaseSiteInsightsDigestDay("2026-11-14", "2026-11-15"))
	_, retry, err := model.ClaimSiteInsightsDigestDay("2026-11-15")
	require.NoError(t, err)
	assert.True(t, retry, "a released day is claimable again")
}

// useDigestRun enables the digest, stubs its readers and sender, and counts
// the sends.
func useDigestRun(t *testing.T, sendErr error) *[]string {
	t.Helper()
	useSiteInsightsDigestDB(t)
	setting := operation_setting.GetSiteInsightsDigestSetting()
	previous := *setting
	*setting = operation_setting.SiteInsightsDigestSetting{Enabled: true, Hour: 9, FeishuWebhook: "https://open.feishu.cn/open-apis/bot/v2/hook/x"}
	t.Cleanup(func() { *setting = previous })

	previousRead, previousSend := readSiteInsightsDigestDay, sendSiteInsightsDigest
	readSiteInsightsDigestDay = func(start time.Time, _ time.Time) (digestDayFigures, error) {
		if start.Day() == 13 {
			return digestQuietDay(), nil
		}
		return digestFixture().Current, nil
	}
	var sent []string
	sendSiteInsightsDigest = func(webhook string, _ string, text string) error {
		if sendErr != nil {
			return sendErr
		}
		assert.Equal(t, setting.FeishuWebhook, webhook)
		sent = append(sent, text)
		return nil
	}
	t.Cleanup(func() { readSiteInsightsDigestDay, sendSiteInsightsDigest = previousRead, previousSend })
	return &sent
}

func TestRunSiteInsightsDigestSendsOncePerDay(t *testing.T) {
	sent := useDigestRun(t, nil)
	at := func(s string) time.Time {
		parsed, err := time.ParseInLocation("2006-01-02 15:04:05", s, digestBeijing)
		require.NoError(t, err)
		return parsed
	}
	ctx := context.Background()

	early, err := RunSiteInsightsDigest(ctx, at("2026-11-15 08:30:00"))
	require.NoError(t, err)
	assert.False(t, early.Sent)
	assert.Empty(t, *sent)

	first, err := RunSiteInsightsDigest(ctx, at("2026-11-15 09:05:00"))
	require.NoError(t, err)
	assert.True(t, first.Sent)
	assert.Equal(t, "2026-11-14", first.ReportDay)
	require.Len(t, *sent, 1)

	// A restart at 09:15, or a second server at 09:25, finds the day claimed.
	for _, s := range []string{"2026-11-15 09:15:00", "2026-11-15 09:25:00", "2026-11-15 23:50:00"} {
		again, err := RunSiteInsightsDigest(ctx, at(s))
		require.NoError(t, err)
		assert.False(t, again.Sent)
		assert.Equal(t, "already sent", again.Skipped)
	}
	assert.Len(t, *sent, 1)
}

func TestRunSiteInsightsDigestLateStartSendsLaterThatDay(t *testing.T) {
	sent := useDigestRun(t, nil)
	late, err := RunSiteInsightsDigest(context.Background(), time.Date(2026, 11, 15, 18, 40, 0, 0, digestBeijing))
	require.NoError(t, err)
	assert.True(t, late.Sent, "a server that was down at 09:00 sends when it comes up later that day")
	assert.Len(t, *sent, 1)

	missed, err := RunSiteInsightsDigest(context.Background(), time.Date(2026, 11, 16, 8, 0, 0, 0, digestBeijing))
	require.NoError(t, err)
	assert.Equal(t, "before the send hour", missed.Skipped, "the 14th's digest is not sent once its day is over")
	assert.Len(t, *sent, 1)
}

func TestRunSiteInsightsDigestSendErrorLeavesDayUnsent(t *testing.T) {
	sent := useDigestRun(t, errors.New("feishu answered status 500"))
	ctx := context.Background()
	at := time.Date(2026, 11, 15, 9, 10, 0, 0, digestBeijing)

	failed, err := RunSiteInsightsDigest(ctx, at)
	assert.Error(t, err)
	assert.False(t, failed.Sent)
	assert.Empty(t, *sent)

	// The claim was released, so the next run sends the day once the bot answers.
	sendSiteInsightsDigest = func(_ string, _ string, text string) error {
		*sent = append(*sent, text)
		return nil
	}
	retried, err := RunSiteInsightsDigest(ctx, at.Add(10*time.Minute))
	require.NoError(t, err)
	assert.True(t, retried.Sent)
	assert.Len(t, *sent, 1)
}

func TestRunSiteInsightsDigestDisabledOrNoWebhookSendsNothing(t *testing.T) {
	sent := useDigestRun(t, nil)
	setting := operation_setting.GetSiteInsightsDigestSetting()
	at := time.Date(2026, 11, 15, 10, 0, 0, 0, digestBeijing)

	setting.Enabled = false
	off, err := RunSiteInsightsDigest(context.Background(), at)
	require.NoError(t, err)
	assert.Equal(t, "disabled", off.Skipped)

	setting.Enabled, setting.FeishuWebhook = true, "  "
	noBot, err := RunSiteInsightsDigest(context.Background(), at)
	require.NoError(t, err)
	assert.Equal(t, "disabled", noBot.Skipped)
	assert.Empty(t, *sent)

	var stored string
	require.NoError(t, model.DB.Model(&model.Option{}).Where("`key` = ?", "site_insights_digest.sent_day").Select("value").Scan(&stored).Error)
	assert.Empty(t, stored, "a disabled digest never claims a day")
}

func TestSendSiteInsightsDigestNowClaimsNothing(t *testing.T) {
	sent := useDigestRun(t, nil)
	setting := operation_setting.GetSiteInsightsDigestSetting()

	setting.FeishuWebhook = " "
	assert.Error(t, SendSiteInsightsDigestNow(time.Date(2026, 11, 15, 10, 0, 0, 0, digestBeijing)))
	assert.Empty(t, *sent)

	setting.FeishuWebhook = "https://open.feishu.cn/open-apis/bot/v2/hook/x"
	setting.Enabled = false
	require.NoError(t, SendSiteInsightsDigestNow(time.Date(2026, 11, 15, 10, 0, 0, 0, digestBeijing)))
	require.Len(t, *sent, 1, "the test send goes out even while the schedule is off")
	assert.Contains(t, (*sent)[0], "【站点日报】2026-11-14")

	// The scheduled send for the same day is still open.
	setting.Enabled = true
	scheduled, err := RunSiteInsightsDigest(context.Background(), time.Date(2026, 11, 15, 10, 0, 0, 0, digestBeijing))
	require.NoError(t, err)
	assert.True(t, scheduled.Sent)
}
