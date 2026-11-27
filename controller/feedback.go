package controller

import (
	"errors"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	feedbackDescriptionLimit = 4000
	feedbackReplyLimit       = 2000
	// feedbackMaxRewardUSD bounds one reward, so a typo cannot hand out a
	// fortune.
	feedbackMaxRewardUSD = 1000
)

type feedbackRequest struct {
	Category       string `json:"category"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	RelatedRequest string `json:"related_request"`
	Contact        string `json:"contact"`
}

type feedbackUpdateRequest struct {
	Status     string `json:"status"`
	AdminReply string `json:"admin_reply"`
	// RewardUSD is a reward in US dollars of quota; 0 grants nothing.
	RewardUSD float64 `json:"reward_usd"`
}

type feedbackContext struct {
	UserAgent  string                   `json:"user_agent"`
	RecentLogs []model.FeedbackLogEntry `json:"recent_logs"`
}

// SubmitFeedback files a signed-in customer's report or suggestion, with the
// browser's user agent and the customer's latest usage log entries attached.
func SubmitFeedback(c *gin.Context) {
	var request feedbackRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	userId := c.GetInt("id")
	feedback := model.Feedback{
		UserId:         userId,
		Category:       request.Category,
		Title:          strings.TrimSpace(request.Title),
		Description:    strings.TrimSpace(request.Description),
		RelatedRequest: strings.TrimSpace(request.RelatedRequest),
		Contact:        strings.TrimSpace(request.Contact),
	}
	if !slices.Contains(model.FeedbackCategories, feedback.Category) ||
		feedback.Title == "" || utf8.RuneCountInString(feedback.Title) > 128 ||
		feedback.Description == "" || utf8.RuneCountInString(feedback.Description) > feedbackDescriptionLimit ||
		utf8.RuneCountInString(feedback.RelatedRequest) > 128 ||
		utf8.RuneCountInString(feedback.Contact) > 128 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	recent, err := model.CountFeedbackSince(userId, time.Now().Add(-time.Hour).Unix())
	if err != nil {
		common.SysError(common.LogText("feedback throttle lookup failed: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	if recent >= model.FeedbackMaxPerUserPerHour {
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Too much feedback, please try again later."))
		return
	}

	// The context helps diagnosis but is not worth failing a report over.
	attached := feedbackContext{UserAgent: c.Request.UserAgent()}
	if len(attached.UserAgent) > 512 {
		attached.UserAgent = attached.UserAgent[:512]
	}
	if logs, err := model.RecentFeedbackLogs(userId); err != nil {
		common.SysError(common.LogText("failed to read recent logs for feedback: %v", err))
	} else {
		attached.RecentLogs = logs
	}
	if encoded, err := common.Marshal(attached); err == nil {
		feedback.Context = string(encoded)
	}

	if err := feedback.Insert(); err != nil {
		common.SysError(common.LogText("failed to save feedback: %v", err))
		common.ApiErrorT(c, "Database error, please contact the administrator")
		return
	}
	common.ApiSuccessT(c, "Feedback submitted", nil)
}

// GetSelfFeedback pages the signed-in customer's own reports.
func GetSelfFeedback(c *gin.Context) {
	listFeedback(c, model.FeedbackFilter{UserId: c.GetInt("id")})
}

// GetSelfUnreadFeedback counts the signed-in customer's reports with a reply
// they have not seen, for the console's reminder.
func GetSelfUnreadFeedback(c *gin.Context) {
	count, err := model.CountUnreadFeedback(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

type feedbackSeenRequest struct {
	// Until is the latest replied_time the console showed the customer.
	Until int64 `json:"until"`
}

// MarkSelfFeedbackSeen records that the signed-in customer has seen the
// replies the console showed them.
func MarkSelfFeedbackSeen(c *gin.Context) {
	var request feedbackSeenRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Until <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.MarkFeedbackSeen(c.GetInt("id"), request.Until); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

// GetOpenFeedbackCount returns how many reports wait on an administrator, for
// the sidebar badge.
func GetOpenFeedbackCount(c *gin.Context) {
	count, err := model.CountOpenFeedback()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}

// GetAllFeedback pages every account's reports for administrators, filtered
// by status, category and a keyword on the title or description.
func GetAllFeedback(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Query("user_id"))
	listFeedback(c, model.FeedbackFilter{
		UserId:   userId,
		Status:   c.Query("status"),
		Category: c.Query("category"),
		Keyword:  c.Query("keyword"),
	})
}

func listFeedback(c *gin.Context, filter model.FeedbackFilter) {
	pageInfo := common.GetPageQuery(c)
	feedback, total, err := model.ListFeedback(filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(feedback)
	common.ApiSuccess(c, pageInfo)
}

// UpdateFeedback records an administrator's status and reply on a report,
// and grants an optional one-time reward to its submitter.
func UpdateFeedback(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var request feedbackUpdateRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	reply := strings.TrimSpace(request.AdminReply)
	if !slices.Contains(model.FeedbackStatuses, request.Status) ||
		utf8.RuneCountInString(reply) > feedbackReplyLimit ||
		math.IsNaN(request.RewardUSD) || request.RewardUSD < 0 || request.RewardUSD > feedbackMaxRewardUSD {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	rewardQuota := int(math.Round(request.RewardUSD * common.QuotaPerUnit))
	if request.RewardUSD > 0 && rewardQuota <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}

	feedback, err := model.UpdateFeedback(id, model.FeedbackUpdate{
		Status:      request.Status,
		AdminReply:  reply,
		RewardQuota: rewardQuota,
		AdminId:     c.GetInt("id"),
	})
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		common.ApiErrorT(c, "Feedback not found")
		return
	case errors.Is(err, model.ErrFeedbackAlreadyRewarded):
		common.ApiErrorT(c, "This feedback has already been rewarded")
		return
	case err != nil:
		common.ApiError(c, err)
		return
	}
	if rewardQuota > 0 {
		model.RecordLog(feedback.UserId, model.LogTypeSystem, common.NewMessage("Feedback reward, received {{quota}}", map[string]any{"quota": logger.FormatQuota(rewardQuota)}))
	}
	common.ApiSuccess(c, feedback)
}
