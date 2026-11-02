package model

import (
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestTopUpBonusTiers(t *testing.T) {
	setting := operation_setting.GetPaymentSetting()
	previous := setting.AmountBonus
	t.Cleanup(func() { setting.AmountBonus = previous })

	// Tiers load from the option row the console saves.
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"payment_setting.amount_bonus": `{"300":0.05,"1000":0.1,"2000":0.15}`,
	}))
	for _, tc := range []struct {
		amount int64
		rate   float64
	}{
		{299, 0},
		{300, 0.05},
		{999, 0.05},
		{1000, 0.1},
		{1200, 0.1},
		{2000, 0.15},
		{50000, 0.15},
	} {
		assert.Equal(t, tc.rate, operation_setting.TopUpBonusRate(tc.amount), "amount %d", tc.amount)
	}

	for value, valid := range map[string]bool{
		``:                        false,
		`{}`:                      true,
		`{"300":0.05,"1000":1}`:   true,
		`{"300":0}`:               false,
		`{"300":1.5}`:             false,
		`{"0":0.1}`:               false,
		`{"1.5":0.1}`:             false,
		`{"300":"0.05"}`:          false,
		`[{"amount":300}]`:        false,
		`{"300":-0.05,"500":0.1}`: false,
	} {
		err := operation_setting.ValidateAmountBonus(value)
		assert.Equal(t, valid, err == nil, "%s: %v", value, err)
	}
}

func TestEpayTopUpBonusDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := openTopUpBonusTestDB(t, dialect)
			previousQuotaPerUnit := common.QuotaPerUnit
			common.QuotaPerUnit = 500000
			t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })

			user := &User{Username: "bonus_customer", Status: common.UserStatusEnabled, Quota: 7}
			require.NoError(t, db.Create(user).Error)
			quota := func() int {
				var row User
				require.NoError(t, db.Select("quota").First(&row, user.Id).Error)
				return row.Quota
			}

			// A ¥1000 order fixed at a 10% bonus credits 1000 + 100 once.
			paid := &TopUp{UserId: user.Id, Amount: 1000, Money: 1000, TradeNo: "BONUS-EPAY", PaymentMethod: "alipay",
				PaymentProvider: PaymentProviderEpay, BonusQuota: 100 * 500000, Status: common.TopUpStatusPending}
			require.NoError(t, db.Create(paid).Error)
			alreadyDone, err := RechargeEpay(paid.TradeNo, "alipay", "127.0.0.1")
			require.NoError(t, err)
			assert.False(t, alreadyDone)
			assert.Equal(t, 7+1100*500000, quota())
			alreadyDone, err = RechargeEpay(paid.TradeNo, "alipay", "127.0.0.1")
			require.NoError(t, err)
			assert.True(t, alreadyDone, "a repeated callback credits nothing")
			assert.Equal(t, 7+1100*500000, quota())
			stored := GetTopUpByTradeNo(paid.TradeNo)
			require.NotNil(t, stored)
			assert.EqualValues(t, 100*500000, stored.BonusQuota, "the bonus stays on the order apart from what was paid")

			// An administrator completing an order credits its bonus too.
			manual := &TopUp{UserId: user.Id, Amount: 300, Money: 300, TradeNo: "BONUS-MANUAL", PaymentMethod: "wxpay",
				PaymentProvider: PaymentProviderEpay, BonusQuota: 15 * 500000, Status: common.TopUpStatusPending}
			require.NoError(t, db.Create(manual).Error)
			require.NoError(t, ManualCompleteTopUp(manual.TradeNo, "127.0.0.1"))
			assert.Equal(t, 7+1415*500000, quota())

			// An order without a bonus credits exactly what was paid.
			plain := &TopUp{UserId: user.Id, Amount: 50, Money: 50, TradeNo: "BONUS-NONE", PaymentMethod: "alipay",
				PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
			require.NoError(t, db.Create(plain).Error)
			_, err = RechargeEpay(plain.TradeNo, "alipay", "127.0.0.1")
			require.NoError(t, err)
			assert.Equal(t, 7+1465*500000, quota())

			var messages []string
			require.NoError(t, db.Model(&Log{}).Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).Order("id").Pluck("content", &messages).Error)
			require.Len(t, messages, 3)
			assert.Contains(t, messages[0], "including a bonus of")
			assert.Contains(t, messages[1], "including a bonus of")
			assert.NotContains(t, messages[2], "bonus")
		})
	}
}

// openTopUpBonusTestDB points the model at an empty database of the dialect,
// with the tables a top-up touches.
func openTopUpBonusTestDB(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	var driver gorm.Dialector
	connections := 4
	switch dialect {
	case "sqlite":
		driver = sqlite.Open(":memory:")
		connections = 1
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
	sqlDB.SetMaxOpenConns(connections)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database version: %s", version)
	previousDB, previousLogDB := DB, LOG_DB
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	DB, LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled = false
	initCol()
	tables := []any{&User{}, &TopUp{}, &Log{}}
	for _, table := range tables {
		require.False(t, db.Migrator().HasTable(table), "use an empty test database")
	}
	require.NoError(t, db.AutoMigrate(tables...))
	t.Cleanup(func() {
		require.NoError(t, db.Migrator().DropTable(tables...))
		DB, LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMain, previousLog)
		common.RedisEnabled = previousRedis
		initCol()
	})
	return db
}

func TestTopUpBonusCampaign(t *testing.T) {
	setting := operation_setting.GetPaymentSetting()
	previous := setting.BonusCampaign
	t.Cleanup(func() { setting.BonusCampaign = previous })

	// The headline loads from the option row, and an empty row clears it, so
	// writing "" at the end of a sale removes the wallet banner.
	headline := "双 11 特惠：单笔 ¥10 起送 11%，最高送 18%"
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"payment_setting.bonus_campaign": headline,
	}))
	assert.Equal(t, headline, setting.BonusCampaign)
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"payment_setting.bonus_campaign": "",
	}))
	assert.Equal(t, "", setting.BonusCampaign)

	assert.NoError(t, operation_setting.ValidateBonusCampaign(""))
	assert.NoError(t, operation_setting.ValidateBonusCampaign(strings.Repeat("双", operation_setting.MaxBonusCampaignLength)))
	assert.Error(t, operation_setting.ValidateBonusCampaign(strings.Repeat("双", operation_setting.MaxBonusCampaignLength+1)))
}
