package model

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func beijingTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.ParseInLocation("2006-01-02 15:04:05", value, beijing)
	require.NoError(t, err)
	return parsed
}

func TestNextBeijingMidnight(t *testing.T) {
	for _, tc := range []struct{ now, want string }{
		{"2026-11-12 00:00:00", "2026-11-13 00:00:00"},
		{"2026-11-12 23:59:59", "2026-11-13 00:00:00"},
		{"2026-12-31 08:00:00", "2027-01-01 00:00:00"},
	} {
		assert.Equal(t, beijingTime(t, tc.want).Unix(), nextBeijingMidnight(beijingTime(t, tc.now)), tc.now)
	}
	// 15:59:59 UTC is 23:59:59 in Beijing, whatever the server's zone.
	assert.Equal(t, beijingTime(t, "2026-11-13 00:00:00").Unix(),
		nextBeijingMidnight(time.Date(2026, 11, 12, 15, 59, 59, 0, time.UTC)))
}

// MySQL evaluates SET left to right, so today's use must be assigned before
// the day it belongs to, or the CASE would compare against the new day.
func TestTokenQuotaUpdatesAssignTodaysUseBeforeItsDay(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{SkipInitializeWithVersion: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true, SkipDefaultTransaction: true})
	require.NoError(t, err)
	result := db.Model(&Token{}).Where("id = ?", 1).Updates(tokenQuotaUpdates(5, time.Now()))
	require.NoError(t, result.Error)
	sql := result.Statement.SQL.String()
	quota, until := strings.Index(sql, "`daily_used_quota`="), strings.Index(sql, "`daily_used_until`=")
	require.Positive(t, quota, sql)
	require.Positive(t, until, sql)
	assert.Less(t, quota, until, sql)
}

// The daily counter adds within a Beijing day, starts over on the next one,
// and a refund that crosses midnight cannot push it below zero.
func TestTokenQuotaUpdatesTrackTodaysUseAcrossDatabases(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
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
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "daily_quota_test_"}})
			require.NoError(t, err)
			require.NoError(t, db.Migrator().DropTable(&Token{}))
			require.NoError(t, db.AutoMigrate(&Token{}))
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(&Token{}))
				if sqlDB, err := db.DB(); err == nil {
					assert.NoError(t, sqlDB.Close())
				}
			})
			token := Token{UserId: 1, Key: "daily-quota-key", Name: "daily", Status: 1, ExpiredTime: -1, RemainQuota: 1000}
			require.NoError(t, db.Create(&token).Error)

			day1 := beijingTime(t, "2026-11-12 10:00:00")
			day2 := beijingTime(t, "2026-11-13 00:00:01")
			day3 := beijingTime(t, "2026-11-14 09:00:00")
			for _, step := range []struct {
				name           string
				delta          int
				now            time.Time
				wantDailyUsed  int
				wantRemain     int
				wantTotalsUsed int
			}{
				{"a charge", 100, day1, 100, 900, 100},
				{"a refund the same day", -30, day1, 70, 930, 70},
				{"the next day starts over", 50, day2, 50, 880, 120},
				{"a refund larger than the day's use", -80, day2, -30, 960, 40},
				{"a refund on a later day", -20, day3, 0, 980, 20},
			} {
				require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Updates(tokenQuotaUpdates(step.delta, step.now)).Error, step.name)
				var saved Token
				require.NoError(t, db.First(&saved, token.Id).Error)
				assert.Equal(t, step.wantDailyUsed, saved.DailyUsedQuota, step.name)
				assert.Equal(t, nextBeijingMidnight(step.now), saved.DailyUsedUntil, step.name)
				assert.Equal(t, step.wantRemain, saved.RemainQuota, step.name)
				assert.Equal(t, step.wantTotalsUsed, saved.UsedQuota, step.name)
			}
		})
	}
}

func TestTokenDailyUsedFollowsQuotaWrites(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)

	token := createReserveTestToken(t, 1000)
	now := time.Now()
	used, err := TokenDailyUsed(token.Id, now)
	require.NoError(t, err)
	assert.Zero(t, used, "a new token has used nothing today")

	reserved, err := TryReserveTokenQuota(token.Id, token.Key, 300, false)
	require.NoError(t, err)
	require.True(t, reserved)
	require.NoError(t, IncreaseTokenQuota(token.Id, token.Key, 100))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 50))
	used, err = TokenDailyUsed(token.Id, now)
	require.NoError(t, err)
	assert.Equal(t, 250, used)

	used, err = TokenDailyUsed(token.Id, now.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Zero(t, used, "tomorrow starts from zero")
}

// The cap is metadata: changing it must invalidate a cached token, while
// today's use is never part of the cache.
func TestTokenCacheMACCoversDailyQuotaNotDailyUse(t *testing.T) {
	token := Token{Id: 1, Key: "mac-key", DailyQuota: 100}
	base, err := token.cacheMAC()
	require.NoError(t, err)

	capped := token
	capped.DailyQuota = 200
	changed, err := capped.cacheMAC()
	require.NoError(t, err)
	assert.NotEqual(t, base, changed)

	used := token
	used.DailyUsedQuota, used.DailyUsedUntil = 50, 1
	same, err := used.cacheMAC()
	require.NoError(t, err)
	assert.Equal(t, base, same)
}

// Token auth reads the cap from the Redis cache, so the cache must carry it,
// and a hash written before the field existed must fail verification.
func TestTokenCacheCarriesDailyQuota(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	useUserCacheMiniRedis(t)

	token := createReserveTestToken(t, 1000)
	require.NoError(t, DB.Model(&token).Update("daily_quota", 300).Error)
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 40))
	_, err := GetTokenByKey(token.Key, true)
	require.NoError(t, err)
	_, err = GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 300, cached.DailyQuota)
	assert.Zero(t, cached.DailyUsedQuota, "today's use is read from the database")

	require.NoError(t, common.RDB.HDel(t.Context(), getTokenCacheKey(token.Key), "DailyQuota").Err())
	_, err = cacheGetTokenByKey(token.Key)
	assert.Error(t, err, "a hash without the cap fails verification")
}
