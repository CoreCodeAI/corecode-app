package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// useFeedbackTestDB points the model at fresh feedbacks, users and logs
// tables on dialect, with two customers: 11 and 12. MySQL and PostgreSQL run
// when TEST_MYSQL_DSN or TEST_POSTGRES_DSN names an empty database.
func useFeedbackTestDB(t *testing.T, dialect string) {
	t.Helper()
	var driver gorm.Dialector
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
	case "mysql":
		dsn := os.Getenv("TEST_MYSQL_DSN")
		if dsn == "" {
			t.Skip("TEST_MYSQL_DSN is not configured")
		}
		driver = mysql.Open(dsn)
	case "postgres":
		dsn := os.Getenv("TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("TEST_POSTGRES_DSN is not configured")
		}
		driver = postgres.Open(dsn)
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled = false
	tables := []any{&model.Feedback{}, &model.User{}, &model.Log{}}
	require.False(t, db.Migrator().HasTable(&model.Feedback{}), "use an empty test database")
	require.NoError(t, db.AutoMigrate(tables...))
	// A second migration must find nothing to change.
	require.NoError(t, db.AutoMigrate(&model.Feedback{}))
	for _, id := range []int{11, 12} {
		require.NoError(t, db.Create(&model.User{Id: id, Username: "user" + strconv.Itoa(id), AffCode: "aff" + strconv.Itoa(id), Quota: 1000}).Error)
	}
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(tables...))
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		require.NoError(t, sqlDB.Close())
	})
}

func callFeedback(t *testing.T, handler gin.HandlerFunc, method, target, body string, userId int) (int, map[string]any) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, target, strings.NewReader(body))
	c.Request.Header.Set("User-Agent", "feedback-test/1.0")
	c.Set("id", userId)
	if _, id, ok := strings.Cut(target, "/admin/"); ok {
		c.Params = gin.Params{{Key: "id", Value: id}}
	}
	handler(c)
	var response map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return recorder.Code, response
}

const validFeedback = `{"category":"bug","title":" 429 on every request ","description":"Since 10:00 every request fails.","related_request":"2026-10-28 10:02","contact":"qq 12345"}`

func userQuota(t *testing.T, id int) int {
	t.Helper()
	var user model.User
	require.NoError(t, model.DB.Select("quota").Where("id = ?", id).First(&user).Error)
	return user.Quota
}

func openFeedbackCount(t *testing.T) any {
	t.Helper()
	_, response := callFeedback(t, GetOpenFeedbackCount, http.MethodGet, "/api/feedback/admin/open-count", "", 1)
	require.Equal(t, true, response["success"], response)
	return response["data"].(map[string]any)["count"]
}

