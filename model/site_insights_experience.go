package model

import (
	"cmp"
	"slices"
	"strings"
	"time"
)

// The experience view names the money customers spent on requests that gave
// them nothing, and the reports and replies that followed. It is read-only.
//
// Money wasted, all of it quota dollars at list price from the consume logs of
// customers (staff are left out):
//
//   - refusal: the upstream refused the request under its usage policy
//     (other.upstream_refusal) and it was charged for its input and cache writes.
//   - failed_billed: the stream ended abnormally (stream_status.end_reason
//     timeout, scanner_error, panic or ping_fail) and the request was still
//     charged. A client that hung up (client_gone) is not a failure of ours.
//   - gate_wallet: the newcomer plan's address gate moved the request onto the
//     wallet (admin_info.limited_plan_ip_gate = wallet). The customer paid cash
//     for a request their plan would have covered. This view counts it from
//     the customer's side; the risk tab counts what the gate saved.
//   - cache_1h: the extra a one-hour cache write cost over a five-minute one
//     when nothing of that customer's key was requested in the hour after it.
//     It is an estimate with a stated lower bound: a later request of the same
//     key is taken to have read the cache, though it may not have.
//
// A request is counted once, under the first kind above that fits; the cache
// premium is added only to requests no other kind took. Task refunds
// (type 6, a failed image or video task) are counted apart, since the money
// went back.
//
// The request logs carry these markers inside other, which no index reaches,
// so they are found by a LIKE that reads every row of its range: a quarter of
// a second an hour on production, a minute for a day. An earlier version
// scanned at request time (paging by id, which sent the planner down the
// primary key of the whole table) and took 45 seconds. The events are now
// stored by the hour (site_insights_experience_hours.go); this view reads the
// stored hours and works out only the tail that is not final yet.
const (
	// experienceEventWindow and experienceCacheWindow are the spans one query
	// reads; a cache window is shorter because many more rows match.
	experienceEventWindow = 3600
	experienceCacheWindow = 900
	// A one-hour write that nothing was requested after within this long is unread.
	experienceCacheReuseSeconds = 3600
	// experienceLogRows bounds the rows one scan parses.
	experienceLogRows = 250_000
	// experienceCacheUsersPerRead is how many writers one read of their requests names.
	experienceCacheUsersPerRead = 500
	// experienceUsersListed is how many customers the table names, and
	// experienceUsersChecked how many of the most wasteful are checked for a
	// report and for silence.
	experienceUsersListed  = 20
	experienceUsersChecked = 50
	experienceRefusalsKept = 50
	experienceWaitingKept  = 10
	experienceTitleRunes   = 80
	// experienceSilentDays: a customer with no request this long is silent.
	experienceSilentDays = 3
	// experienceFollowDays is how long after a report its sender is watched.
	experienceFollowDays = 7
	// experienceWaitingSeconds is how long a report may wait for a first reply.
	experienceWaitingSeconds = 24 * 3600
)

// The kinds of wasted money.
const (
	WasteRefusal      = "refusal"
	WasteFailedBilled = "failed_billed"
	WasteGateWallet   = "gate_wallet"
	WasteCache1h      = "cache_1h"
)

// ExperiencePoint is one day's (or hour's) wasted money by kind in quota
// dollars, the task refunds beside it, and the reports filed by category.
type ExperiencePoint struct {
	At            int64   `json:"at"`
	RefusalUSD    float64 `json:"refusal_usd"`
	FailedUSD     float64 `json:"failed_usd"`
	GateUSD       float64 `json:"gate_usd"`
	CacheUSD      float64 `json:"cache_usd"`
	RefundUSD     float64 `json:"refund_usd"`
	Refusals      int64   `json:"refusals"`
	Bug           int64   `json:"bug"`
	Suggestion    int64   `json:"suggestion"`
	Billing       int64   `json:"billing"`
	OtherFeedback int64   `json:"other_feedback"`
}

// ExperienceKind totals one kind of waste: the requests (writes, for the
// cache), the customers they belong to, and the money.
type ExperienceKind struct {
	Kind     string  `json:"kind"`
	Requests int64   `json:"requests"`
	Users    int64   `json:"users"`
	USD      float64 `json:"usd"`
}

