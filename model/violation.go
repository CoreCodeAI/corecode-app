package model

import (
	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Violation record actions: what the guard decided about one refusal.
const (
	ViolationActionMerged  = "merged"  // part of a strike already counted
	ViolationActionStrike  = "strike"  // counted, nothing restricted
	ViolationActionSuspend = "suspend" // counted, relay access suspended
	ViolationActionBan     = "ban"     // counted, account disabled
	ViolationActionWarn    = "warn"    // lenient incident within the warnings allowed, not counted
	// ViolationActionClientCheck is a lenient refusal of a request the client
	// sent on its own, such as Claude Code's auto mode check: not counted.
	ViolationActionClientCheck = "client_check"
)

// ViolationModeExempt marks a refusal by an administrator, which is recorded
// but never restricts the account.
const ViolationModeExempt = "exempt"

var violationStrikeActions = []string{ViolationActionStrike, ViolationActionSuspend, ViolationActionBan}

// violationIncidentActions are the actions that start an incident: a strike
// or a warning. Later refusals of the same conversation merge into it.
var violationIncidentActions = append([]string{ViolationActionWarn}, violationStrikeActions...)

// ViolationRecord is one upstream usage-policy refusal of a customer request
// and what the violation guard decided about it. Mode is the guard mode at the
// time; in observe mode Action is what enforce mode would have done.
type ViolationRecord struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	UserId    int    `json:"user_id" gorm:"not null;index:idx_violation_records_user_created,priority:1"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;not null;index:idx_violation_records_user_created,priority:2"`
	TokenId   int    `json:"token_id"`
	ChannelId int    `json:"channel_id"`
	ModelName string `json:"model_name" gorm:"type:varchar(255)"`
	RequestId string `json:"request_id" gorm:"type:varchar(64)"`
	Category  string `json:"category" gorm:"type:varchar(64)"`
	// ConversationKey fingerprints the human messages up to the refused one,
	// so a later request that resends them can be recognized. Empty when the
	// request had no human text.
	ConversationKey string `json:"-" gorm:"type:varchar(64)"`
	// Excerpt is the refused human message, truncated, for administrators to
	// review. It is cleared once the record leaves the strike window.
	Excerpt string `json:"excerpt" gorm:"type:text"`
	Action  string `json:"action" gorm:"type:varchar(16);not null"`
	Mode    string `json:"mode" gorm:"type:varchar(16);not null"`
}

// UserViolationState is the per-user row that serializes strikes and holds
// the suspension. LastStrikeMode is the guard mode of the last strike, so a
// strike in one mode never merges with one in another. Strikes and refused
// conversations recorded at or before ForgivenAt no longer count.
type UserViolationState struct {
	UserId         int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	LastStrikeAt   int64  `json:"last_strike_at" gorm:"bigint;not null;default:0"`
	LastStrikeMode string `json:"last_strike_mode" gorm:"type:varchar(16)"`
	SuspendedUntil int64  `json:"suspended_until" gorm:"bigint;not null;default:0"`
	ForgivenAt     int64  `json:"forgiven_at" gorm:"bigint;not null;default:0"`
}

func ensureUserViolationState(db *gorm.DB, userId int) error {
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&UserViolationState{UserId: userId}).Error
}

func GetUserViolationState(userId int) (UserViolationState, error) {
	state := UserViolationState{UserId: userId}
	err := DB.Where("user_id = ?", userId).Limit(1).Find(&state).Error
	return state, err
}

// ClaimViolationStrike reports whether a refusal at now in mode starts a new
// strike. It moves LastStrikeAt to now only when the previous strike is older
// than mergeAfter or was in another mode, so concurrent refusals from one
// incident claim one strike.
func ClaimViolationStrike(userId int, mode string, now, mergeAfter int64) (bool, error) {
	if err := ensureUserViolationState(DB, userId); err != nil {
		return false, err
	}
	result := DB.Model(&UserViolationState{}).
		Where("user_id = ? AND (last_strike_at <= ? OR last_strike_mode IS NULL OR last_strike_mode <> ?)", userId, mergeAfter, mode).
		Updates(map[string]any{"last_strike_at": now, "last_strike_mode": mode})
	return result.RowsAffected == 1, result.Error
}

// CountViolationStrikes counts the user's strikes in mode recorded after since.
func CountViolationStrikes(userId int, mode string, since int64) (int64, error) {
	var count int64
	err := DB.Model(&ViolationRecord{}).
		Where("user_id = ? AND mode = ? AND created_at > ? AND action IN ?", userId, mode, since, violationStrikeActions).
		Count(&count).Error
	return count, err
}

