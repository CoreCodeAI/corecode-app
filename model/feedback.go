package model

import (
	"errors"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// What a customer is reporting.
const (
	FeedbackCategoryBug        = "bug"
	FeedbackCategorySuggestion = "suggestion"
	FeedbackCategoryBilling    = "billing"
	FeedbackCategoryOther      = "other"
)

var FeedbackCategories = []string{
	FeedbackCategoryBug,
	FeedbackCategorySuggestion,
	FeedbackCategoryBilling,
	FeedbackCategoryOther,
}

// Where an administrator has taken a report.
const (
	FeedbackStatusPending    = "pending"
	FeedbackStatusProcessing = "processing"
	FeedbackStatusResolved   = "resolved"
	FeedbackStatusInvalid    = "invalid"
)

var FeedbackStatuses = []string{
	FeedbackStatusPending,
	FeedbackStatusProcessing,
	FeedbackStatusResolved,
	FeedbackStatusInvalid,
}

// FeedbackMaxPerUserPerHour bounds how many reports one account can file in
// an hour. The rows are the counter, so a restart or a second instance does
// not reset it.
const FeedbackMaxPerUserPerHour = 5

// FeedbackRecentLogCount is how many of the submitter's latest usage log
// entries are attached to a report.
const FeedbackRecentLogCount = 5

// ErrFeedbackAlreadyRewarded is returned when a reward is granted on a report
// that already carries one.
var ErrFeedbackAlreadyRewarded = errors.New("feedback already rewarded")

// Feedback is a customer's report or suggestion, filed from the console, and
// the administrator's reply to it.
type Feedback struct {
	Id          int    `json:"id"`
	UserId      int    `json:"user_id" gorm:"index;not null"`
	Category    string `json:"category" gorm:"type:varchar(16);not null;index"`
	Title       string `json:"title" gorm:"type:varchar(128);not null"`
	Description string `json:"description" gorm:"type:text"`
	// RelatedRequest is the time or request id the customer points at.
	RelatedRequest string `json:"related_request" gorm:"type:varchar(128)"`
	Contact        string `json:"contact" gorm:"type:varchar(128)"`
	// Context is JSON the server attaches on submit: the user agent and the
	// submitter's latest usage log entries.
	Context    string `json:"context" gorm:"type:text"`
	Status     string `json:"status" gorm:"type:varchar(16);not null;index"`
	AdminReply string `json:"admin_reply" gorm:"type:text"`
	// RewardQuota is the quota granted for this report; 0 means none yet.
	RewardQuota  int   `json:"reward_quota" gorm:"not null;default:0"`
	RewardedBy   int   `json:"rewarded_by" gorm:"not null;default:0"`
	RewardedTime int64 `json:"rewarded_time" gorm:"bigint;not null;default:0"`
	// RepliedTime is when an administrator last changed what the customer
	// sees: the status, the reply or the reward. SeenTime is the RepliedTime
	// the customer has seen. The report carries an unread reply while
	// RepliedTime > SeenTime.
	RepliedTime int64 `json:"replied_time" gorm:"bigint;not null;default:0"`
	SeenTime    int64 `json:"seen_time" gorm:"bigint;not null;default:0"`
	CreatedTime int64 `json:"created_time" gorm:"bigint;index"`
	UpdatedTime int64 `json:"updated_time" gorm:"bigint"`
}

// FeedbackLogEntry is the part of a usage log entry attached to a report.
type FeedbackLogEntry struct {
	Id        int    `json:"id"`
	CreatedAt int64  `json:"created_at"`
	Type      int    `json:"type"`
	ModelName string `json:"model_name"`
	RequestId string `json:"request_id,omitempty"`
}

// FeedbackFilter narrows a list. UserId 0 lists every account's reports.
// Keyword matches any part of the title or description.
type FeedbackFilter struct {
	UserId   int
	Status   string
	Category string
	Keyword  string
}

// FeedbackUpdate is an administrator's change to a report. RewardQuota 0
// grants nothing.
type FeedbackUpdate struct {
	Status      string
	AdminReply  string
	RewardQuota int
	AdminId     int
}

func (feedback *Feedback) Insert() error {
	now := common.GetTimestamp()
	feedback.Status = FeedbackStatusPending
	feedback.CreatedTime = now
	feedback.UpdatedTime = now
	return DB.Create(feedback).Error
}

// CountFeedbackSince counts the reports userId filed at or after since, a
// unix second.
func CountFeedbackSince(userId int, since int64) (int64, error) {
	var count int64
	err := DB.Model(&Feedback{}).
		Where("user_id = ? AND created_time >= ?", userId, since).
		Count(&count).Error
	return count, err
}

// RecentFeedbackLogs returns userId's latest usage log entries, newest first.
func RecentFeedbackLogs(userId int) ([]FeedbackLogEntry, error) {
	entries := make([]FeedbackLogEntry, 0, FeedbackRecentLogCount)
	err := LOG_DB.Model(&Log{}).
		Select("id", "created_at", "type", "model_name", "request_id").
		Where("user_id = ?", userId).
		Order("id DESC").
		Limit(FeedbackRecentLogCount).
		Find(&entries).Error
	return entries, err
}

// CountUnreadFeedback counts userId's reports whose latest reply the
// customer has not seen.
func CountUnreadFeedback(userId int) (int64, error) {
	var count int64
	err := DB.Model(&Feedback{}).
		Where("user_id = ? AND replied_time > seen_time", userId).
		Count(&count).Error
	return count, err
}

// MarkFeedbackSeen marks userId's replies up to until, a unix second, as
// seen. A reply made after until, which the customer has not been shown,
// stays unread.
func MarkFeedbackSeen(userId int, until int64) error {
	return DB.Model(&Feedback{}).
		Where("user_id = ? AND replied_time > seen_time AND replied_time <= ?", userId, until).
		Update("seen_time", gorm.Expr("replied_time")).Error
}

// CountOpenFeedback counts reports an administrator has not closed: those
// still pending or being processed.
func CountOpenFeedback() (int64, error) {
	var count int64
	err := DB.Model(&Feedback{}).
		Where("status IN ?", []string{FeedbackStatusPending, FeedbackStatusProcessing}).
		Count(&count).Error
	return count, err
}

// ListFeedback pages reports, newest first.
func ListFeedback(filter FeedbackFilter, pageInfo *common.PageInfo) ([]*Feedback, int64, error) {
	query := DB.Model(&Feedback{})
	if filter.UserId > 0 {
		query = query.Where("user_id = ?", filter.UserId)
	}
	if slices.Contains(FeedbackStatuses, filter.Status) {
		query = query.Where("status = ?", filter.Status)
	}
	if slices.Contains(FeedbackCategories, filter.Category) {
		query = query.Where("category = ?", filter.Category)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("title LIKE ? OR description LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	feedback := make([]*Feedback, 0)
	err := query.Order("id DESC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&feedback).Error
	return feedback, total, err
}

// UpdateFeedback records an administrator's status and reply on a report and,
// when update.RewardQuota is positive, adds that quota to the submitter's
// balance in the same transaction. A report is rewarded at most once: a
// second reward returns ErrFeedbackAlreadyRewarded and changes nothing. It
// returns gorm.ErrRecordNotFound when id does not exist. The returned report
// is the stored row after the change.
func UpdateFeedback(id int, update FeedbackUpdate) (*Feedback, error) {
	var feedback Feedback
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ?", id).First(&feedback).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		changes := map[string]any{
			"status":       update.Status,
			"admin_reply":  update.AdminReply,
			"updated_time": now,
		}
		// Each change moves RepliedTime forward, even within one second, so a
		// customer who saw the previous one sees this one as unread.
		if update.Status != feedback.Status || update.AdminReply != feedback.AdminReply || update.RewardQuota > 0 {
			changes["replied_time"] = max(now, feedback.RepliedTime+1)
		}
		if update.RewardQuota > 0 {
			if feedback.RewardQuota > 0 {
				return ErrFeedbackAlreadyRewarded
			}
			if err := common.ValidateWalletQuota(update.RewardQuota); err != nil {
				return err
			}
			credited := tx.Model(&User{}).
				Where("id = ? AND quota <= ?", feedback.UserId, common.MaxWalletQuota-update.RewardQuota).
				Update("quota", gorm.Expr("quota + ?", update.RewardQuota))
			if credited.Error != nil {
				return credited.Error
			}
			if credited.RowsAffected != 1 {
				return errors.New("failed to credit the feedback reward")
			}
			changes["reward_quota"] = update.RewardQuota
			changes["rewarded_by"] = update.AdminId
			changes["rewarded_time"] = now
		}
		if err := tx.Model(&Feedback{}).Where("id = ?", id).Updates(changes).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).First(&feedback).Error
	})
	if err != nil {
		return nil, err
	}
	syncCreditUserQuotaCache(feedback.UserId, update.RewardQuota, "feedback reward")
	return &feedback, nil
}
