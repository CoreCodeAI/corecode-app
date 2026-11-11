package model

import (
	"cmp"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm/clause"
)

// CoreCode fork: the site insights' upstream view. It compares the channels
// requests went to: how many each served and failed, how fast, what
// customers paid on it, and what the upstream charged for it.

// InsightChannelHour is one channel's figures for one model in an hour, root
// included. Requests counts the requests the channel served and Errors the
// attempts that failed on it, so a request that failed on one channel and
// was served by another counts once on each. Rescued counts the served
// requests that had failed elsewhere first; RescuedFrom maps each channel
// they failed on to a count. Quota is what customers were charged, root left
// out. TTFT, Latency, Reasons and RescuedFrom are JSON.
type InsightChannelHour struct {
	HourStart        int64  `gorm:"primaryKey;autoIncrement:false"`
	ChannelId        int    `gorm:"primaryKey;autoIncrement:false"`
	ModelName        string `gorm:"primaryKey;type:varchar(191)"`
	Requests         int64  `gorm:"not null;default:0"`
	Errors           int64  `gorm:"not null;default:0"`
	Rescued          int64  `gorm:"not null;default:0"`
	Quota            int64  `gorm:"not null;default:0"`
	PromptTokens     int64  `gorm:"not null;default:0"`
	CacheRead        int64  `gorm:"not null;default:0"`
	CacheWrite       int64  `gorm:"not null;default:0"`
	CompletionTokens int64  `gorm:"not null;default:0"`
	TTFT             string `gorm:"column:ttft;type:text"`
	Latency          string `gorm:"type:text"`
	Reasons          string `gorm:"type:text"`
	RescuedFrom      string `gorm:"type:text"`
}

type insightChannelKey struct {
	channel int
	model   string
}

type insightChannel struct {
	row         InsightChannelHour
	ttft        histogram
	latency     histogram
	reasons     map[string]int64
	rescuedFrom map[string]int64
}

// Failure reasons kept per channel and model in an hour.
const insightChannelReasonsTopN = 10

func (h *insightHour) channelOf(channelID int, modelName string) *insightChannel {
	key := insightChannelKey{channelID, modelName}
	channel := h.channels[key]
	if channel == nil {
		channel = &insightChannel{
			row:         InsightChannelHour{HourStart: h.start, ChannelId: channelID, ModelName: modelName},
			ttft:        histogram{},
			latency:     histogram{},
			reasons:     map[string]int64{},
			rescuedFrom: map[string]int64{},
		}
		h.channels[key] = channel
	}
	return channel
}

func (c *insightChannel) addError(content string) {
	c.row.Errors++
	c.reasons[errorReason(content)]++
}

func (c *insightChannel) addConsumption(log insightLog, other logOtherFields, customer bool) {
	c.row.Requests++
	if customer {
		c.row.Quota += int64(log.Quota)
	}
	c.row.PromptTokens += int64(log.PromptTokens)
	c.row.CacheRead += other.CacheTokens
	c.row.CacheWrite += other.CacheCreationTokens
	c.row.CompletionTokens += int64(log.CompletionTokens)
	c.latency.add(int64(log.UseTime))
	if log.IsStream && other.Frt > 0 {
		c.ttft.add(int64(other.Frt))
	}
	served := strconv.Itoa(log.ChannelId)
	failedOn := map[string]bool{}
	for _, id := range other.AdminInfo.UseChannel {
		if id != served && id != "" {
			failedOn[id] = true
		}
	}
	if len(failedOn) > 0 {
		c.row.Rescued++
		for id := range failedOn {
			c.rescuedFrom[id]++
		}
	}
}

func encodeCounts(counts map[string]int64) string {
	if len(counts) == 0 {
		return ""
	}
	data, err := common.Marshal(counts)
	if err != nil {
		return ""
	}
	return string(data)
}

func decodeCounts(data string) map[string]int64 {
	counts := map[string]int64{}
	if data != "" {
		_ = common.UnmarshalJsonStr(data, &counts)
	}
	return counts
}

