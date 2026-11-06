package model

// CoreCode: a token carries UpstreamKey (N1). cacheInitToken passes it as
// ARGV[17], ahead of the arguments upstream appends after AllowUserQuotaQuery,
// and the cache MAC names it because it is json:"-" on Token.

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTokenCacheCarriesAndVerifiesUpstreamKey(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousType := DB, common.MainDatabaseType()
	DB = db
	common.SetMainDatabaseType(common.DatabaseType("sqlite"))
	initCol()
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		initCol()
		assert.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}))
	useUserCacheMiniRedis(t)

	user := User{Username: "upstream-key-user", AffCode: "upstream-key", Role: common.RoleCommonUser,
		Status: common.UserStatusEnabled, AuthVersion: 1, Group: "default", Quota: 100}
	require.NoError(t, DB.Create(&user).Error)
	token := Token{UserId: user.Id, Key: "upstream-key-token", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: 100, Group: "default", UpstreamKey: "sk-upstream", AllowUserQuotaQuery: true}
	require.NoError(t, DB.Create(&token).Error)

	_, err = GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, "sk-upstream", cached.UpstreamKey)
	assert.True(t, cached.AllowUserQuotaQuery)
	assert.Equal(t, 100, cached.RemainQuota)
	ttl, err := common.RDB.TTL(t.Context(), getTokenCacheKey(token.Key)).Result()
	require.NoError(t, err)
	assert.Equal(t, float64(tokenCacheTTLSeconds()), ttl.Seconds())

	// A changed UpstreamKey fails verification, and the next read restores it
	// from the database.
	require.NoError(t, common.RDB.HSet(t.Context(), getTokenCacheKey(token.Key), "UpstreamKey", "sk-other").Err())
	_, err = cacheGetTokenByKey(token.Key)
	require.Error(t, err)
	_, err = GetTokenByKey(token.Key, false)
	require.NoError(t, err)
	cached, err = cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, "sk-upstream", cached.UpstreamKey)
	assert.True(t, cached.AllowUserQuotaQuery)
}