// ExperienceRefusal is one refused request that was charged.
type ExperienceRefusal struct {
	UserRef
	At        int64   `json:"at"`
	ModelName string  `json:"model_name"`
	Category  string  `json:"category"`
	USD       float64 `json:"usd"`
	RequestID string  `json:"request_id"`
}

// ExperienceGroup is a breakdown row: requests, customers and money.
type ExperienceGroup struct {
	Name     string  `json:"name"`
	Requests int64   `json:"requests"`
	Users    int64   `json:"users"`
	USD      float64 `json:"usd"`
}

// ExperienceUser is a customer's wasted money by kind. FiledFeedback says
// whether the account has ever filed a report; LastRequestAt is its last
// request hour within thirty days (0 when none), and Silent that it has had no
// request in the last experienceSilentDays.
type ExperienceUser struct {
	UserRef
	RefusalUSD    float64 `json:"refusal_usd"`
	FailedUSD     float64 `json:"failed_usd"`
	GateUSD       float64 `json:"gate_usd"`
	CacheUSD      float64 `json:"cache_usd"`
	TotalUSD      float64 `json:"total_usd"`
	Requests      int64   `json:"requests"`
	FiledFeedback bool    `json:"filed_feedback"`
	LastRequestAt int64   `json:"last_request_at"`
	Silent        bool    `json:"silent"`
}

// ExperienceWaste is the money customers spent for nothing. LogStart and
// CacheStart are where the logs read for the kinds begin (the range's start
// unless the range is longer than the view reads); CacheJudgedUntil is the
// last write the cache estimate could judge, the hour after it still open.
// ConsumedUSD is the customers' consumption over [LogStart, End), the whole
// the shares are of. Truncated says a scan hit its row bound. Unpriced counts
// one-hour writes whose log lacks the ratios to price them.
type ExperienceWaste struct {
	LogStart         int64               `json:"log_start"`
	CacheStart       int64               `json:"cache_start"`
	CacheJudgedUntil int64               `json:"cache_judged_until"`
	ConsumedUSD      float64             `json:"consumed_usd"`
	TotalUSD         float64             `json:"total_usd"`
	Truncated        bool                `json:"truncated"`
	Unpriced         int64               `json:"unpriced"`
	Kinds            []ExperienceKind    `json:"kinds"`
	Refusals         []ExperienceRefusal `json:"refusals"`
	RefusalModels    []ExperienceGroup   `json:"refusal_models"`
	RefusalReasons   []ExperienceGroup   `json:"refusal_reasons"`
	Refunds          ExperienceKind      `json:"refunds"`
	RefundModels     []ExperienceGroup   `json:"refund_models"`
	Top              []ExperienceUser    `json:"top"`
	Silent           []ExperienceUser    `json:"silent"`
	ReportedTop      int64               `json:"reported_top"`
	CheckedTop       int64               `json:"checked_top"`
}

// ExperienceWaiting is a report still waiting for its first reply.
type ExperienceWaiting struct {
	UserRef
	ID          int    `json:"id"`
	Category    string `json:"category"`
	Title       string `json:"title"`
	CreatedTime int64  `json:"created_time"`
}

// ExperienceLapsed is a customer who filed a report and made no request in the
// week after it.
type ExperienceLapsed struct {
	UserRef
	Category  string  `json:"category"`
	At        int64   `json:"at"`
	BeforeUSD float64 `json:"before_usd"`
}

// ExperienceFeedback is the reports filed in the range. Statuses counts them
// by where they stand now; FirstReplyP50 and FirstReplyP90 are seconds from a
// report to the first administrator change to it (Replied counts those with
// one). Open and Unanswered24h read the whole table at the range's end:
// reports still pending or processing, and reports nobody has touched that are
// older than a day. Rewarded counts the reports that paid a reward, RewardUSD
// their quota. The last block follows each sender for a week: Judged are the
// senders whose week is over, Active those who sent a request in it, and
// BeforeUSD and AfterUSD what they spent in the week before and after their
// first report; Pending are senders whose week is not over yet.
type ExperienceFeedback struct {
	Total         int64               `json:"total"`
	Statuses      []NamedCount        `json:"statuses"`
	Categories    []NamedCount        `json:"categories"`
	Replied       int64               `json:"replied"`
	FirstReplyP50 int64               `json:"first_reply_p50"`
	FirstReplyP90 int64               `json:"first_reply_p90"`
	Open          int64               `json:"open"`
	Unanswered24h int64               `json:"unanswered_24h"`
	Rewarded      int64               `json:"rewarded"`
	RewardUSD     float64             `json:"reward_usd"`
	Senders       int64               `json:"senders"`
	Judged        int64               `json:"judged"`
	Active        int64               `json:"active"`
	Pending       int64               `json:"pending"`
	BeforeUSD     float64             `json:"before_usd"`
	AfterUSD      float64             `json:"after_usd"`
	Waiting       []ExperienceWaiting `json:"waiting"`
	Lapsed        []ExperienceLapsed  `json:"lapsed"`
}