func (c *insightChannel) encode() InsightChannelHour {
	row := c.row
	row.TTFT, row.Latency = c.ttft.encode(), c.latency.encode()
	row.Reasons = encodeCounts(keepTop(c.reasons, insightChannelReasonsTopN))
	row.RescuedFrom = encodeCounts(c.rescuedFrom)
	return row
}

func decodeInsightChannel(row InsightChannelHour) *insightChannel {
	return &insightChannel{
		row:         row,
		ttft:        decodeHistogram(row.TTFT),
		latency:     decodeHistogram(row.Latency),
		reasons:     decodeCounts(row.Reasons),
		rescuedFrom: decodeCounts(row.RescuedFrom),
	}
}

// UpstreamCost is one request as an upstream new-api site billed it, read
// from that site's log of the channel's key. RequestId is the upstream's
// request id, which is the upstream_request_id of our log for the same
// request. Quota is in the upstream's units, QuotaPerUnit of them a dollar.
type UpstreamCost struct {
	ChannelId        int     `gorm:"primaryKey;autoIncrement:false"`
	RequestId        string  `gorm:"primaryKey;type:varchar(96)"`
	CreatedAt        int64   `gorm:"index;not null"`
	ModelName        string  `gorm:"type:varchar(191)"`
	Quota            int64   `gorm:"not null;default:0"`
	QuotaPerUnit     float64 `gorm:"not null;default:0"`
	PromptTokens     int64   `gorm:"not null;default:0"`
	CompletionTokens int64   `gorm:"not null;default:0"`
	GroupName        string  `gorm:"type:varchar(191)"`
	GroupRatio       float64 `gorm:"not null;default:0"`
}

// UpstreamCostRetentionDays bounds the stored upstream costs; the view reads
// at most InsightsMaxLogDays.
const UpstreamCostRetentionDays = InsightsMaxLogDays + 30

// SaveUpstreamCosts stores costs not stored yet and returns how many it
// added. The upstream's log overlaps between reads, so a known request is
// skipped.
func SaveUpstreamCosts(costs []UpstreamCost) (int64, error) {
	if len(costs) == 0 {
		return 0, nil
	}
	result := DB.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(costs, 200)
	return result.RowsAffected, result.Error
}

// PruneUpstreamCosts deletes costs older than the retention.
func PruneUpstreamCosts(now int64) error {
	return DB.Where("created_at < ?", now-UpstreamCostRetentionDays*86400).Delete(&UpstreamCost{}).Error
}

// UpstreamCostChannels returns the channels whose upstream cost can be read:
// enabled ones whose base URL names a public host. A channel served inside
// the deployment, such as the engine at http://gpt-load:3001, has no
// upstream bill to read.
func UpstreamCostChannels() ([]*Channel, error) {
	var channels []*Channel
	if err := DB.Where("status = ?", common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil, err
	}
	return slices.DeleteFunc(channels, func(channel *Channel) bool {
		return !PublicUpstreamHost(channel.GetBaseURL())
	}), nil
}

// PublicUpstreamHost reports whether a base URL names a host on the public
// internet: http or https, a dotted name, not an address.
func PublicUpstreamHost(baseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return false
	}
	host := parsed.Hostname()
	if host == "" || !strings.Contains(host, ".") || host == "localhost" {
		return false
	}
	return !strings.ContainsAny(host, ":") && !isNumericHost(host)
}

