package model

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedFlowQuotaData(t *testing.T, quotaData QuotaData) {
	t.Helper()
	require.NoError(t, DB.Create(&quotaData).Error)
}

func seedFlowLookupData(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.Create(&Channel{Id: 1, Name: "east"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 2, Name: "west"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 11, UserId: 1, Key: "sk-primary", Name: "primary"}).Error)
	require.NoError(t, DB.Create(&Token{Id: 22, UserId: 2, Key: "sk-backup", Name: "backup"}).Error)
	require.NoError(t, DB.Delete(&Token{Id: 11}).Error)
}

func TestGetFlowQuotaDataUsesQuotaDataRoleSpecificDimensions(t *testing.T) {
	truncateTables(t)
	seedFlowLookupData(t)

	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1000,
		Count:     2,
		Quota:     100,
		TokenUsed: 40,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 1,
		CreatedAt: 1100,
		Count:     1,
		Quota:     50,
		TokenUsed: 20,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		NodeName:  "node-a",
		TokenID:   11,
		UseGroup:  "vip",
		ModelName: "gpt-a",
		ChannelID: 2,
		CreatedAt: 1200,
		Count:     1,
		Quota:     25,
		TokenUsed: 10,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    2,
		Username:  "bob",
		NodeName:  "node-b",
		TokenID:   22,
		UseGroup:  "default",
		ModelName: "gpt-b",
		ChannelID: 1,
		CreatedAt: 1300,
		Count:     3,
		Quota:     70,
		TokenUsed: 30,
	})
	seedFlowQuotaData(t, QuotaData{
		UserID:    1,
		Username:  "alice",
		ModelName: "legacy",
		CreatedAt: 1400,
		Count:     99,
		Quota:     999,
		TokenUsed: 999,
	})

	rootRows, err := GetFlowQuotaData(900, 2000, "", 0, common.RoleRootUser)
	require.NoError(t, err)
	require.Len(t, rootRows, 3)
	// Token 11 was soft-deleted, so its name is intentionally left empty for the
	// frontend to render a localized "deleted (id)" label instead.
	require.Equal(t, FlowQuotaData{
		UserID:      1,
		Username:    "alice",
		NodeName:    "node-a",
		TokenID:     11,
		TokenName:   "",
		UseGroup:    "vip",
		ChannelID:   1,
		ChannelName: "east",
		ModelName:   "gpt-a",
		TokenUsed:   60,
		Count:       3,
		Quota:       150,
	}, *rootRows[0])
	// A token that still exists resolves to its current name.
	require.Equal(t, 22, rootRows[1].TokenID)
	require.Equal(t, "backup", rootRows[1].TokenName)

	adminRows, err := GetFlowQuotaData(900, 2000, "alice", 0, common.RoleAdminUser)
	require.NoError(t, err)
	require.Len(t, adminRows, 2)
	require.Equal(t, 0, adminRows[0].TokenID)
	require.Empty(t, adminRows[0].TokenName)
	require.Empty(t, adminRows[0].NodeName)
	require.Equal(t, "alice", adminRows[0].Username)
	require.Equal(t, "vip", adminRows[0].UseGroup)
	require.Equal(t, "east", adminRows[0].ChannelName)
	require.Equal(t, 150, adminRows[0].Quota)

	selfRows, err := GetFlowQuotaData(900, 2000, "", 1, common.RoleCommonUser)
	require.NoError(t, err)
	require.Len(t, selfRows, 1)
	require.Empty(t, selfRows[0].Username)
	require.Equal(t, 0, selfRows[0].ChannelID)
	require.Empty(t, selfRows[0].ChannelName)
	require.Empty(t, selfRows[0].TokenName)
	require.Equal(t, "vip", selfRows[0].UseGroup)
	require.Equal(t, 175, selfRows[0].Quota)
}

func TestLogQuotaDataSplitsRowsByUseGroupTokenChannelAndNode(t *testing.T) {
	truncateTables(t)
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()

	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3661,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     100,
		TokenUsed: 40,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "vip",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     50,
		TokenUsed: 20,
	})
	LogQuotaData(QuotaDataLogParams{
		UserID:    1,
		Username:  "alice",
		ModelName: "gpt-a",
		CreatedAt: 3700,
		UseGroup:  "default",
		TokenID:   11,
		ChannelID: 1,
		NodeName:  "node-a",
		Quota:     25,
		TokenUsed: 10,
	})

	SaveQuotaDataCache()

	var rows []QuotaData
	require.NoError(t, DB.Order("quota DESC").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, int64(3600), rows[0].CreatedAt)
	require.Equal(t, "vip", rows[0].UseGroup)
	require.Equal(t, 11, rows[0].TokenID)
	require.Equal(t, 1, rows[0].ChannelID)
	require.Equal(t, "node-a", rows[0].NodeName)
	require.Equal(t, 2, rows[0].Count)
	require.Equal(t, 150, rows[0].Quota)
	require.Equal(t, 60, rows[0].TokenUsed)
	require.Equal(t, "default", rows[1].UseGroup)
	require.Equal(t, 25, rows[1].Quota)
}