// ExperienceInsights is the experience view. SeriesUnit says whether Series
// has a point per day or per hour, as the other views' series do.
type ExperienceInsights struct {
	SeriesUnit string             `json:"series_unit"`
	Series     []ExperiencePoint  `json:"series"`
	Waste      ExperienceWaste    `json:"waste"`
	Feedback   ExperienceFeedback `json:"feedback"`
}

// experienceOther is the part of a log's other column this view reads.
type experienceOther struct {
	UpstreamRefusal         bool    `json:"upstream_refusal"`
	UpstreamRefusalCategory string  `json:"upstream_refusal_category"`
	ModelRatio              float64 `json:"model_ratio"`
	GroupRatio              float64 `json:"group_ratio"`
	CacheCreationRatio      float64 `json:"cache_creation_ratio"`
	CacheCreationRatio5m    float64 `json:"cache_creation_ratio_5m"`
	CacheCreationRatio1h    float64 `json:"cache_creation_ratio_1h"`
	CacheCreationTokens1h   int64   `json:"cache_creation_tokens_1h"`
	IsTask                  bool    `json:"is_task"`
	TaskId                  string  `json:"task_id"`
	PreConsumedQuota        *int64  `json:"pre_consumed_quota"`
	StreamStatus            struct {
		EndReason string `json:"end_reason"`
	} `json:"stream_status"`
	AdminInfo struct {
		LimitedPlanIPGate string `json:"limited_plan_ip_gate"`
	} `json:"admin_info"`
}

// experienceAbnormalEnds are the stream end reasons that are the service's
// failure; done, eof, handler_stop and client_gone are not.
var experienceAbnormalEnds = []string{"timeout", "scanner_error", "panic", "ping_fail"}

// experienceEventMarkers are the LIKE patterns a log must match for the
// refusal, failed and gate kinds. Their JSON is compact and key order does not
// matter to the match.
var experienceEventMarkers = []string{
	`%"upstream_refusal":true%`,
	`%"limited_plan_ip_gate":"wallet"%`,
	`%"end_reason":"timeout"%`,
	`%"end_reason":"scanner_error"%`,
	`%"end_reason":"panic"%`,
	`%"end_reason":"ping_fail"%`,
}

const experienceCacheMarker = `%"cache_creation_tokens_1h":%`

type experienceLog struct {
	Id        int
	UserId    int
	TokenId   int
	CreatedAt int64
	ModelName string
	Quota     int
	RequestId string
	Other     string
}

// experienceWasteTally collects one scan's money by user and kind.
type experienceWasteTally struct {
	byUser map[int]*ExperienceUser
	kinds  map[string]*ExperienceKind
	users  map[string]map[int]bool
}

func newExperienceWasteTally() *experienceWasteTally {
	tally := &experienceWasteTally{
		byUser: make(map[int]*ExperienceUser),
		kinds:  make(map[string]*ExperienceKind),
		users:  make(map[string]map[int]bool),
	}
	for _, kind := range []string{WasteRefusal, WasteFailedBilled, WasteGateWallet, WasteCache1h} {
		tally.kinds[kind] = &ExperienceKind{Kind: kind}
		tally.users[kind] = make(map[int]bool)
	}
	return tally
}

func (tally *experienceWasteTally) add(kind string, userID int, quota float64) {
	entry := tally.byUser[userID]
	if entry == nil {
		entry = &ExperienceUser{UserRef: UserRef{UserID: userID}}
		tally.byUser[userID] = entry
	}
	switch kind {
	case WasteRefusal:
		entry.RefusalUSD += quota
	case WasteFailedBilled:
		entry.FailedUSD += quota
	case WasteGateWallet:
		entry.GateUSD += quota
	case WasteCache1h:
		entry.CacheUSD += quota
	}
	entry.Requests++
	tally.kinds[kind].Requests++
	tally.kinds[kind].USD += quota
	tally.users[kind][userID] = true
}

