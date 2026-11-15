package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// upstreamStub answers as a Sub2API site (/v1/usage) or as a new-api site
// (/api/log/token and /api/status) and counts the usage reads it gets. Its
// day answers are the test's to change.
type upstreamStub struct {
	mu         sync.Mutex
	key        string
	total      string            // usage.total.actual_cost, as JSON
	stats      map[string]string // start_date -> model_stats, as JSON
	raw        string            // when set, /v1/usage answers this body
	newAPIBody string            // when set, /api/log/token answers this body
	usageHits  int
}

func (s *upstreamStub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Header.Get("Authorization") != "Bearer "+s.key {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}
	switch {
	case r.URL.Path == "/api/log/token" && s.newAPIBody != "":
		fmt.Fprint(w, s.newAPIBody)
	case r.URL.Path == "/api/status" && s.newAPIBody != "":
		fmt.Fprint(w, `{"success":true,"data":{"quota_per_unit":500000}}`)
	case r.URL.Path == "/v1/usage":
		s.usageHits++
		if s.raw != "" {
			fmt.Fprint(w, s.raw)
			return
		}
		body := `{"mode":"quota_limited","usage":{"total":{"actual_cost":` + s.total + `}}`
		if stats, ok := s.stats[r.URL.Query().Get("start_date")]; ok {
			body += `,"model_stats":` + stats
		}
		fmt.Fprint(w, body+"}")
	default:
		http.Error(w, "<html>not an api</html>", http.StatusNotFound)
	}
}

func (s *upstreamStub) hits() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usageHits
}

func setupUpstreamBillTestDB(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.UpstreamBillDay{}, &model.UpstreamCost{}))
	model.DB = db
	// A read in an earlier test must not hold this one's off.
	upstreamBillNext = map[int]time.Time{}
	t.Cleanup(func() { model.DB = previousDB })
}

// The stubs' days are the UTC+8 days of this instant: 2026-11-14 in Beijing.
var billNow = time.Date(2026, 11, 14, 4, 0, 0, 0, time.UTC)

const (
	billToday     = "2026-11-14"
	billYesterday = "2026-11-13"
)

func billChannel(id int, base string, key string, models string) *model.Channel {
	return &model.Channel{Id: id, Key: key, BaseURL: &base, Models: models, Type: 1}
}

func billRows(t *testing.T, channelID int) []model.UpstreamBillDay {
	t.Helper()
	var rows []model.UpstreamBillDay
	require.NoError(t, model.DB.Where("channel_id = ?", channelID).Order("day_start DESC, model_name").Find(&rows).Error)
	return rows
}

func dayRows(t *testing.T, channelID int, dayStart int64) []model.UpstreamBillDay {
	t.Helper()
	var rows []model.UpstreamBillDay
	require.NoError(t, model.DB.Where("channel_id = ? AND day_start = ?", channelID, dayStart).Order("model_name").Find(&rows).Error)
	return rows
}

// A channel created five days ago is asked for its own days, not for ninety.
func TestSub2APIBillBackfillStopsAtTheChannelsCreation(t *testing.T) {
	setupUpstreamBillTestDB(t)
	stub := &upstreamStub{key: "sk-new", total: "10", stats: map[string]string{
		billToday: `[{"model":"image-a","requests":3,"cost":2.4,"actual_cost":2}]`,
	}}
	server := httptest.NewServer(stub)
	defer server.Close()
	channel := billChannel(8, server.URL, "sk-new", "image-a")
	channel.CreatedTime = billNow.Add(-5 * 24 * time.Hour).Unix()
	owners := newBillOwners([]*model.Channel{channel})

	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, billNow))
	first := stub.hits()
	assert.GreaterOrEqual(t, first, 6, "every day since the channel was created")
	assert.LessOrEqual(t, first, 8, "and no more than a day or two before it")

	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, billNow.Add(16*time.Minute)))
	assert.Equal(t, first+3, stub.hits(), "the bill reaches back to the creation, so later reads refresh three days")
}

func TestSub2APIBillBackfillsThenRefreshesDays(t *testing.T) {
	setupUpstreamBillTestDB(t)
	stub := &upstreamStub{key: "sk-shared", total: "10", stats: map[string]string{
		billToday:     `[{"model":"image-a","requests":3,"cost":2.4,"actual_cost":2},{"model":"image-b","requests":1,"cost":0.6,"actual_cost":0.5}]`,
		billYesterday: `[{"model":"image-a","requests":1,"cost":1,"actual_cost":1}]`,
	}}
	server := httptest.NewServer(stub)
	defer server.Close()
	channel := billChannel(8, server.URL, "sk-shared", "image-a,image-b")
	owners := newBillOwners([]*model.Channel{channel})

	// The first read backfills 90 days: 3 model rows, and a row with no model
	// for each of the 88 days without billing.
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, billNow))
	assert.Equal(t, 90, stub.hits())
	rows := billRows(t, 8)
	require.Len(t, rows, 91)
	today := rows[0]
	assert.Equal(t, "image-a", today.ModelName)
	assert.EqualValues(t, 3, today.Requests)
	assert.InDelta(t, 2, today.CostUSD, 1e-9, "actual_cost is what the key paid")
	assert.InDelta(t, 2.4, today.StandardCostUSD, 1e-9, "cost is kept beside it")

	// A later read asks for the last three days only, and writes the same rows.
	later := billNow.Add(16 * time.Minute)
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, later))
	assert.Equal(t, 93, stub.hits())
	assert.Len(t, billRows(t, 8), 91, "a read again stores no row twice")

	// The upstream lowers today's image-a: the stored figure follows.
	stub.stats[billToday] = `[{"model":"image-a","requests":3,"cost":1.2,"actual_cost":1.5},{"model":"image-b","requests":1,"cost":0.6,"actual_cost":0.5}]`
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, later.Add(16*time.Minute)))
	assert.InDelta(t, 1.5, dayRows(t, 8, billNowDay(0))[0].CostUSD, 1e-9, "a lowered day is corrected")
	assert.InDelta(t, 1, dayRows(t, 8, billNowDay(1))[0].CostUSD, 1e-9, "a day not read again keeps its figure")

	// A day the upstream no longer reports keeps its read, with no model.
	delete(stub.stats, billYesterday)
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, later.Add(32*time.Minute)))
	yesterday := dayRows(t, 8, billNowDay(1))
	require.Len(t, yesterday, 1)
	assert.Empty(t, yesterday[0].ModelName, "the day stays read, with no model")
	assert.Zero(t, yesterday[0].CostUSD)

	// Inside the spacing a channel is not read again.
	hits := stub.hits()
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), channel, owners, later.Add(33*time.Minute)))
	assert.Equal(t, hits, stub.hits())
}