func TestFeedbackFlow(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useFeedbackTestDB(t, dialect)
			require.NoError(t, model.DB.Create(&model.Log{UserId: 11, CreatedAt: 1761616920, Type: model.LogTypeError, ModelName: "claude-opus-4-1", RequestId: "req-1"}).Error)
			require.NoError(t, model.DB.Create(&model.Log{UserId: 12, CreatedAt: 1761616921, Type: model.LogTypeConsume, ModelName: "other-user-model"}).Error)

			// Submit: the server trims, stores pending, and attaches context.
			_, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 11)
			require.Equal(t, true, response["success"], response)
			_, response = callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback",
				`{"category":"suggestion","title":"Dark mode","description":"Please."}`, 12)
			require.Equal(t, true, response["success"], response)

			var saved model.Feedback
			require.NoError(t, model.DB.Where("user_id = ?", 11).First(&saved).Error)
			assert.Equal(t, "429 on every request", saved.Title)
			assert.Equal(t, model.FeedbackStatusPending, saved.Status)
			assert.Contains(t, saved.Context, "feedback-test/1.0")
			assert.Contains(t, saved.Context, "req-1")
			assert.NotContains(t, saved.Context, "other-user-model")

			// A customer lists only their own reports.
			_, response = callFeedback(t, GetSelfFeedback, http.MethodGet, "/api/feedback/self", "", 11)
			require.Equal(t, true, response["success"], response)
			page := response["data"].(map[string]any)
			assert.EqualValues(t, 1, page["total"])
			assert.EqualValues(t, saved.Id, page["items"].([]any)[0].(map[string]any)["id"])

			// Administrators list everything and filter.
			_, response = callFeedback(t, GetAllFeedback, http.MethodGet, "/api/feedback/admin?category=suggestion", "", 1)
			items := response["data"].(map[string]any)["items"].([]any)
			require.Len(t, items, 1)
			assert.EqualValues(t, 12, items[0].(map[string]any)["user_id"])
			assert.EqualValues(t, 2, openFeedbackCount(t), "both pending reports are open")

			// Status and reply, then a one-time reward.
			target := "/api/feedback/admin/" + strconv.Itoa(saved.Id)
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"processing","admin_reply":"Looking into it"}`, 1)
			require.Equal(t, true, response["success"], response)
			assert.Equal(t, 1000, userQuota(t, 11))
			assert.EqualValues(t, 2, openFeedbackCount(t), "a report being processed is still open")

			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"resolved","admin_reply":"Fixed, thanks","reward_usd":5}`, 1)
			require.Equal(t, true, response["success"], response)
			reward := int(5 * common.QuotaPerUnit)
			assert.Equal(t, 1000+reward, userQuota(t, 11))
			assert.EqualValues(t, 1, openFeedbackCount(t), "a resolved report is closed")

			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"resolved","admin_reply":"Fixed, thanks","reward_usd":5}`, 1)
			assert.Equal(t, false, response["success"])
			assert.Equal(t, 1000+reward, userQuota(t, 11), "a second reward must not credit again")

			_, response = callFeedback(t, GetSelfFeedback, http.MethodGet, "/api/feedback/self", "", 11)
			mine := response["data"].(map[string]any)["items"].([]any)[0].(map[string]any)
			assert.Equal(t, "resolved", mine["status"])
			assert.Equal(t, "Fixed, thanks", mine["admin_reply"])
			assert.EqualValues(t, reward, mine["reward_quota"])
			assert.EqualValues(t, 1, mine["rewarded_by"])

			var logs int64
			require.NoError(t, model.DB.Model(&model.Log{}).Where("user_id = ? AND type = ?", 11, model.LogTypeSystem).Count(&logs).Error)
			assert.EqualValues(t, 1, logs)

			// Unknown id and unknown status change nothing.
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, "/api/feedback/admin/99999", `{"status":"resolved"}`, 1)
			assert.Equal(t, false, response["success"])
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"archived"}`, 1)
			assert.Equal(t, false, response["success"])
		})
	}
}

