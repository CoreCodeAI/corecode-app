package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

// CoreCode fork: reads what upstream new-api sites charge for our requests,
// for the site insights' upstream view. A new-api site answers its log of a
// key at /api/log/token to that key alone, so a channel's own key reads its
// bill; nothing else has to be configured when a channel is added.
//
// A channel whose upstream is not a new-api site is read as a Sub2API site
// instead, when its usage answer at /v1/usage has the expected shape: its
// bill comes as day totals per model (see syncSub2APIBills).

const (
	upstreamCostTickInterval = 5 * time.Minute
	upstreamCostTimeout      = 20 * time.Second
	// A channel whose upstream does not answer as a new-api site is tried
	// again after this long.
	upstreamCostRetryAfter = 6 * time.Hour
	// Keys read per channel; a multi-key channel's further keys are left out.
	upstreamCostMaxKeys = 5
	// The most bytes read from one answer; a new-api site returns at most
	// its MaxRecentItems logs.
	upstreamCostMaxBody = 16 << 20
	// A Sub2API bill is read this often per channel, under the console's
	// stale threshold; each read asks for upstreamBillRefreshDays days. The
	// first read goes back to the day the channel was created, at most
	// upstreamBillBackfillDays: a request a day, so a new channel is not
	// asked for ninety days it never served.
	upstreamBillInterval     = 15 * time.Minute
	upstreamBillRefreshDays  = 3
	upstreamBillBackfillDays = 90
)

var (
	upstreamCostOnce sync.Once
	// upstreamCostSkip holds, per channel id, when a channel whose upstream
	// is not a new-api site may be tried again.
	upstreamCostSkip = map[int]time.Time{}
	// upstreamBillNext holds, per channel id, when a Sub2API bill may be
	// read again. Reads are idempotent, so each server keeps its own.
	upstreamBillNext = map[int]time.Time{}
)

// StartUpstreamCostTask reads the upstream bills every five minutes on the
// master node. During a release both colors run it; a stored request is not
// stored twice.
func StartUpstreamCostTask() {
	upstreamCostOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(upstreamCostTickInterval)
			defer ticker.Stop()
			for {
				syncUpstreamCosts(context.Background())
				<-ticker.C
			}
		})
	})
}

func syncUpstreamCosts(ctx context.Context) {
	channels, err := model.UpstreamCostChannels()
	if err != nil {
		logger.LogWarn(ctx, common.LogText("upstream costs: list channels: %v", err))
		return
	}
	now := time.Now()
	owners := newBillOwners(channels)
	for _, channel := range channels {
		if until, ok := upstreamCostSkip[channel.Id]; ok && now.Before(until) {
			continue
		}
		added, err := syncUpstreamChannel(ctx, channel, owners)
		if err != nil {
			upstreamCostSkip[channel.Id] = now.Add(upstreamCostRetryAfter)
			logger.LogInfo(ctx, common.LogText("upstream costs: channel %d not read, retried in %s: %v", channel.Id, upstreamCostRetryAfter, err))
			continue
		}
		delete(upstreamCostSkip, channel.Id)
		if added > 0 {
			logger.LogInfo(ctx, common.LogText("upstream costs: channel %d stored %d requests", channel.Id, added))
		}
	}
	if err := model.PruneUpstreamCosts(now.Unix()); err != nil {
		logger.LogWarn(ctx, common.LogText("upstream costs: prune: %v", err))
	}
	if err := model.PruneUpstreamBillDays(now.Unix()); err != nil {
		logger.LogWarn(ctx, common.LogText("upstream bills: prune: %v", err))
	}
}