func isNumericHost(host string) bool {
	for _, part := range strings.Split(host, ".") {
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

// UpstreamFeesOptionKey holds what a channel costs a month regardless of
// use, such as a subscription account, keyed by channel id, in US dollars.
const UpstreamFeesOptionKey = "UpstreamChannelFees"

var errInvalidUpstreamFee error = common.NewMessage("Invalid upstream fee")

// ReadUpstreamFees reads the option row itself, so a fee saved through one
// server counts at once on the other during a release.
func ReadUpstreamFees() (map[int]float64, error) {
	var option Option
	if err := DB.Where(commonKeyCol+" = ?", UpstreamFeesOptionKey).Limit(1).Find(&option).Error; err != nil {
		return nil, err
	}
	fees := map[int]float64{}
	if strings.TrimSpace(option.Value) == "" {
		return fees, nil
	}
	if err := common.UnmarshalJsonStr(option.Value, &fees); err != nil {
		return nil, err
	}
	return fees, nil
}

// SaveUpstreamFees replaces the monthly fees. A zero fee is dropped.
func SaveUpstreamFees(fees map[int]float64) error {
	kept := map[int]float64{}
	for id, fee := range fees {
		if id <= 0 || math.IsNaN(fee) || fee < 0 || fee > 1e7 {
			return errInvalidUpstreamFee
		}
		if fee > 0 {
			kept[id] = fee
		}
	}
	if len(kept) > 1000 {
		return errInvalidUpstreamFee
	}
	value, err := common.Marshal(kept)
	if err != nil {
		return err
	}
	return UpdateOption(UpstreamFeesOptionKey, string(value))
}

// Where a channel's cost comes from.
const (
	UpstreamCostSourceUpstream = "upstream"
	UpstreamCostSourceFee      = "fee"
	UpstreamCostSourceNone     = "none"
)

// UpstreamChannel is one channel over the range. Attempts are Requests plus
// Errors; FailureRate is Errors over them. RevenueUSD is what customers were
// charged for the requests it served. CostUSD is the upstream's bill for the
// range when the upstream's log is read (CostSource "upstream"), else the
// monthly fee spread over the range ("fee"). LatestCostAt is the newest
// upstream cost stored for the channel, at any time.
type UpstreamChannel struct {
	ID               int          `json:"id"`
	Name             string       `json:"name"`
	Status           int          `json:"status"`
	Priority         int64        `json:"priority"`
	Host             string       `json:"host"`
	Requests         int64        `json:"requests"`
	Errors           int64        `json:"errors"`
	FailureRate      float64      `json:"failure_rate"`
	Rescued          int64        `json:"rescued"`
	RevenueUSD       float64      `json:"revenue_usd"`
	CostUSD          float64      `json:"cost_usd"`
	CostSource       string       `json:"cost_source"`
	MonthlyFeeUSD    float64      `json:"monthly_fee_usd"`
	LatestCostAt     int64        `json:"latest_cost_at"`
	UpstreamGroup    string       `json:"upstream_group"`
	UpstreamRatio    float64      `json:"upstream_group_ratio"`
	TTFTP50          int64        `json:"ttft_p50_ms"`
	TTFTP95          int64        `json:"ttft_p95_ms"`
	LatencyP50       int64        `json:"latency_p50_s"`
	PromptTokens     int64        `json:"prompt_tokens"`
	CacheRead        int64        `json:"cache_read_tokens"`
	CompletionTokens int64        `json:"completion_tokens"`
	Reasons          []NamedCount `json:"reasons"`
}

// UpstreamModel is one model on one channel over the range. CostUSD is the
// upstream's bill for it; a fee is not split by model.
type UpstreamModel struct {
	Model       string  `json:"model"`
	ChannelID   int     `json:"channel_id"`
	Requests    int64   `json:"requests"`
	Errors      int64   `json:"errors"`
	FailureRate float64 `json:"failure_rate"`
	Rescued     int64   `json:"rescued"`
	TTFTP50     int64   `json:"ttft_p50_ms"`
	LatencyP50  int64   `json:"latency_p50_s"`
	RevenueUSD  float64 `json:"revenue_usd"`
	CostUSD     float64 `json:"cost_usd"`
}

// UpstreamDay is one channel's day.
type UpstreamDay struct {
	Day        int64   `json:"day"`
	ChannelID  int     `json:"channel_id"`
	Requests   int64   `json:"requests"`
	Errors     int64   `json:"errors"`
	RevenueUSD float64 `json:"revenue_usd"`
	CostUSD    float64 `json:"cost_usd"`
}

// UpstreamHour is one channel's UTC hour, with the UpstreamDay figures.
// Revenue is bucketed by the hour our request began, an upstream bill by its
// own created_at, so a request near an hour's end may land in two hours.
type UpstreamHour struct {
	Hour       int64   `json:"hour"`
	ChannelID  int     `json:"channel_id"`
	Requests   int64   `json:"requests"`
	Errors     int64   `json:"errors"`
	RevenueUSD float64 `json:"revenue_usd"`
	CostUSD    float64 `json:"cost_usd"`
}

// UpstreamRescue counts requests that failed on From and were served by To.
type UpstreamRescue struct {
	From  int   `json:"from"`
	To    int   `json:"to"`
	Count int64 `json:"count"`
}

// UpstreamInsights is the upstream view. Hourly, like Daily, holds a row per
// hour and channel with traffic or cost, for a range up to
// insightsHourlySpan.
type UpstreamInsights struct {
	Channels  []UpstreamChannel `json:"channels"`
	Models    []UpstreamModel   `json:"models"`
	Daily     []UpstreamDay     `json:"daily"`
	Hourly    []UpstreamHour    `json:"hourly,omitempty"`
	Rescues   []UpstreamRescue  `json:"rescues"`
	Truncated bool              `json:"truncated"`
}

type upstreamCostRow struct {
	ChannelId    int
	ModelName    string
	CreatedAt    int64
	Quota        int64
	QuotaPerUnit float64
}

func upstreamHost(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

// GetUpstreamInsights reads the channel hours and the upstream costs over the
// range. A channel appears when it is enabled or had traffic in the range;
// requests that never reached a channel (channel 0) are left out.
func GetUpstreamInsights(r InsightsRange) (*UpstreamInsights, error) {
	hours, err := loadInsightHours(r)
	if err != nil {
		return nil, err
	}
	type bucket struct {
		row          UpstreamModel
		ttft         histogram
		latency      histogram
		prompt       int64
		cacheRead    int64
		completion   int64
		reasons      map[string]int64
		rescuedFrom  map[string]int64
		quotaRevenue int64
	}
	newBucket := func() *bucket {
		return &bucket{ttft: histogram{}, latency: histogram{}, reasons: map[string]int64{}, rescuedFrom: map[string]int64{}}
	}
	models := map[insightChannelKey]*bucket{}
	channels := map[int]*bucket{}
	type dayKey struct {
		day     int64
		channel int
	}
	days := map[dayKey]*UpstreamDay{}
	dayOf := func(day int64, channel int) *UpstreamDay {
		key := dayKey{day, channel}
		entry := days[key]
		if entry == nil {
			entry = &UpstreamDay{Day: day, ChannelID: channel}
			days[key] = entry
		}
		return entry
	}
	hourStarts := r.hourStarts()
	hourly := map[dayKey]*UpstreamHour{}
	hourOf := func(hour int64, channel int) *UpstreamHour {
		key := dayKey{hour, channel}
		entry := hourly[key]
		if entry == nil {
			entry = &UpstreamHour{Hour: hour, ChannelID: channel}
			hourly[key] = entry
		}
		return entry
	}
	result := &UpstreamInsights{}
	for _, hour := range hours {
		result.Truncated = result.Truncated || hour.summary.Truncated
		day := r.DayStart(hour.start)
		for key, channel := range hour.channels {
			if key.channel == 0 {
				continue
			}
			model := models[key]
			if model == nil {
				model = newBucket()
				model.row = UpstreamModel{Model: key.model, ChannelID: key.channel}
				models[key] = model
			}
			total := channels[key.channel]
			if total == nil {
				total = newBucket()
				channels[key.channel] = total
			}
			row := channel.row
			for _, b := range []*bucket{model, total} {
				b.row.Requests += row.Requests
				b.row.Errors += row.Errors
				b.row.Rescued += row.Rescued
				b.quotaRevenue += row.Quota
				b.prompt += row.PromptTokens
				b.cacheRead += row.CacheRead
				b.completion += row.CompletionTokens
				b.ttft.merge(channel.ttft)
				b.latency.merge(channel.latency)
				mergeCounts(b.reasons, channel.reasons)
				mergeCounts(b.rescuedFrom, channel.rescuedFrom)
			}
			entry := dayOf(day, key.channel)
			entry.Requests += row.Requests
			entry.Errors += row.Errors
			entry.RevenueUSD += float64(row.Quota) / common.QuotaPerUnit
			if hourStarts != nil {
				slot := hourOf(hour.start, key.channel)
				slot.Requests += row.Requests
				slot.Errors += row.Errors
				slot.RevenueUSD += float64(row.Quota) / common.QuotaPerUnit
			}
		}
	}

	var costs []upstreamCostRow
	if err := DB.Model(&UpstreamCost{}).
		Select("channel_id, model_name, created_at, quota, quota_per_unit").
		Where("created_at >= ? AND created_at < ?", r.Start, r.End).
		Scan(&costs).Error; err != nil {
		return nil, err
	}
	costByModel := map[insightChannelKey]float64{}
	costByChannel := map[int]float64{}
	for _, cost := range costs {
		usd := float64(cost.Quota) / upstreamQuotaPerUnit(cost.QuotaPerUnit)
		costByModel[insightChannelKey{cost.ChannelId, cost.ModelName}] += usd
		costByChannel[cost.ChannelId] += usd
		dayOf(r.DayStart(cost.CreatedAt), cost.ChannelId).CostUSD += usd
		if hourStarts != nil {
			hourOf(insightHourKey(cost.CreatedAt), cost.ChannelId).CostUSD += usd
		}
	}
	type latest struct {
		ChannelId  int
		CreatedAt  int64
		GroupName  string
		GroupRatio float64
	}
	var latestRows []latest
	if err := DB.Raw(`SELECT c.channel_id, c.created_at, c.group_name, c.group_ratio FROM upstream_costs c
		JOIN (SELECT channel_id, MAX(created_at) AS created_at FROM upstream_costs GROUP BY channel_id) m
		ON c.channel_id = m.channel_id AND c.created_at = m.created_at`).Scan(&latestRows).Error; err != nil {
		return nil, err
	}
	latestOf := map[int]latest{}
	for _, row := range latestRows {
		latestOf[row.ChannelId] = row
	}
	fees, err := ReadUpstreamFees()
	if err != nil {
		return nil, err
	}

	var known []*Channel
	if err := DB.Omit("key").Find(&known).Error; err != nil {
		return nil, err
	}
	span := float64(r.End-r.Start) / 86400
	for _, channel := range known {
		total := channels[channel.Id]
		if total == nil {
			if channel.Status != common.ChannelStatusEnabled {
				continue
			}
			total = newBucket()
		}
		row := UpstreamChannel{
			ID:               channel.Id,
			Name:             channel.Name,
			Status:           channel.Status,
			Priority:         channel.GetPriority(),
			Host:             upstreamHost(channel.GetBaseURL()),
			Requests:         total.row.Requests,
			Errors:           total.row.Errors,
			Rescued:          total.row.Rescued,
			FailureRate:      ratio(float64(total.row.Errors), float64(total.row.Requests+total.row.Errors)),
			RevenueUSD:       float64(total.quotaRevenue) / common.QuotaPerUnit,
			MonthlyFeeUSD:    fees[channel.Id],
			TTFTP50:          total.ttft.percentile(0.5),
			TTFTP95:          total.ttft.percentile(0.95),
			LatencyP50:       total.latency.percentile(0.5),
			PromptTokens:     total.prompt,
			CacheRead:        total.cacheRead,
			CompletionTokens: total.completion,
			Reasons:          topNamedCounts(total.reasons, 5),
			CostSource:       UpstreamCostSourceNone,
		}
		if last, ok := latestOf[channel.Id]; ok {
			row.CostSource = UpstreamCostSourceUpstream
			row.CostUSD = costByChannel[channel.Id]
			row.LatestCostAt = last.CreatedAt
			row.UpstreamGroup = last.GroupName
			row.UpstreamRatio = last.GroupRatio
		} else if fee := fees[channel.Id]; fee > 0 {
			row.CostSource = UpstreamCostSourceFee
			row.CostUSD = fee * span / 30
			for _, day := range r.days() {
				dayOf(day, channel.Id).CostUSD += fee * float64(min(r.End, day+86400)-max(r.Start, day)) / 86400 / 30
			}
			for _, hour := range hourStarts {
				hourOf(hour, channel.Id).CostUSD += fee * float64(min(r.End, hour+3600)-max(r.Start, hour)) / 86400 / 30
			}
		}
		result.Channels = append(result.Channels, row)
		for id, count := range total.rescuedFrom {
			from, err := strconv.Atoi(id)
			if err != nil {
				continue
			}
			result.Rescues = append(result.Rescues, UpstreamRescue{From: from, To: channel.Id, Count: count})
		}
	}
	slices.SortFunc(result.Channels, func(a, b UpstreamChannel) int {
		return cmp.Or(cmp.Compare(b.Requests+b.Errors, a.Requests+a.Errors), cmp.Compare(a.ID, b.ID))
	})
	for key, model := range models {
		row := model.row
		row.FailureRate = ratio(float64(row.Errors), float64(row.Requests+row.Errors))
		row.TTFTP50 = model.ttft.percentile(0.5)
		row.LatencyP50 = model.latency.percentile(0.5)
		row.RevenueUSD = float64(model.quotaRevenue) / common.QuotaPerUnit
		row.CostUSD = costByModel[key]
		result.Models = append(result.Models, row)
	}
	slices.SortFunc(result.Models, func(a, b UpstreamModel) int {
		return cmp.Or(cmp.Compare(a.Model, b.Model), cmp.Compare(b.Requests, a.Requests), cmp.Compare(a.ChannelID, b.ChannelID))
	})
	for _, entry := range days {
		result.Daily = append(result.Daily, *entry)
	}
	slices.SortFunc(result.Daily, func(a, b UpstreamDay) int {
		return cmp.Or(cmp.Compare(a.Day, b.Day), cmp.Compare(a.ChannelID, b.ChannelID))
	})
	for _, entry := range hourly {
		result.Hourly = append(result.Hourly, *entry)
	}
	slices.SortFunc(result.Hourly, func(a, b UpstreamHour) int {
		return cmp.Or(cmp.Compare(a.Hour, b.Hour), cmp.Compare(a.ChannelID, b.ChannelID))
	})
	slices.SortFunc(result.Rescues, func(a, b UpstreamRescue) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.From, b.From), cmp.Compare(a.To, b.To))
	})
	if result.Channels == nil {
		result.Channels = []UpstreamChannel{}
	}
	if result.Models == nil {
		result.Models = []UpstreamModel{}
	}
	if result.Daily == nil {
		result.Daily = []UpstreamDay{}
	}
	if result.Rescues == nil {
		result.Rescues = []UpstreamRescue{}
	}
	return result, nil
}

// upstreamQuotaPerUnit is new-api's default when the upstream did not say.
func upstreamQuotaPerUnit(perUnit float64) float64 {
	if perUnit <= 0 {
		return 500000
	}
	return perUnit
}

// topNamedCounts lists the n largest counts, largest first.
func topNamedCounts(counts map[string]int64, n int) []NamedCount {
	list := make([]NamedCount, 0, len(counts))
	for name, count := range counts {
		list = append(list, NamedCount{Name: name, Count: count})
	}
	slices.SortFunc(list, func(a, b NamedCount) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.Name, b.Name))
	})
	if len(list) > n {
		list = list[:n]
	}
	return list
}