// scanExperienceLogs reads the consume logs in [start, end) that match any of
// the LIKE patterns, one window at a time from the newest, and hands each to
// visit. It stops at the budget or at the row bound and returns the start of
// the oldest window it read in full (end when it read none); truncated says
// the row bound, not the budget, cut it. The first window is always read.
func scanExperienceLogs(start, end, window int64, patterns []string, budget time.Duration, visit func(experienceLog)) (covered int64, truncated bool, err error) {
	conditions := make([]string, len(patterns))
	args := make([]any, 0, len(patterns)+3)
	args = append(args, LogTypeConsume, 0, 0)
	for i, pattern := range patterns {
		conditions[i] = "other LIKE ?"
		args = append(args, pattern)
	}
	where := "type = ? AND created_at >= ? AND created_at < ? AND (" + strings.Join(conditions, " OR ") + ")"
	deadline := time.Now().Add(budget)
	covered = end
	seen := 0
	for hi := end; hi > start; hi -= window {
		if covered < end && time.Now().After(deadline) {
			return covered, false, nil
		}
		lo := max(start, hi-window)
		args[1], args[2] = lo, hi
		var page []experienceLog
		if err := LOG_DB.Model(&Log{}).
			Select("id, user_id, token_id, created_at, model_name, quota, request_id, other").
			Where(where, args...).Find(&page).Error; err != nil {
			return covered, false, err
		}
		for _, row := range page {
			visit(row)
		}
		covered = lo
		seen += len(page)
		if seen >= experienceLogRows && lo > start {
			return covered, true, nil
		}
	}
	return covered, false, nil
}

func GetExperienceInsights(r InsightsRange) (*ExperienceInsights, error) {
	return experienceInsightsAt(r, time.Now().Unix())
}

