package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func clearRivalTables(t *testing.T) {
	t.Helper()
	for _, table := range []string{"rival_sites", "rival_prices", "rival_price_changes", "rival_directory_states"} {
		require.NoError(t, DB.Exec("DELETE FROM "+table).Error)
	}
}

func rivalCNY(v float64) *float64 { return &v }

func TestClaimRivalSitesDueClaimsEachSiteOnce(t *testing.T) {
	clearRivalTables(t)
	due := RivalSite{Slug: "due", SiteURL: "https://a.example", Enabled: true, NextCheckAt: 0}
	later := RivalSite{Slug: "later", SiteURL: "https://b.example", Enabled: true, NextCheckAt: 5000}
	off := RivalSite{Slug: "off", SiteURL: "https://c.example", Enabled: true}
	noAddress := RivalSite{Slug: "pending", Enabled: true}
	for _, s := range []*RivalSite{&due, &later, &off, &noAddress} {
		require.NoError(t, DB.Create(s).Error)
	}
	require.NoError(t, DB.Model(&RivalSite{}).Where("id = ?", off.Id).Update("enabled", false).Error)

	first, err := ClaimRivalSitesDue(1000, 2800, 10)
	require.NoError(t, err)
	require.Len(t, first, 1)
	assert.Equal(t, "due", first[0].Slug)

	// A second server reading at the same moment finds nothing left.
	second, err := ClaimRivalSitesDue(1000, 2800, 10)
	require.NoError(t, err)
	assert.Empty(t, second)
}

func TestSaveRivalProbeRecordsChangesAfterTheFirstRead(t *testing.T) {
	clearRivalTables(t)
	site := RivalSite{Slug: "s", SiteURL: "https://s.example", Enabled: true}
	require.NoError(t, DB.Create(&site).Error)
	var err error

	first := RivalProbeResult{Status: RivalStatusOK, APIBase: "https://s.example", TopUpPrice: 1, Prices: []RivalPrice{
		{Model: "claude-opus-5-5", GroupName: "cc", GroupRatio: 2.5, InputCNY: rivalCNY(10)},
		{Model: "claude-opus-5-5", GroupName: "old", GroupRatio: 3, InputCNY: rivalCNY(12)},
	}}
	_, _, err = SaveRivalProbe(site.Id, first, 100, 200)
	require.NoError(t, err)
	var changes []RivalPriceChange
	require.NoError(t, DB.Find(&changes).Error)
	assert.Empty(t, changes, "a site's first read is its baseline")

	second := RivalProbeResult{Status: RivalStatusOK, APIBase: "https://s.example", TopUpPrice: 1, Prices: []RivalPrice{
		{Model: "claude-opus-5-5", GroupName: "cc", GroupRatio: 2.0, InputCNY: rivalCNY(8)},
		{Model: "claude-opus-5-5", GroupName: "new", GroupRatio: 1.5, InputCNY: rivalCNY(6)},
	}}
	_, _, err = SaveRivalProbe(site.Id, second, 300, 400)
	require.NoError(t, err)
	require.NoError(t, DB.Order("group_name").Find(&changes).Error)
	require.Len(t, changes, 3)
	kinds := map[string]string{}
	for _, c := range changes {
		kinds[c.GroupName] = c.Kind
		assert.Equal(t, site.Id, c.SiteId)
	}
	assert.Equal(t, map[string]string{"cc": RivalChangeChanged, "new": RivalChangeAdded, "old": RivalChangeRemoved}, kinds)

	var prices []RivalPrice
	require.NoError(t, DB.Where("site_id = ?", site.Id).Find(&prices).Error)
	assert.Len(t, prices, 2)

	// A failed probe keeps the last prices and only updates the status.
	_, _, err = SaveRivalProbe(site.Id, RivalProbeResult{Status: RivalStatusError, Error: "timeout"}, 500, 600)
	require.NoError(t, err)
	stored, err := GetRivalSite(site.Id)
	require.NoError(t, err)
	assert.Equal(t, RivalStatusError, stored.Status)
	assert.Equal(t, int64(300), stored.PricedAt)
	assert.Equal(t, int64(600), stored.NextCheckAt)
	require.NoError(t, DB.Where("site_id = ?", site.Id).Find(&prices).Error)
	assert.Len(t, prices, 2)
}

func TestDiffRivalPricesIgnoresRoundingNoise(t *testing.T) {
	old := []RivalPrice{{Model: "m", GroupName: "g", GroupRatio: 2.5, InputCNY: rivalCNY(10)}}
	same := []RivalPrice{{Model: "m", GroupName: "g", GroupRatio: 2.5, InputCNY: rivalCNY(10.0001)}}
	assert.Empty(t, DiffRivalPrices(old, same, 1))
	unknown := []RivalPrice{{Model: "m", GroupName: "g", GroupRatio: 2.5}}
	assert.Len(t, DiffRivalPrices(old, unknown, 1), 1, "losing the top-up price is a change")
}

