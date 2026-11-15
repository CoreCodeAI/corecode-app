package controller

import (
	"errors"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

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

// useSettledClock empties the settled-range cache and reads the clock from
// now, for one test.
func useSettledClock(t *testing.T, now *time.Time) {
	t.Helper()
	clear := func() {
		settledInsights.mu.Lock()
		settledInsights.entries = nil
		settledInsights.bytes = 0
		settledInsights.mu.Unlock()
	}
	clear()
	previous := settledInsightsNow
	settledInsightsNow = func() time.Time { return *now }
	t.Cleanup(func() {
		settledInsightsNow = previous
		clear()
	})
}

// The cache keeps a read over a settled range for its TTL, shares concurrent
// reads, never keeps a range still running, and keeps no error.
func TestCachedInsightReads(t *testing.T) {
	const base = int64(1768482000) // an hour boundary
	now := time.Unix(base+12*3600, 0)
	useSettledClock(t, &now)
	settled := model.InsightsRange{Start: base, End: base + 3*3600}
	open := model.InsightsRange{Start: base, End: base + 13*3600}
	var reads int
	read := func(model.InsightsRange) (int64, error) {
		reads++
		return int64(reads), nil
	}

	t.Run("a settled range is read once for the TTL", func(t *testing.T) {
		reads = 0
		first, err := cachedRead("test-settled", settled, read)
		require.NoError(t, err)
		again, err := cachedRead("test-settled", settled, read)
		require.NoError(t, err)
		assert.Equal(t, first, again)
		assert.Equal(t, 1, reads)

		now = now.Add(insightsSettledTTL - time.Second)
		_, err = cachedRead("test-settled", settled, read)
		require.NoError(t, err)
		assert.Equal(t, 1, reads, "still kept just before the TTL ends")

		now = now.Add(time.Second)
		refreshed, err := cachedRead("test-settled", settled, read)
		require.NoError(t, err)
		assert.Equal(t, 2, reads, "expired at the TTL")
		assert.Equal(t, int64(2), refreshed)
		now = time.Unix(base+12*3600, 0)
	})

	t.Run("a range still running is read each time", func(t *testing.T) {
		reads = 0
		for range 2 {
			_, err := cachedRead("test-open", open, read)
			require.NoError(t, err)
		}
		assert.Equal(t, 2, reads)
	})

	t.Run("concurrent calls share one read", func(t *testing.T) {
		reads = 0
		release := make(chan struct{})
		blocked := func(model.InsightsRange) (int64, error) {
			reads++
			<-release
			return 7, nil
		}
		var wg sync.WaitGroup
		results := make([]int64, 8)
		for i := range results {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results[i], _ = cachedRead("test-shared", settled, blocked)
			}()
		}
		close(release)
		wg.Wait()
		assert.Equal(t, 1, reads)
		for _, result := range results {
			assert.Equal(t, int64(7), result)
		}
	})

	t.Run("parts and offsets do not share an answer", func(t *testing.T) {
		reads = 0
		_, err := cachedRead("test-parts", settled, read, "opus")
		require.NoError(t, err)
		_, err = cachedRead("test-parts", settled, read, "sonnet")
		require.NoError(t, err)
		_, err = cachedRead("test-parts", settled, read, "opus", "sonnet")
		require.NoError(t, err)
		_, err = cachedRead("test-parts", settled, read, "opus,sonnet")
		require.NoError(t, err)
		shifted := settled
		shifted.Offset = 8 * 3600
		_, err = cachedRead("test-parts", shifted, read, "opus")
		require.NoError(t, err)
		assert.Equal(t, 5, reads, "each distinct parameter list and offset is read on its own")
	})

	t.Run("a write drops the kept answers, and a read in progress keeps none", func(t *testing.T) {
		reads = 0
		_, err := cachedRead("test-write", settled, read)
		require.NoError(t, err)
		forgetSettledInsights()
		_, err = cachedRead("test-write", settled, read)
		require.NoError(t, err)
		assert.Equal(t, 2, reads, "a write drops the kept answer")

		started, release := make(chan struct{}), make(chan struct{})
		slow := func(model.InsightsRange) (int64, error) {
			close(started)
			<-release
			return 1, nil
		}
		done := make(chan struct{})
		go func() {
			defer close(done)
			_, _ = cachedRead("test-write-race", settled, slow)
		}()
		<-started
		forgetSettledInsights()
		close(release)
		<-done
		reads = 0
		_, err = cachedRead("test-write-race", settled, read)
		require.NoError(t, err)
		assert.Equal(t, 1, reads, "the read that began before the write was not kept")
	})

	t.Run("an error is not kept", func(t *testing.T) {
		reads = 0
		failing := func(model.InsightsRange) (int64, error) {
			reads++
			if reads == 1 {
				return 0, errors.New("logs unavailable")
			}
			return 9, nil
		}
		_, err := cachedRead("test-error", settled, failing)
		require.Error(t, err)
		result, err := cachedRead("test-error", settled, failing)
		require.NoError(t, err)
		assert.Equal(t, int64(9), result)
		assert.Equal(t, 2, reads)
	})

	t.Run("the entry and byte bounds hold", func(t *testing.T) {
		for i := range insightsSettledMaxItems + 50 {
			settledInsights.put(insightsKey("test-bound", settled, []string{strconv.Itoa(i)}), int64(i), now, settledInsights.currentGeneration())
		}
		settledInsights.mu.Lock()
		defer settledInsights.mu.Unlock()
		assert.LessOrEqual(t, len(settledInsights.entries), insightsSettledMaxItems)
		assert.LessOrEqual(t, settledInsights.bytes, insightsSettledMaxBytes)
	})
}