func TestSubmitFeedbackRejectsInvalidInput(t *testing.T) {
	useFeedbackTestDB(t, "sqlite")
	cases := map[string]string{
		"unknown category":  `{"category":"rant","title":"x","description":"y"}`,
		"blank title":       `{"category":"bug","title":"  ","description":"y"}`,
		"blank description": `{"category":"bug","title":"x","description":""}`,
		"long description":  `{"category":"bug","title":"x","description":"` + strings.Repeat("x", feedbackDescriptionLimit+1) + `"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			_, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", body, 11)
			assert.Equal(t, false, response["success"])
		})
	}
	var count int64
	require.NoError(t, model.DB.Model(&model.Feedback{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestSubmitFeedbackThrottlesOneAccount(t *testing.T) {
	useFeedbackTestDB(t, "sqlite")
	for range model.FeedbackMaxPerUserPerHour {
		_, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 11)
		require.Equal(t, true, response["success"], response)
	}
	status, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 11)
	assert.Equal(t, http.StatusTooManyRequests, status)
	assert.Equal(t, false, response["success"])
	_, response = callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 12)
	assert.Equal(t, true, response["success"], "another account is not throttled")
}

func TestUpdateFeedbackRejectsOutOfRangeRewards(t *testing.T) {
	useFeedbackTestDB(t, "sqlite")
	_, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 11)
	require.Equal(t, true, response["success"], response)
	var saved model.Feedback
	require.NoError(t, model.DB.First(&saved).Error)
	target := "/api/feedback/admin/" + strconv.Itoa(saved.Id)
	for _, body := range []string{
		`{"status":"resolved","reward_usd":-5}`,
		`{"status":"resolved","reward_usd":1000.01}`,
	} {
		_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, body, 1)
		assert.Equal(t, false, response["success"], body)
	}
	assert.Equal(t, 1000, userQuota(t, 11))
}

func TestFeedbackReplyUnread(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useFeedbackTestDB(t, dialect)
			unread := func(userId int) any {
				t.Helper()
				_, response := callFeedback(t, GetSelfUnreadFeedback, http.MethodGet, "/api/feedback/self/unread", "", userId)
				require.Equal(t, true, response["success"], response)
				return response["data"].(map[string]any)["count"]
			}
			repliedTime := func(id int) int64 {
				t.Helper()
				var feedback model.Feedback
				require.NoError(t, model.DB.Where("id = ?", id).First(&feedback).Error)
				return feedback.RepliedTime
			}
			markSeen := func(userId int, until int64) map[string]any {
				t.Helper()
				_, response := callFeedback(t, MarkSelfFeedbackSeen, http.MethodPost, "/api/feedback/self/seen", `{"until":`+strconv.FormatInt(until, 10)+`}`, userId)
				return response
			}

			_, response := callFeedback(t, SubmitFeedback, http.MethodPost, "/api/feedback", validFeedback, 11)
			require.Equal(t, true, response["success"], response)
			var saved model.Feedback
			require.NoError(t, model.DB.Where("user_id = ?", 11).First(&saved).Error)
			target := "/api/feedback/admin/" + strconv.Itoa(saved.Id)
			assert.EqualValues(t, 0, unread(11), "a new report has no reply")

			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"processing","admin_reply":"Looking into it"}`, 1)
			require.Equal(t, true, response["success"], response)
			assert.EqualValues(t, 1, unread(11))
			assert.EqualValues(t, 0, unread(12), "another account sees nothing")

			// Seeing the reply clears it; another account cannot clear it.
			first := repliedTime(saved.Id)
			assert.Equal(t, true, markSeen(12, first)["success"])
			assert.EqualValues(t, 1, unread(11))
			assert.Equal(t, true, markSeen(11, first)["success"])
			assert.EqualValues(t, 0, unread(11))

			// Saving the same status and reply is not news.
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"processing","admin_reply":"Looking into it"}`, 1)
			require.Equal(t, true, response["success"], response)
			assert.EqualValues(t, 0, unread(11))

			// A new reply, even within the same second, is unread again, and
			// marking only what was shown earlier leaves it unread.
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"resolved","admin_reply":"Fixed, thanks"}`, 1)
			require.Equal(t, true, response["success"], response)
			second := repliedTime(saved.Id)
			assert.Greater(t, second, first)
			assert.EqualValues(t, 1, unread(11))
			assert.Equal(t, true, markSeen(11, first)["success"])
			assert.EqualValues(t, 1, unread(11))
			assert.Equal(t, true, markSeen(11, second)["success"])
			assert.EqualValues(t, 0, unread(11))

			// A reward alone is news.
			_, response = callFeedback(t, UpdateFeedback, http.MethodPatch, target, `{"status":"resolved","admin_reply":"Fixed, thanks","reward_usd":5}`, 1)
			require.Equal(t, true, response["success"], response)
			assert.EqualValues(t, 1, unread(11))

			assert.Equal(t, false, markSeen(11, 0)["success"])
		})
	}
}