// HasViolationStrikeInConversation reports whether a strike or a warning in
// mode after since was already recorded for the same conversation.
func HasViolationStrikeInConversation(userId int, mode string, conversationKey string, since int64) (bool, error) {
	var count int64
	err := DB.Model(&ViolationRecord{}).
		Where("user_id = ? AND mode = ? AND conversation_key = ? AND created_at > ? AND action IN ?", userId, mode, conversationKey, since, violationIncidentActions).
		Count(&count).Error
	return count > 0, err
}

// CountViolationIncidents counts the incidents of category, warnings and
// strikes, that the user started in mode after since.
func CountViolationIncidents(userId int, mode string, category string, since int64) (int64, error) {
	var count int64
	err := DB.Model(&ViolationRecord{}).
		Where("user_id = ? AND mode = ? AND category = ? AND created_at > ? AND action IN ?", userId, mode, category, since, violationIncidentActions).
		Count(&count).Error
	return count, err
}

// ShortenViolationMerge moves the start of the user's last incident from
// claimedAt back to mergeFrom, so that the incident's merge period ends
// earlier. It changes nothing once another incident has been claimed.
func ShortenViolationMerge(userId int, claimedAt, mergeFrom int64) error {
	return DB.Model(&UserViolationState{}).
		Where("user_id = ? AND last_strike_at = ?", userId, claimedAt).
		Update("last_strike_at", mergeFrom).Error
}

func CreateViolationRecord(record *ViolationRecord) error {
	return DB.Create(record).Error
}

// ClearViolationExcerpts empties the refused messages of records created at
// or before before.
func ClearViolationExcerpts(before int64) error {
	return DB.Model(&ViolationRecord{}).Where("created_at <= ? AND excerpt <> ''", before).Update("excerpt", "").Error
}

func SuspendUserForViolation(userId int, until int64) error {
	if err := ensureUserViolationState(DB, userId); err != nil {
		return err
	}
	return DB.Model(&UserViolationState{}).Where("user_id = ?", userId).Update("suspended_until", until).Error
}

// ForgiveUserViolations lifts the user's suspension and stops every earlier
// strike and refused conversation from counting.
func ForgiveUserViolations(userId int, now int64) error {
	if err := ensureUserViolationState(DB, userId); err != nil {
		return err
	}
	return DB.Model(&UserViolationState{}).Where("user_id = ?", userId).Updates(map[string]any{
		"last_strike_at":  0,
		"suspended_until": 0,
		"forgiven_at":     now,
	}).Error
}

// GetActiveViolationSuspensions returns the users suspended past now.
func GetActiveViolationSuspensions(now int64) (map[int]int64, error) {
	var states []UserViolationState
	if err := DB.Where("suspended_until > ?", now).Find(&states).Error; err != nil {
		return nil, err
	}
	suspended := make(map[int]int64, len(states))
	for _, state := range states {
		suspended[state.UserId] = state.SuspendedUntil
	}
	return suspended, nil
}

// RefusedConversation is a conversation the upstream refused, as the
// violation guard holds it: when it was last refused, whether resending it is
// blocked, and the refused message, for the customer to recognize.
type RefusedConversation struct {
	RefusedAt int64
	Blocked   bool
	Message   string
}

// GetRefusedViolationConversations returns, per user, the refused
// conversations recorded after since and not forgiven. A conversation is
// blocked once it has a refusal whose category is not lenient, or a second
// refusal of any category; a single lenient refusal only holds it. Message is
// the first refusal's excerpt. Conversations of exempt administrators are left
// out.
func GetRefusedViolationConversations(since int64, lenient func(category string) bool) (map[int]map[string]RefusedConversation, error) {
	var records []ViolationRecord
	err := DB.Select("user_id", "conversation_key", "created_at", "category", "excerpt").
		Where("created_at > ? AND conversation_key <> '' AND mode <> ?", since, ViolationModeExempt).
		Order("id").Find(&records).Error
	if err != nil {
		return nil, err
	}
	forgivenAt, err := violationForgivenAt(since)
	if err != nil {
		return nil, err
	}
	refused := map[int]map[string]RefusedConversation{}
	for _, record := range records {
		if record.CreatedAt <= forgivenAt[record.UserId] {
			continue
		}
		if refused[record.UserId] == nil {
			refused[record.UserId] = map[string]RefusedConversation{}
		}
		conversation, seen := refused[record.UserId][record.ConversationKey]
		conversation.RefusedAt = max(conversation.RefusedAt, record.CreatedAt)
		conversation.Blocked = conversation.Blocked || seen || !lenient(record.Category)
		if !seen {
			conversation.Message = record.Excerpt
		}
		refused[record.UserId][record.ConversationKey] = conversation
	}
	return refused, nil
}

