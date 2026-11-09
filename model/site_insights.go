package model

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// The root dashboard reads bounded ranges and aggregates in Go, like the
// top-up report: day and hour arithmetic differs across SQLite, MySQL and
// PostgreSQL, and the ranges are small enough to read.
const (
	// InsightsMaxLogDays bounds the views that read the request logs through
	// hourly rollups (site_insights_hours.go).
	InsightsMaxLogDays = 92
	// InsightsMaxRiskDays bounds the risk view, which groups request logs
	// by address in the database rather than reading them.
	InsightsMaxRiskDays = 92
	// InsightsMaxDays bounds the views that read hourly aggregates, orders
	// and users.
	InsightsMaxDays = 366
	insightsTopN    = 10
)

// InsightsRange is a half-open [Start, End) range in unix seconds. Offset is
// the viewer's offset from UTC in seconds east, so days split at their
// midnight.
type InsightsRange struct {
	Start  int64
	End    int64
	Offset int64
}

// ResolveInsightsRange defaults end to now and start to seven days before
// end, and rejects a span over maxDays.
func ResolveInsightsRange(start, end, offset int64, maxDays int64) (InsightsRange, bool) {
	if end <= 0 {
		end = time.Now().Unix()
	}
	if start <= 0 {
		start = end - 7*86400
	}
	if start >= end || end-start > maxDays*86400 || offset < -14*3600 || offset > 14*3600 {
		return InsightsRange{}, false
	}
	return InsightsRange{Start: start, End: end, Offset: offset}, true
}

func (r InsightsRange) floor(at int64, size int64) int64 {
	local := at + r.Offset
	return local - ((local%size)+size)%size - r.Offset
}

// DayStart returns the start of the viewer's day containing at.
func (r InsightsRange) DayStart(at int64) int64 { return r.floor(at, 86400) }

// HourStart returns the start of the viewer's hour containing at.
func (r InsightsRange) HourStart(at int64) int64 { return r.floor(at, 3600) }

func (r InsightsRange) days() []int64 {
	var days []int64
	for day := r.DayStart(r.Start); day < r.End; day += 86400 {
		days = append(days, day)
	}
	return days
}

// NamedCount is one slice of a breakdown.
type NamedCount struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// UserRef names a user in a dashboard list.
type UserRef struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
}

func sortedCounts(counts map[string]int64) []NamedCount {
	result := make([]NamedCount, 0, len(counts))
	for name, count := range counts {
		result = append(result, NamedCount{Name: name, Count: count})
	}
	slices.SortFunc(result, func(a, b NamedCount) int {
		return cmp.Or(cmp.Compare(b.Count, a.Count), cmp.Compare(a.Name, b.Name))
	})
	return result
}

func quotaUSD(quota int64) float64 {
	return roundTo(float64(quota)/common.QuotaPerUnit, 4)
}

func roundTo(value float64, digits int) float64 {
	parsed, _ := strconv.ParseFloat(strconv.FormatFloat(value, 'f', digits, 64), 64)
	return parsed
}

func ratio(part, whole float64) float64 {
	if whole == 0 {
		return 0
	}
	return roundTo(part/whole, 4)
}

// insightLog is the slice of a request log the dashboard reads.
type insightLog struct {
	UserId           int
	Username         string
	CreatedAt        int64
	Type             int
	Content          string
	ModelName        string
	Quota            int
	PromptTokens     int
	CompletionTokens int
	UseTime          int
	IsStream         bool
	Ip               string
	Other            string
	ChannelId        int
}

// insightQuota is one hourly quota_data row.
type insightQuota struct {
	UserID              int
	Username            string
	ModelName           string
	CreatedAt           int64
	Count               int
	Quota               int
	TokenUsed           int
	CacheReadTokens     int64
	CacheCreationTokens int64
}

func readInsightQuota(start, end int64) ([]insightQuota, error) {
	var rows []insightQuota
	err := DB.Model(&QuotaData{}).
		Select("user_id, username, model_name, created_at, count, quota, token_used, cache_read_tokens, cache_creation_tokens").
		Where("created_at >= ? AND created_at < ?", start, end).Find(&rows).Error
	return rows, err
}

