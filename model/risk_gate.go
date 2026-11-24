package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Risk gate stages, in the order a request passes them.
const (
	RiskGateStageDistill      = "distill"
	RiskGateStageHardRegex    = "hard_regex"
	RiskGateStageRefusalCache = "refusal_cache"
	RiskGateStageDecision     = "decision"
)

// Risk gate event actions.
const (
	RiskGateActionBlocked  = "blocked"   // the request was rejected
	RiskGateActionObserved = "observed"  // observe mode: it would have been rejected
	RiskGateActionFailOpen = "fail_open" // a stage failed and the request passed
)

// RiskGateEvent is one request a risk gate stage stopped, would have stopped
// in observe mode, or let through because the decision model failed.
type RiskGateEvent struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null;index"`
	Stage     string `json:"stage" gorm:"type:varchar(16);not null"`
	Rule      string `json:"rule" gorm:"column:rule_name;type:varchar(64)"`
	Action    string `json:"action" gorm:"type:varchar(16);not null"`
	// Detail is what the stage measured, such as a similarity or a model
	// score, or why the decision model failed.
	Detail    string `json:"detail" gorm:"type:varchar(255)"`
	UserId    int    `json:"user_id" gorm:"index"`
	TokenId   int    `json:"token_id"`
	ModelName string `json:"model_name" gorm:"type:varchar(255)"`
	RequestId string `json:"request_id" gorm:"type:varchar(64)"`
	// Excerpt is the latest human message, truncated, for an administrator to
	// judge a false positive.
	Excerpt string `json:"excerpt" gorm:"type:text"`
}

// RiskGateHourlyCount counts what entered the gate in one hour, so the funnel
// has a denominator. Hour is the Unix time the hour starts.
type RiskGateHourlyCount struct {
	Hour             int64 `json:"hour" gorm:"column:hour_start;primaryKey;autoIncrement:false"`
	Inbound          int64 `json:"inbound" gorm:"bigint;not null;default:0"`
	DecisionCalls    int64 `json:"decision_calls" gorm:"bigint;not null;default:0"`
	DecisionFailures int64 `json:"decision_failures" gorm:"bigint;not null;default:0"`
}