// billNowDay is the UTC+8 day start that is n days before billNow's day.
func billNowDay(n int) int64 {
	local := billNow.Unix() + model.UpstreamBillDayOffset
	today := local - local%86400 - model.UpstreamBillDayOffset
	return today - int64(n)*86400
}

func TestSub2APIBillStoresNothingForAnUnexpectedAnswer(t *testing.T) {
	setupUpstreamBillTestDB(t)
	stub := &upstreamStub{key: "sk-shared", total: "10", stats: map[string]string{
		billToday: `[{"model":"image-a","requests":1,"cost":1,"actual_cost":1}]`,
	}}
	server := httptest.NewServer(stub)
	defer server.Close()
	channel := billChannel(9, server.URL, "sk-shared", "image-a")
	owners := newBillOwners([]*model.Channel{channel})

	for name, raw := range map[string]string{
		"a page instead of JSON":       `<html>login</html>`,
		"no mode":                      `{"usage":{"total":{"actual_cost":10}}}`,
		"a total that is not a number": `{"mode":"unrestricted","usage":{"total":{"actual_cost":"10"}}}`,
		"a model row without requests": `{"mode":"unrestricted","usage":{"total":{"actual_cost":10}},"model_stats":[{"model":"image-a","cost":1,"actual_cost":1}]}`,
		"a day above the key's total":  `{"mode":"unrestricted","usage":{"total":{"actual_cost":0.5}},"model_stats":[{"model":"image-a","requests":1,"cost":1,"actual_cost":1}]}`,
		"a negative model cost":        `{"mode":"unrestricted","usage":{"total":{"actual_cost":10}},"model_stats":[{"model":"image-a","requests":1,"cost":1,"actual_cost":-1}]}`,
	} {
		stub.raw = raw
		err := syncSub2APIBills(context.Background(), server.Client(), channel, owners, billNow)
		assert.Error(t, err, name)
		assert.Empty(t, billRows(t, 9), name)
	}
}

func TestSharedSub2APIKeyIsCountedOnce(t *testing.T) {
	setupUpstreamBillTestDB(t)
	stub := &upstreamStub{key: "sk-shared", total: "3", stats: map[string]string{
		billToday: `[{"model":"image-a","requests":2,"cost":2,"actual_cost":2},{"model":"image-b","requests":1,"cost":0.5,"actual_cost":0.5}]`,
	}}
	server := httptest.NewServer(stub)
	defer server.Close()
	first := billChannel(3, server.URL, "sk-shared", "image-a")
	second := billChannel(4, server.URL, "sk-shared", "image-b")
	channels := []*model.Channel{first, second}
	owners := newBillOwners(channels)

	assert.Equal(t, 3, owners("sk-shared", "image-a"), "the channel serving the model owns it")
	assert.Equal(t, 4, owners("sk-shared", "image-b"))
	assert.Equal(t, 3, owners("sk-shared", "unlisted"), "a model no channel serves goes to the lowest channel holding the key")

	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), first, owners, billNow))
	require.NoError(t, syncSub2APIBills(context.Background(), server.Client(), second, owners, billNow))
	var total float64
	for _, id := range []int{3, 4} {
		for _, row := range dayRows(t, id, billNowDay(0)) {
			total += row.CostUSD
		}
	}
	assert.InDelta(t, 2.5, total, 1e-9, "the key's day is counted once, not once per channel")
}

func TestNewAPIBillPathIsUnchanged(t *testing.T) {
	setupUpstreamBillTestDB(t)
	stub := &upstreamStub{key: "sk-new", newAPIBody: `{"success":true,"message":"","data":[` +
		`{"created_at":1759248100,"type":2,"model_name":"gpt-x","quota":500000,"request_id":"req-1","group":"GPT","other":"{\"group_ratio\":0.5}"}]}`}
	server := httptest.NewServer(stub)
	defer server.Close()
	channel := billChannel(12, server.URL, "sk-new", "gpt-x")
	owners := newBillOwners([]*model.Channel{channel})

	added, err := syncUpstreamChannel(context.Background(), channel, owners)
	require.NoError(t, err)
	assert.EqualValues(t, 1, added, "the request-level read stores the request")
	assert.Zero(t, stub.hits(), "a new-api site is never asked for Sub2API usage")
	assert.Empty(t, billRows(t, 12))
	var costs []model.UpstreamCost
	require.NoError(t, model.DB.Find(&costs).Error)
	require.Len(t, costs, 1)
	assert.Equal(t, "req-1", costs[0].RequestId)
}