// experienceInsightsAt reads the view as of now, which decides which hours are final.
func experienceInsightsAt(r InsightsRange, now int64) (*ExperienceInsights, error) {
	staffIDs, err := StaffUserIDs()
	if err != nil {
		return nil, err
	}
	staff := make(map[int]bool, len(staffIDs))
	for _, id := range staffIDs {
		staff[id] = true
	}

	result := &ExperienceInsights{SeriesUnit: "day"}
	var starts []int64
	if hours := r.hourStarts(); hours != nil {
		result.SeriesUnit = "hour"
		starts = hours
	} else {
		starts = r.days()
	}
	index := make(map[int64]int, len(starts))
	result.Series = make([]ExperiencePoint, len(starts))
	for i, at := range starts {
		result.Series[i].At = at
		index[at] = i
	}
	point := func(at int64) *ExperiencePoint {
		key := r.DayStart(at)
		if result.SeriesUnit == "hour" {
			key = insightHourKey(at)
		}
		if i, ok := index[key]; ok {
			return &result.Series[i]
		}
		return nil
	}

	waste := &result.Waste
	events, covered, truncated, err := readExperienceEvents(r, now, staff)
	if err != nil {
		return nil, err
	}
	// What the stored hours do not reach is not read: say where the figures begin.
	waste.LogStart, waste.CacheStart = covered, covered
	waste.CacheJudgedUntil = r.End - experienceCacheReuseSeconds
	waste.Truncated = truncated
	tally := newExperienceWasteTally()
	refusalModels, refusalReasons := newExperienceBreakdown(), newExperienceBreakdown()
	refundModels := newExperienceBreakdown()
	refundUsers := make(map[int]bool)
	refunds := ExperienceKind{Kind: experienceKindRefund}
	for _, event := range events {
		p := point(event.EventAt)
		switch event.Kind {
		case experienceKindCacheUnpriced:
			waste.Unpriced++
		case experienceKindRefund:
			refunds.Requests++
			refunds.USD += event.Usd
			refundUsers[event.UserId] = true
			refundModels.add(event.ModelName, event.UserId, event.Usd)
			if p != nil {
				p.RefundUSD += event.Usd
			}
		case WasteRefusal, WasteFailedBilled, WasteGateWallet, WasteCache1h:
			tally.add(event.Kind, event.UserId, event.Usd)
			if p != nil {
				switch event.Kind {
				case WasteRefusal:
					p.RefusalUSD += event.Usd
					p.Refusals++
				case WasteFailedBilled:
					p.FailedUSD += event.Usd
				case WasteGateWallet:
					p.GateUSD += event.Usd
				case WasteCache1h:
					p.CacheUSD += event.Usd
				}
			}
			if event.Kind == WasteRefusal {
				refusalModels.add(event.ModelName, event.UserId, event.Usd)
				refusalReasons.add(event.Category, event.UserId, event.Usd)
				waste.Refusals = append(waste.Refusals, ExperienceRefusal{
					UserRef: UserRef{UserID: event.UserId}, At: event.EventAt, ModelName: event.ModelName,
					Category: event.Category, USD: event.Usd, RequestID: event.RequestId,
				})
			}
		}
	}
	refunds.Users = int64(len(refundUsers))
	refunds.USD = roundTo(refunds.USD, 4)
	waste.Refunds = refunds
	waste.RefundModels = refundModels.ranked()

	if err := fillExperienceConsumption(waste, r, staffIDs); err != nil {
		return nil, err
	}
	if err := fillExperienceUsers(r, tally, waste); err != nil {
		return nil, err
	}

	for _, kind := range []string{WasteRefusal, WasteFailedBilled, WasteGateWallet, WasteCache1h} {
		entry := tally.kinds[kind]
		entry.Users = int64(len(tally.users[kind]))
		entry.USD = roundTo(entry.USD, 4)
		waste.Kinds = append(waste.Kinds, *entry)
		waste.TotalUSD += entry.USD
	}
	waste.TotalUSD = roundTo(waste.TotalUSD, 4)
	for i := range result.Series {
		p := &result.Series[i]
		p.RefusalUSD, p.FailedUSD, p.GateUSD = roundTo(p.RefusalUSD, 4), roundTo(p.FailedUSD, 4), roundTo(p.GateUSD, 4)
		p.CacheUSD, p.RefundUSD = roundTo(p.CacheUSD, 4), roundTo(p.RefundUSD, 4)
	}

	waste.RefusalModels = refusalModels.ranked()
	waste.RefusalReasons = refusalReasons.ranked()
	slices.SortFunc(waste.Refusals, func(a, b ExperienceRefusal) int {
		return cmp.Or(cmp.Compare(b.USD, a.USD), cmp.Compare(b.At, a.At))
	})
	if len(waste.Refusals) > experienceRefusalsKept {
		waste.Refusals = waste.Refusals[:experienceRefusalsKept]
	}
	names, err := usernamesByID(refusalUserIDs(waste.Refusals))
	if err != nil {
		return nil, err
	}
	for i := range waste.Refusals {
		waste.Refusals[i].Username = names[waste.Refusals[i].UserID]
	}

	if err := fillExperienceFeedback(r, staff, point, result); err != nil {
		return nil, err
	}
	return result, nil
}

// experienceBreakdown groups requests by a name, counting each customer once
// per name.
type experienceBreakdown struct {
	groups map[string]*ExperienceGroup
	users  map[string]map[int]bool
}

func newExperienceBreakdown() *experienceBreakdown {
	return &experienceBreakdown{groups: make(map[string]*ExperienceGroup), users: make(map[string]map[int]bool)}
}

func (b *experienceBreakdown) add(name string, userID int, usd float64) {
	entry := b.groups[name]
	if entry == nil {
		entry = &ExperienceGroup{Name: name}
		b.groups[name] = entry
		b.users[name] = make(map[int]bool)
	}
	entry.Requests++
	entry.USD += usd
	if !b.users[name][userID] {
		b.users[name][userID] = true
		entry.Users++
	}
}

// ranked lists the groups, most money first.
func (b *experienceBreakdown) ranked() []ExperienceGroup {
	rows := make([]ExperienceGroup, 0, len(b.groups))
	for _, entry := range b.groups {
		entry.USD = roundTo(entry.USD, 4)
		rows = append(rows, *entry)
	}
	slices.SortFunc(rows, func(a, b ExperienceGroup) int {
		return cmp.Or(cmp.Compare(b.USD, a.USD), cmp.Compare(a.Name, b.Name))
	})
	return rows
}

func refusalUserIDs(rows []ExperienceRefusal) []int {
	ids := make([]int, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.UserID)
	}
	return ids
}
