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
)

var (
	upstreamCostOnce sync.Once
	// upstreamCostSkip holds, per channel id, when a channel whose upstream
	// is not a new-api site may be tried again.
	upstreamCostSkip = map[int]time.Time{}
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
	for _, channel := range channels {
		if until, ok := upstreamCostSkip[channel.Id]; ok && now.Before(until) {
			continue
		}
		added, err := syncUpstreamChannel(ctx, channel)
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

func syncUpstreamChannel(ctx context.Context, channel *model.Channel) (int64, error) {
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
		return 0, lastErr
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