// quotaDataCallback runs fn before every query or create on quota_data until
// the test ends.
func quotaDataCallback(t *testing.T, name string, fn func(tx *gorm.DB)) {
	t.Helper()
	onQuotaData := func(tx *gorm.DB) {
		if tx.Statement.Table == "quota_data" {
			fn(tx)
		}
	}
	require.NoError(t, DB.Callback().Query().Before("gorm:query").Register(name, onQuotaData))
	require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(name, onQuotaData))
	t.Cleanup(func() {
		require.NoError(t, DB.Callback().Query().Remove(name))
		require.NoError(t, DB.Callback().Create().Remove(name))
	})
}

func resetQuotaDataCache() {
	CacheQuotaDataLock.Lock()
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()
}

func TestSaveQuotaDataCacheLetsAccountingContinueDuringTheWrite(t *testing.T) {
	truncateTables(t)
	resetQuotaDataCache()
	t.Cleanup(resetQuotaDataCache)
	usage := QuotaDataLogParams{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: common.GetTimestamp(), Quota: 100, TokenUsed: 10}
	LogQuotaData(usage)

	writing := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	quotaDataCallback(t, "test:hold_quota_data_write", func(*gorm.DB) {
		once.Do(func() {
			close(writing)
			<-release
		})
	})
	flushed := make(chan struct{})
	go func() {
		SaveQuotaDataCache()
		close(flushed)
	}()
	<-writing

	logged := make(chan struct{})
	go func() {
		LogQuotaData(usage)
		close(logged)
	}()
	select {
	case <-logged:
	case <-time.After(5 * time.Second):
		close(release)
		<-flushed
		<-logged
		t.Fatal("LogQuotaData waited for the database write")
	}
	close(release)
	<-flushed

	SaveQuotaDataCache()
	var rows []QuotaData
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, 2, rows[0].Count)
	require.Equal(t, 200, rows[0].Quota)
}

func TestSaveQuotaDataCacheKeepsARowThatFailedToWrite(t *testing.T) {
	truncateTables(t)
	resetQuotaDataCache()
	t.Cleanup(resetQuotaDataCache)
	usage := QuotaDataLogParams{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: common.GetTimestamp(), Quota: 100, TokenUsed: 10, CacheReadTokens: 5}
	LogQuotaData(usage)

	failing := true
	quotaDataCallback(t, "test:fail_quota_data_write", func(tx *gorm.DB) {
		if failing {
			_ = tx.AddError(errors.New("database unavailable"))
		}
	})
	SaveQuotaDataCache()
	failing = false
	var count int64
	require.NoError(t, DB.Table("quota_data").Count(&count).Error)
	require.Zero(t, count)

	// Usage that arrives before the next flush adds to the kept row.
	LogQuotaData(usage)
	SaveQuotaDataCache()

	var rows []QuotaData
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, 2, rows[0].Count)
	require.Equal(t, 200, rows[0].Quota)
	require.Equal(t, 20, rows[0].TokenUsed)
	require.EqualValues(t, 10, rows[0].CacheReadTokens)
	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	require.Empty(t, CacheQuotaData)
}

func TestSaveQuotaDataCacheDropsAFailedRowOlderThanADay(t *testing.T) {
	truncateTables(t)
	resetQuotaDataCache()
	t.Cleanup(resetQuotaDataCache)
	now := common.GetTimestamp()
	LogQuotaData(QuotaDataLogParams{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: now, Quota: 100})
	LogQuotaData(QuotaDataLogParams{UserID: 1, Username: "alice", ModelName: "gpt-a", CreatedAt: now - 2*24*60*60, Quota: 50})

	quotaDataCallback(t, "test:fail_quota_data_write", func(tx *gorm.DB) {
		_ = tx.AddError(errors.New("database unavailable"))
	})
	SaveQuotaDataCache()

	CacheQuotaDataLock.Lock()
	defer CacheQuotaDataLock.Unlock()
	require.Len(t, CacheQuotaData, 1)
	for _, row := range CacheQuotaData {
		require.Equal(t, 100, row.Quota)
	}
}