// HasViolationInConversation reports whether a refusal of the conversation,
// outside exempt mode, was recorded for the user after since.
func HasViolationInConversation(userId int, conversationKey string, since int64) (bool, error) {
	var count int64
	err := DB.Model(&ViolationRecord{}).
		Where("user_id = ? AND conversation_key = ? AND created_at > ? AND mode <> ?", userId, conversationKey, since, ViolationModeExempt).
		Count(&count).Error
	return count > 0, err
}

// GetRecentClientChecks returns, per user, when each refused client check
// recorded after since and not forgiven was refused, oldest first. Checks of
// exempt administrators are left out.
func GetRecentClientChecks(since int64) (map[int][]int64, error) {
	var records []ViolationRecord
	err := DB.Select("user_id", "created_at").
		Where("created_at > ? AND action = ? AND mode <> ?", since, ViolationActionClientCheck, ViolationModeExempt).
		Order("created_at").Find(&records).Error
	if err != nil {
		return nil, err
	}
	forgivenAt, err := violationForgivenAt(since)
	if err != nil {
		return nil, err
	}
	checks := map[int][]int64{}
	for _, record := range records {
		if record.CreatedAt > forgivenAt[record.UserId] {
			checks[record.UserId] = append(checks[record.UserId], record.CreatedAt)
		}
	}
	return checks, nil
}

// violationForgivenAt returns when each user forgiven after since was
// forgiven.
func violationForgivenAt(since int64) (map[int]int64, error) {
	var forgiven []UserViolationState
	if err := DB.Where("forgiven_at > ?", since).Find(&forgiven).Error; err != nil {
		return nil, err
	}
	forgivenAt := make(map[int]int64, len(forgiven))
	for _, state := range forgiven {
		forgivenAt[state.UserId] = state.ForgivenAt
	}
	return forgivenAt, nil
}

// ViolationRecordView is a violation record with the account it belongs to.
type ViolationRecordView struct {
	ViolationRecord
	Username       string `json:"username"`
	SuspendedUntil int64  `json:"suspended_until"`
}

// ListViolationRecords returns the newest records first, optionally for one
// user, with each user's name and current suspension.
func ListViolationRecords(pageInfo *common.PageInfo, userId int) ([]ViolationRecordView, int64, error) {
	query := DB.Model(&ViolationRecord{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []ViolationRecord
	if err := query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&records).Error; err != nil {
		return nil, 0, err
	}
	if len(records) == 0 {
		return []ViolationRecordView{}, total, nil
	}
	userIds := make([]int, 0, len(records))
	for _, record := range records {
		userIds = append(userIds, record.UserId)
	}
	var users []User
	if err := DB.Unscoped().Select("id", "username").Where("id IN ?", userIds).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	var states []UserViolationState
	if err := DB.Where("user_id IN ?", userIds).Find(&states).Error; err != nil {
		return nil, 0, err
	}
	usernames := make(map[int]string, len(users))
	for _, user := range users {
		usernames[user.Id] = user.Username
	}
	suspendedUntil := make(map[int]int64, len(states))
	for _, state := range states {
		suspendedUntil[state.UserId] = state.SuspendedUntil
	}
	views := make([]ViolationRecordView, 0, len(records))
	for _, record := range records {
		views = append(views, ViolationRecordView{
			ViolationRecord: record,
			Username:        usernames[record.UserId],
			SuspendedUntil:  suspendedUntil[record.UserId],
		})
	}
	return views, total, nil
}

// RiskGateCategoryPrefix starts the category of a violation the risk gate
// recorded itself, as opposed to an upstream refusal.
const RiskGateCategoryPrefix = "gate:"

// GetRecentRefusedExcerpts returns the kept messages of upstream refusals
// since the given time, newest first, at most limit of them. Violations the
// risk gate recorded itself are left out: they are its own verdicts, not
// refusals. So are refusals of exempt administrators, whose probes would
// otherwise block each other.
func GetRecentRefusedExcerpts(since int64, limit int) ([]string, error) {
	var excerpts []string
	err := DB.Model(&ViolationRecord{}).
		Where("created_at > ? AND excerpt <> '' AND mode <> ? AND action <> ? AND (category IS NULL OR category NOT LIKE ?)", since, ViolationModeExempt, ViolationActionClientCheck, RiskGateCategoryPrefix+"%").
		Order("id desc").Limit(limit).Pluck("excerpt", &excerpts).Error
	return excerpts, err
}