// RiskCustomerHourlyCount counts one customer's Claude requests in one hour
// by client and shape, so an operator can see harvesting that no single
// request shows: many bare requests from a client that is not Claude Code.
type RiskCustomerHourlyCount struct {
	UserId int   `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Hour   int64 `json:"hour" gorm:"column:hour_start;primaryKey;autoIncrement:false;index"`
	// Requests is every Claude request of the customer that entered the gate.
	Requests int64 `json:"requests" gorm:"bigint;not null;default:0"`
	// OtherClient is the requests not recognized as official Claude Code.
	OtherClient int64 `json:"other_client" gorm:"bigint;not null;default:0"`
	// Bare is the requests with one message besides system prompts and no
	// tools. Claude Code's own side requests have this shape too.
	Bare int64 `json:"bare" gorm:"bigint;not null;default:0"`
	// BareOtherClient is the bare requests not from official Claude Code.
	BareOtherClient int64 `json:"bare_other_client" gorm:"bigint;not null;default:0"`
}

// AddRiskCustomerCounts adds requests, other client, bare and bare other
// client counts to one customer's hour. Two servers run during a release, so
// the row is created if missing and incremented in the database.
func AddRiskCustomerCounts(userId int, hour int64, counts [4]int64) error {
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&RiskCustomerHourlyCount{UserId: userId, Hour: hour}).Error; err != nil {
		return err
	}
	return DB.Model(&RiskCustomerHourlyCount{}).Where("user_id = ? AND hour_start = ?", userId, hour).Updates(map[string]any{
		"requests":          gorm.Expr("requests + ?", counts[0]),
		"other_client":      gorm.Expr("other_client + ?", counts[1]),
		"bare":              gorm.Expr("bare + ?", counts[2]),
		"bare_other_client": gorm.Expr("bare_other_client + ?", counts[3]),
	}).Error
}

// DeleteRiskCustomerCountsBefore removes customer hours that start before before.
func DeleteRiskCustomerCountsBefore(before int64) error {
	return DB.Where("hour_start < ?", before).Delete(&RiskCustomerHourlyCount{}).Error
}

func CreateRiskGateEvent(event *RiskGateEvent) error {
	return DB.Create(event).Error
}

// DeleteRiskGateEventsBefore removes events older than before.
func DeleteRiskGateEventsBefore(before int64) error {
	return DB.Where("created_at < ?", before).Delete(&RiskGateEvent{}).Error
}

// AddRiskGateCounts adds to one hour's counters. Two servers run during a
// release, so the row is created if missing and incremented in the database.
func AddRiskGateCounts(hour, inbound, decisionCalls, decisionFailures int64) error {
	if err := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&RiskGateHourlyCount{Hour: hour}).Error; err != nil {
		return err
	}
	return DB.Model(&RiskGateHourlyCount{}).Where("hour_start = ?", hour).Updates(map[string]any{
		"inbound":           gorm.Expr("inbound + ?", inbound),
		"decision_calls":    gorm.Expr("decision_calls + ?", decisionCalls),
		"decision_failures": gorm.Expr("decision_failures + ?", decisionFailures),
	}).Error
}

// withoutStaffRows drops the rows of administrators and root from a query on a
// table with a user id column. Their requests no longer pass risk control, but
// rows recorded earlier stay in the database. Rows with no user are kept, and
// deleted accounts count as well, so the subquery is unscoped.
func withoutStaffRows(query *gorm.DB, column string) *gorm.DB {
	staff := DB.Unscoped().Model(&User{}).Select("id").Where("role >= ?", common.RoleAdminUser)
	return query.Where("("+column+" IS NULL OR "+column+" NOT IN (?))", staff)
}

type RiskGateStageCount struct {
	Stage  string `json:"stage"`
	Action string `json:"action"`
	Count  int64  `json:"count"`
}

type RiskGateHitCount struct {
	Stage string `json:"stage"`
	Rule  string `json:"rule" gorm:"column:rule_name"`
	Count int64  `json:"count"`
}

type RiskGateSummary struct {
	Inbound          int64                `json:"inbound"`
	DecisionCalls    int64                `json:"decision_calls"`
	DecisionFailures int64                `json:"decision_failures"`
	Stages           []RiskGateStageCount `json:"stages"`
	Hits             []RiskGateHitCount   `json:"hits"`
}

// GetRiskGateSummary counts the gate's traffic and events in [start, end).
// Events of administrators and root are left out; the hourly request counts
// are not per user, so they include what administrators sent before the gate
// began to skip them.
func GetRiskGateSummary(start, end int64) (RiskGateSummary, error) {
	summary := RiskGateSummary{Stages: []RiskGateStageCount{}, Hits: []RiskGateHitCount{}}
	var counts struct {
		Inbound          int64
		DecisionCalls    int64
		DecisionFailures int64
	}
	err := DB.Model(&RiskGateHourlyCount{}).
		Select("COALESCE(SUM(inbound), 0) AS inbound, COALESCE(SUM(decision_calls), 0) AS decision_calls, COALESCE(SUM(decision_failures), 0) AS decision_failures").
		Where("hour_start >= ? AND hour_start < ?", start-start%3600, end).
		Scan(&counts).Error
	if err != nil {
		return summary, err
	}
	summary.Inbound, summary.DecisionCalls, summary.DecisionFailures = counts.Inbound, counts.DecisionCalls, counts.DecisionFailures
	events := withoutStaffRows(DB.Model(&RiskGateEvent{}).Where("created_at >= ? AND created_at < ?", start, end), "user_id")
	if err := events.Session(&gorm.Session{}).Select("stage, action, COUNT(*) AS count").Group("stage, action").Scan(&summary.Stages).Error; err != nil {
		return summary, err
	}
	err = events.Session(&gorm.Session{}).Select("stage, rule_name, COUNT(*) AS count").
		Where("action <> ?", RiskGateActionFailOpen).
		Group("stage, rule_name").Order("count desc").Limit(20).Scan(&summary.Hits).Error
	return summary, err
}

type RiskGateEventView struct {
	RiskGateEvent
	Username string `json:"username"`
}

// ListRiskGateEvents returns events in [start, end) newest first, optionally
// for one stage, with each user's name. Events of administrators and root are
// left out.
func ListRiskGateEvents(pageInfo *common.PageInfo, start, end int64, stage string) ([]RiskGateEventView, int64, error) {
	query := withoutStaffRows(DB.Model(&RiskGateEvent{}).Where("created_at >= ? AND created_at < ?", start, end), "user_id")
	if stage != "" {
		query = query.Where("stage = ?", stage)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var events []RiskGateEvent
	if err := query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&events).Error; err != nil {
		return nil, 0, err
	}
	if len(events) == 0 {
		return []RiskGateEventView{}, total, nil
	}
	userIds := make([]int, 0, len(events))
	for _, event := range events {
		userIds = append(userIds, event.UserId)
	}
	var users []User
	if err := DB.Unscoped().Select("id", "username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	usernames := make(map[int]string, len(users))
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	views := make([]RiskGateEventView, 0, len(events))
	for _, event := range events {
		views = append(views, RiskGateEventView{RiskGateEvent: event, Username: usernames[event.UserId]})
	}
	return views, total, nil
}
