package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupRivalBoardDB(t *testing.T) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.RivalSite{}, &model.RivalPrice{}, &model.RivalPriceChange{},
		&model.RivalDirectoryState{}, &model.RivalGroupKind{}, &model.InsightModelHour{}))
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = previousDB, previousLogDB })
}

func getRivalBoard(t *testing.T) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/rival-prices?model=claude-opus-5-5", nil)
	GetRivalPrices(c)
	require.Equal(t, http.StatusOK, w.Code)
	var body struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &body))
	require.True(t, body.Success, w.Body.String())
	return body.Data
}

// The same relay added by hand and found in the directory reads one price
// list; the board lists it once, as the hand-added entry.
func TestRivalBoardListsASiteOnceAndAppliesKindOverrides(t *testing.T) {
	setupRivalBoardDB(t)
	input := 10.0
	directory := model.RivalSite{Slug: "kfcv50-link", Name: "KFCV50API", APIBase: "https://kfcv50.link", Source: model.RivalSourceDirectory, Enabled: true, Status: model.RivalStatusOK, TopUpPrice: 1}
	manual := model.RivalSite{Slug: "manual-kfcv50.link", Name: "KFCV50", APIBase: "https://kfcv50.link", Source: model.RivalSourceManual, Enabled: true, Status: model.RivalStatusOK, TopUpPrice: 7.3}
	require.NoError(t, model.DB.Create(&directory).Error)
	require.NoError(t, model.DB.Create(&manual).Error)
	for _, id := range []int{directory.Id, manual.Id} {
		require.NoError(t, model.DB.Create(&model.RivalPrice{SiteId: id, Model: "claude-opus-5-5", GroupName: "svip", GroupRatio: 1, ModelRatio: 2, CompletionRatio: 5, InputCNY: &input}).Error)
	}
	require.NoError(t, model.SetRivalGroupKind(manual.Id, "svip", "pool", 1))

	data := getRivalBoard(t)
	sites := data["sites"].([]any)
	require.Len(t, sites, 1)
	site := sites[0].(map[string]any)
	assert.Equal(t, "KFCV50", site["name"])
	assert.Equal(t, "default", site["trust"], "7.3 is new-api's default top-up price")
	price := site["prices"].([]any)[0].(map[string]any)
	assert.Equal(t, "pool", price["kind"])
	assert.Equal(t, true, price["kind_overridden"])
	assert.True(t, strings.Contains(strings.Join(func() []string {
		var kinds []string
		for _, k := range data["kinds"].([]any) {
			kinds = append(kinds, k.(string))
		}
		return kinds
	}(), ","), "pool"))
}