func TestClaimRivalDirectorySyncOncePerInterval(t *testing.T) {
	clearRivalTables(t)
	ok, err := ClaimRivalDirectorySync(RivalSourceDirectory, 1000, 2000)
	require.NoError(t, err)
	assert.True(t, ok)
	ok, err = ClaimRivalDirectorySync(RivalSourceDirectory, 1500, 2500)
	require.NoError(t, err)
	assert.False(t, ok)
	ok, err = ClaimRivalDirectorySync(RivalSourceDirectory, 2000, 3000)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestSetRivalSiteDirectoryEntryRequeuesAMovedSite(t *testing.T) {
	clearRivalTables(t)
	added, err := UpsertRivalDirectorySlugs(map[string]string{"packyapi-com": "packyapi-com"})
	require.NoError(t, err)
	require.Equal(t, 1, added)
	added, err = UpsertRivalDirectorySlugs(map[string]string{"packyapi-com": "packyapi-com"})
	require.NoError(t, err)
	assert.Equal(t, 0, added)

	var site RivalSite
	require.NoError(t, DB.Where("slug = ?", "packyapi-com").First(&site).Error)
	require.NoError(t, SetRivalSiteDirectoryEntry(site.Id, "PackyCode", "https://www.packyapi.ai"))
	require.NoError(t, DB.Model(&RivalSite{}).Where("id = ?", site.Id).
		Updates(map[string]any{"api_base": "https://api.packyapi.ai", "next_check_at": 9999}).Error)

	require.NoError(t, SetRivalSiteDirectoryEntry(site.Id, "PackyCode", "https://www.packyapi.ai"))
	stored, _ := GetRivalSite(site.Id)
	assert.Equal(t, int64(9999), stored.NextCheckAt, "an unchanged address keeps its schedule")

	require.NoError(t, SetRivalSiteDirectoryEntry(site.Id, "PackyCode", "https://packy.example"))
	stored, _ = GetRivalSite(site.Id)
	assert.Equal(t, int64(0), stored.NextCheckAt)
	assert.Equal(t, "", stored.APIBase)
	assert.Equal(t, "https://packy.example", stored.SiteURL)
}

func TestSaveRivalProbeReturnsWhatItReplaced(t *testing.T) {
	clearRivalTables(t)
	site := RivalSite{Slug: "r", SiteURL: "https://r.example", Enabled: true}
	require.NoError(t, DB.Create(&site).Error)
	ok := func(input float64) RivalProbeResult {
		return RivalProbeResult{Status: RivalStatusOK, TopUpPrice: 1, Prices: []RivalPrice{
			{Model: "m", GroupName: "g", GroupRatio: 1, InputCNY: rivalCNY(input), CreateCacheRatio: rivalCNY(1.25)}}}
	}
	previous, baseline, err := SaveRivalProbe(site.Id, ok(10), 1, 2)
	require.NoError(t, err)
	assert.True(t, baseline)
	assert.Empty(t, previous)

	previous, baseline, err = SaveRivalProbe(site.Id, ok(8), 3, 4)
	require.NoError(t, err)
	assert.False(t, baseline)
	require.Len(t, previous, 1)
	assert.InDelta(t, 10, *previous[0].InputCNY, 1e-9)
	require.NotNil(t, previous[0].CreateCacheRatio)
}

func TestRivalTokenMixesReadOnlyHoursWithOutput(t *testing.T) {
	require.NoError(t, DB.Exec("DELETE FROM insight_model_hours").Error)
	rows := []InsightModelHour{
		{HourStart: 3600, ModelName: "claude-opus-5-5", Uncached: 10, CacheRead: 80, CacheWrite: 5, Output: 5},
		{HourStart: 7200, ModelName: "claude-opus-5-5", Uncached: 10, CacheRead: 80, CacheWrite: 5, Output: 5},
		// Stored before output was counted: left out, or its input would
		// count with no output beside it.
		{HourStart: 10800, ModelName: "claude-opus-5-5", Uncached: 1000, CacheRead: 0, CacheWrite: 0, Output: 0},
		// Before the range.
		{HourStart: 0, ModelName: "claude-opus-5-5", Uncached: 500, Output: 1},
	}
	require.NoError(t, DB.Create(&rows).Error)
	mixes, err := RivalTokenMixes(3600)
	require.NoError(t, err)
	assert.Equal(t, RivalTokenMix{Uncached: 20, CacheRead: 160, CacheWrite: 10, Output: 10}, mixes["claude-opus-5-5"])
}

func TestSetRivalGroupKindOverridesAndClears(t *testing.T) {
	require.NoError(t, DB.Exec("DELETE FROM rival_group_kinds").Error)
	require.NoError(t, SetRivalGroupKind(1, "svip", "pool", 1))
	require.NoError(t, SetRivalGroupKind(1, "svip", "official", 2))
	got, err := RivalGroupKindOverrides(1)
	require.NoError(t, err)
	assert.Equal(t, map[int]map[string]string{1: {"svip": "official"}}, got)
	require.NoError(t, SetRivalGroupKind(1, "svip", "", 3))
	got, err = RivalGroupKindOverrides()
	require.NoError(t, err)
	assert.Empty(t, got)
}

// The hourly rollup counts each model's output beside its input, so the
// rival board can weigh prices by what customers really send.
func TestInsightHourCountsModelOutput(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")
	claude := `{"cache_tokens":800,"cache_creation_tokens":50,"usage_semantic":"anthropic","claude":true}`
	require.NoError(t, LOG_DB.Create(&[]Log{
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 100, ModelName: "claude-opus-5-5", PromptTokens: 100, CompletionTokens: 40, Other: claude},
		{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 200, ModelName: "claude-opus-5-5", PromptTokens: 100, CompletionTokens: 60, Other: claude},
	}).Error)
	scope, err := loadInsightHourScope()
	require.NoError(t, err)
	got, err := computeInsightHour(hour, scope)
	require.NoError(t, err)
	row := got.models["claude-opus-5-5"].row
	assert.EqualValues(t, 100, row.Output)
	assert.EqualValues(t, 200, row.Uncached)
	assert.EqualValues(t, 1600, row.CacheRead)
	assert.EqualValues(t, 100, row.CacheWrite)
}