// upstreamLog is the part of a new-api log entry the cost needs.
type upstreamLog struct {
	CreatedAt        int64  `json:"created_at"`
	Type             int    `json:"type"`
	ModelName        string `json:"model_name"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	Group            string `json:"group"`
	RequestId        string `json:"request_id"`
	Other            string `json:"other"`
}

func syncUpstreamChannel(ctx context.Context, channel *model.Channel, owners func(key, modelName string) int) (int64, error) {
	setting := channel.GetSetting()
	client, err := GetHttpClientWithProxySettings(setting.Proxy, setting)
	if err != nil {
		return 0, err
	}
	base := strings.TrimRight(strings.TrimSpace(channel.GetBaseURL()), "/")
	perUnit := readUpstreamQuotaPerUnit(ctx, client, base)
	keys := channel.GetKeys()
	if len(keys) > upstreamCostMaxKeys {
		keys = keys[:upstreamCostMaxKeys]
	}
	if len(keys) == 0 {
		return 0, fmt.Errorf("no key")
	}
	var added int64
	read := false
	var lastErr error
	for _, key := range keys {
		var answer struct {
			Success bool          `json:"success"`
			Message string        `json:"message"`
			Data    []upstreamLog `json:"data"`
		}
		if err := getUpstreamJSON(ctx, client, base+"/api/log/token", strings.TrimSpace(key), &answer); err != nil {
			lastErr = err
			continue
		}
		if !answer.Success {
			lastErr = fmt.Errorf("upstream refused: %s", answer.Message)
			continue
		}
		read = true
		costs := make([]model.UpstreamCost, 0, len(answer.Data))
		for _, entry := range answer.Data {
			if entry.Type != model.LogTypeConsume || entry.RequestId == "" || len(entry.RequestId) > 96 {
				continue
			}
			var other struct {
				GroupRatio float64 `json:"group_ratio"`
			}
			if entry.Other != "" {
				_ = common.UnmarshalJsonStr(entry.Other, &other)
			}
			costs = append(costs, model.UpstreamCost{
				ChannelId:        channel.Id,
				RequestId:        entry.RequestId,
				CreatedAt:        entry.CreatedAt,
				ModelName:        entry.ModelName,
				Quota:            entry.Quota,
				QuotaPerUnit:     perUnit,
				PromptTokens:     entry.PromptTokens,
				CompletionTokens: entry.CompletionTokens,
				GroupName:        entry.Group,
				GroupRatio:       other.GroupRatio,
			})
		}
		n, err := model.SaveUpstreamCosts(costs)
		if err != nil {
			return added, err
		}
		added += n
	}
	if !read {
		// Not a new-api site: read it as a Sub2API site. Its error, if any,
		// is reported with the new-api one, and the channel is retried later.
		if err := syncSub2APIBills(ctx, client, channel, owners, time.Now()); err != nil {
			return 0, fmt.Errorf("%w; Sub2API bill: %v", lastErr, err)
		}
		return 0, nil
	}
	return added, nil
}

// readUpstreamQuotaPerUnit reads how many quota units the upstream counts
// to a dollar, 0 when it does not say.
func readUpstreamQuotaPerUnit(ctx context.Context, client *http.Client, base string) float64 {
	var status struct {
		Data struct {
			QuotaPerUnit float64 `json:"quota_per_unit"`
		} `json:"data"`
	}
	if err := getUpstreamJSON(ctx, client, base+"/api/status", "", &status); err != nil {
		return 0
	}
	return status.Data.QuotaPerUnit
}

func getUpstreamJSON(ctx context.Context, client *http.Client, url, key string, into any) error {
	ctx, cancel := context.WithTimeout(ctx, upstreamCostTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, upstreamCostMaxBody))
	if err != nil {
		return err
	}
	return common.Unmarshal(body, into)
}

// billKeysOf returns the channel's keys a bill is read with: the first
// upstreamCostMaxKeys, trimmed.
func billKeysOf(channel *model.Channel) []string {
	keys := channel.GetKeys()
	if len(keys) > upstreamCostMaxKeys {
		keys = keys[:upstreamCostMaxKeys]
	}
	for i, key := range keys {
		keys[i] = strings.TrimSpace(key)
	}
	return keys
}

// newBillOwners decides which channel stores a key's bill for a model, so a
// key that two channels hold is counted once. It is the lowest-numbered
// channel that serves the model (its models, and the names its model mapping
// sends upstream), else the lowest-numbered channel holding the key. Each
// read stores only the rows its channel owns; the owner is recomputed on
// every tick from the same channel list.
func newBillOwners(channels []*model.Channel) func(key, modelName string) int {
	holders := map[string]int{}
	serving := map[string]int{}
	for _, channel := range channels {
		names := channelBillNames(channel)
		for _, key := range billKeysOf(channel) {
			if id, ok := holders[key]; !ok || channel.Id < id {
				holders[key] = channel.Id
			}
			for _, name := range names {
				mark := key + "\x00" + name
				if id, ok := serving[mark]; !ok || channel.Id < id {
					serving[mark] = channel.Id
				}
			}
		}
	}
	return func(key, modelName string) int {
		if id, ok := serving[key+"\x00"+modelName]; ok {
			return id
		}
		return holders[key]
	}
}

// channelBillNames lists the model names a channel sends upstream: its own
// models and the targets of its model mapping.
func channelBillNames(channel *model.Channel) []string {
	names := channel.GetModels()
	var mapping map[string]string
	if common.UnmarshalJsonStr(channel.GetModelMapping(), &mapping) == nil {
		for _, to := range mapping {
			names = append(names, to)
		}
	}
	return names
}

// sub2apiUsage is the part of a Sub2API /v1/usage answer the bill reads. The
// answer holds the key's usage totals and, for the date range asked, the
// models it was billed for. Its required fields are pointers, so an answer
// without them is refused rather than read as zero.
type sub2apiUsage struct {
	Mode  string `json:"mode"`
	Usage *struct {
		Total *struct {
			ActualCost *float64 `json:"actual_cost"`
		} `json:"total"`
	} `json:"usage"`
	// ModelStats is omitted by the site when the key was billed for nothing
	// in the range.
	ModelStats []struct {
		Model      string   `json:"model"`
		Requests   *int64   `json:"requests"`
		Cost       *float64 `json:"cost"`
		ActualCost *float64 `json:"actual_cost"`
	} `json:"model_stats"`
}

// readSub2APIKey reads what a Sub2API key was billed, one day at a time, for
// the days given, newest first. It returns one row per day and model, and
// refuses an answer whose shape it does not know or whose days add up to
// more than the key's total.
func readSub2APIKey(ctx context.Context, client *http.Client, base, key string, days []int64) ([]model.UpstreamBillDay, error) {
	var rows []model.UpstreamBillDay
	var total, billed float64
	for i, day := range days {
		// day is the UTC+8 midnight; its calendar date is the UTC date of day + offset.
		date := time.Unix(day+model.UpstreamBillDayOffset, 0).UTC().Format("2006-01-02")
		var answer sub2apiUsage
		if err := getUpstreamJSON(ctx, client, base+"/v1/usage?start_date="+date+"&end_date="+date, key, &answer); err != nil {
			return nil, err
		}
		if (answer.Mode != "unrestricted" && answer.Mode != "quota_limited") || answer.Usage == nil || answer.Usage.Total == nil || answer.Usage.Total.ActualCost == nil {
			return nil, fmt.Errorf("%s: not a Sub2API usage answer", date)
		}
		if i == 0 {
			total = *answer.Usage.Total.ActualCost
		}
		for _, stat := range answer.ModelStats {
			if stat.Model == "" || stat.Requests == nil || stat.Cost == nil || stat.ActualCost == nil || *stat.Cost < 0 || *stat.ActualCost < 0 {
				return nil, fmt.Errorf("%s: a model row without a usable cost", date)
			}
			rows = append(rows, model.UpstreamBillDay{
				DayStart:        day,
				ModelName:       stat.Model,
				Requests:        *stat.Requests,
				CostUSD:         *stat.ActualCost,
				StandardCostUSD: *stat.Cost,
			})
			billed += *stat.ActualCost
		}
	}
	if billed > total*(1+1e-9)+1e-6 {
		return nil, fmt.Errorf("the days read cost %.6f, more than the key's total %.6f", billed, total)
	}
	return rows, nil
}

// syncSub2APIBills reads a channel's bill from a Sub2API site, key by key:
// the last upstreamBillRefreshDays days on each read, and on the first back
// to the channel's creation, at most upstreamBillBackfillDays. Days are the site's UTC+8 days, the
// zone its usage endpoint counts a date in. A day with no billed model is
// stored as one row with no model, so the read is known to have happened.
// Nothing is stored unless every key read, so a failure leaves the channel's
// rows as they were.
func syncSub2APIBills(ctx context.Context, client *http.Client, channel *model.Channel, owners func(key, modelName string) int, now time.Time) error {
	if next, ok := upstreamBillNext[channel.Id]; ok && now.Before(next) {
		return nil
	}
	base := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(channel.GetBaseURL()), "/"), "/v1")
	local := now.Unix() + model.UpstreamBillDayOffset
	today := local - local%86400 - model.UpstreamBillDayOffset
	backfill := upstreamBillBackfillDays
	if age := int((today-channel.CreatedTime)/86400) + 2; channel.CreatedTime > 0 && age < backfill {
		backfill = max(age, upstreamBillRefreshDays)
	}
	covered, err := model.UpstreamBillCovers(channel.Id, today-int64(backfill-1)*86400)
	if err != nil {
		return err
	}
	count := upstreamBillRefreshDays
	if !covered {
		count = backfill
	}
	days := make([]int64, count)
	for i := range days {
		days[i] = today - int64(i)*86400
	}

	type billKey struct {
		day  int64
		name string
	}
	owned := map[billKey]*model.UpstreamBillDay{}
	for _, key := range billKeysOf(channel) {
		bills, err := readSub2APIKey(ctx, client, base, key, days)
		if err != nil {
			return err
		}
		for _, bill := range bills {
			if owners(key, bill.ModelName) != channel.Id {
				continue
			}
			k := billKey{bill.DayStart, bill.ModelName}
			row := owned[k]
			if row == nil {
				row = &model.UpstreamBillDay{ChannelId: channel.Id, DayStart: bill.DayStart, ModelName: bill.ModelName}
				owned[k] = row
			}
			row.Requests += bill.Requests
			row.CostUSD += bill.CostUSD
			row.StandardCostUSD += bill.StandardCostUSD
		}
	}
	rows := make([]model.UpstreamBillDay, 0, len(owned)+count)
	billedDays := map[int64]bool{}
	for k, row := range owned {
		row.ReadAt = now.Unix()
		rows = append(rows, *row)
		billedDays[k.day] = true
	}
	for _, day := range days {
		if !billedDays[day] {
			rows = append(rows, model.UpstreamBillDay{ChannelId: channel.Id, DayStart: day, ReadAt: now.Unix()})
		}
	}
	if err := model.SaveUpstreamBillDays(channel.Id, days[count-1], rows); err != nil {
		return err
	}
	upstreamBillNext[channel.Id] = now.Add(upstreamBillInterval)
	logger.LogInfo(ctx, common.LogText("upstream bills: channel %d read %d days from a Sub2API site, %d model rows", channel.Id, count, len(owned)))
	return nil
}
