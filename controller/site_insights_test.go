package controller

import (
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Every hour-based view says where the request logs begin, beside its own
// fields, so an hour before that reads as no data.
func TestServeInsightsSaysWhereTheLogsBegin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousLogDB := model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	model.LOG_DB = db
	t.Cleanup(func() { model.LOG_DB = previousLogDB })

	const hour = int64(1759248000)
	require.NoError(t, db.Create(&model.Log{UserId: 1, Type: model.LogTypeConsume, CreatedAt: hour + 900, UseTime: 2, ModelName: "opus", Other: `{}`}).Error)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "/?start_time="+strconv.FormatInt(hour, 10)+"&end_time="+strconv.FormatInt(hour+3600, 10), nil)
	type view struct {
		Requests int64 `json:"requests"`
	}
	serveInsights(c, model.InsightsMaxDays, func(model.InsightsRange) (*view, error) {
		return &view{Requests: 7}, nil
	})
	require.Equal(t, 200, recorder.Code)
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Requests  int64 `json:"requests"`
			LogsSince int64 `json:"logs_since"`
		} `json:"data"`
	}
	require.NoError(t, common.UnmarshalJsonStr(recorder.Body.String(), &body))
	assert.True(t, body.Success)
	assert.EqualValues(t, 7, body.Data.Requests, "the view's own fields stay as they were")
	assert.Equal(t, hour+900, body.Data.LogsSince)
}