func usernamesByID(ids []int) (map[int]string, error) {
	names := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return names, nil
	}
	var users []struct {
		Id       int
		Username string
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		names[user.Id] = user.Username
	}
	return names, nil
}

// InsightsUser is the name, group and role of a user in a live view.
type InsightsUser struct {
	Username string
	Group    string
	Role     int
}

// InsightsUsers returns the name and group of each id, deleted users
// included.
func InsightsUsers(ids []int) (map[int]InsightsUser, error) {
	users := make(map[int]InsightsUser, len(ids))
	if len(ids) == 0 {
		return users, nil
	}
	var rows []struct {
		Id        int
		Username  string
		UserGroup string
		Role      int
	}
	if err := DB.Model(&User{}).Unscoped().Select("id, username, role, "+commonGroupCol+" AS user_group").
		Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		users[row.Id] = InsightsUser{Username: row.Username, Group: row.UserGroup, Role: row.Role}
	}
	return users, nil
}

// logStatusCode reads the "status_code=NNN" prefix error logs carry.
func logStatusCode(content string) int {
	rest, ok := strings.CutPrefix(content, "status_code=")
	if !ok {
		return 0
	}
	end := strings.IndexFunc(rest, func(r rune) bool { return r < '0' || r > '9' })
	if end < 0 {
		end = len(rest)
	}
	code, _ := strconv.Atoi(rest[:end])
	return code
}

// Error categories of the capacity and quality views.
const (
	ErrorEngineConcurrency = "engine_concurrency"
	ErrorUpstreamRateLimit = "upstream_rate_limit"
	ErrorUpstreamOverload  = "upstream_overloaded"
	ErrorUpstream          = "upstream_error"
	ErrorClient            = "client_error"
	ErrorOther             = "other"
)

// classifyErrorLog sorts an error log by where the request was turned away.
// The engine's own admission rejection is told apart from Claude's rate
// limit by its message, because both answer 429.
func classifyErrorLog(content string) string {
	code := logStatusCode(content)
	switch {
	case strings.Contains(content, "Credential concurrency limit exceeded"):
		return ErrorEngineConcurrency
	case code == 429:
		return ErrorUpstreamRateLimit
	case code == 529 || strings.Contains(strings.ToLower(content), "overloaded"):
		return ErrorUpstreamOverload
	case code >= 500:
		return ErrorUpstream
	case code >= 400:
		return ErrorClient
	default:
		return ErrorOther
	}
}

// paidOrders returns successful gateway orders in [start, end) with whether
// each is a subscription purchase. Wallet-paid orders are excluded, as in the
// top-up report, because the wallet top-up already counted that money.
type paidOrder struct {
	UserId        int
	Money         float64
	Amount        int64
	BonusQuota    int64
	PaymentMethod string
	TradeNo       string
	CreateTime    int64
	Subscription  bool
}

func readPaidOrders(start, end int64) ([]paidOrder, error) {
	query := DB.Model(&TopUp{}).Select("user_id, money, amount, bonus_quota, payment_method, trade_no, create_time").
		Where("status = ? AND (payment_provider IS NULL OR payment_provider <> ?)", common.TopUpStatusSuccess, PaymentProviderBalance)
	if start > 0 {
		query = query.Where("create_time >= ?", start)
	}
	if end > 0 {
		query = query.Where("create_time < ?", end)
	}
	var orders []paidOrder
	if err := query.Find(&orders).Error; err != nil {
		return nil, err
	}
	var subscriptionTradeNos []string
	subQuery := DB.Model(&SubscriptionOrder{}).Where("status = ?", common.TopUpStatusSuccess)
	if start > 0 {
		subQuery = subQuery.Where("create_time >= ?", start)
	}
	if end > 0 {
		subQuery = subQuery.Where("create_time < ?", end)
	}
	if err := subQuery.Pluck("trade_no", &subscriptionTradeNos).Error; err != nil {
		return nil, err
	}
	subscriptions := make(map[string]struct{}, len(subscriptionTradeNos))
	for _, tradeNo := range subscriptionTradeNos {
		subscriptions[tradeNo] = struct{}{}
	}
	for i := range orders {
		_, orders[i].Subscription = subscriptions[orders[i].TradeNo]
	}
	return orders, nil
}
