package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// useTermsConsentTestDB points the model at a fresh consent table on dialect.
// MySQL and PostgreSQL run when TEST_MYSQL_DSN or TEST_POSTGRES_DSN names an
// empty database.
func useTermsConsentTestDB(t *testing.T, dialect string) *gorm.DB {
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

	previousDB := model.DB
	model.DB = db
	require.False(t, db.Migrator().HasTable(&model.UserTermsConsent{}), "use an empty test database")
	require.NoError(t, db.AutoMigrate(&model.UserTermsConsent{}))
	// A second migration must find nothing to change.
	require.NoError(t, db.AutoMigrate(&model.UserTermsConsent{}))

	legal := system_setting.GetLegalSettings()
	previousVersion := legal.TermsVersion
	t.Cleanup(func() {
		legal.TermsVersion = previousVersion
		require.NoError(t, db.Migrator().DropTable(&model.UserTermsConsent{}))
		model.DB = previousDB
		require.NoError(t, sqlDB.Close())
	})
	return db
}

func postTermsConsent(t *testing.T, body string, userId int) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/user/terms/consent", strings.NewReader(body))
	c.Request.Header.Set("User-Agent", "terms-test/1.0")
	c.Request.RemoteAddr = "203.0.113.7:4321"
	c.Set("id", userId)
	AcceptTermsConsent(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response map[string]any
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestAcceptTermsConsent(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			db := useTermsConsentTestDB(t, dialect)
			legal := system_setting.GetLegalSettings()
			countRows := func() int64 {
				var count int64
				require.NoError(t, db.Model(&model.UserTermsConsent{}).Count(&count).Error)
				return count
			}

			legal.TermsVersion = ""
			response := postTermsConsent(t, `{"version":"2026-11-07"}`, 21)
			assert.Equal(t, false, response["success"], "no terms are configured")
			assert.Equal(t, "", acceptedTermsVersion(21))

			legal.TermsVersion = "2026-11-07"
			response = postTermsConsent(t, `{"version":"2026-11-04"}`, 21)
			assert.Equal(t, false, response["success"], "a stale version is refused")
			response = postTermsConsent(t, `not json`, 21)
			assert.Equal(t, false, response["success"])
			assert.Equal(t, int64(0), countRows())
			assert.Equal(t, "", acceptedTermsVersion(21))

			response = postTermsConsent(t, `{"version":"2026-11-07"}`, 21)
			require.Equal(t, true, response["success"], response["message"])
			var consent model.UserTermsConsent
			require.NoError(t, db.First(&consent, "user_id = ?", 21).Error)
			assert.Equal(t, "2026-11-07", consent.Version)
			assert.Equal(t, "203.0.113.7", consent.Ip)
			assert.Equal(t, "terms-test/1.0", consent.UserAgent)
			assert.NotZero(t, consent.AcceptedAt)
			assert.Equal(t, "2026-11-07", acceptedTermsVersion(21))
			assert.Equal(t, "", acceptedTermsVersion(22), "another customer has not accepted")

			require.NoError(t, db.Model(&consent).Update("accepted_at", 1).Error)
			response = postTermsConsent(t, `{"version":"2026-11-07"}`, 21)
			require.Equal(t, true, response["success"], "accepting again succeeds")
			assert.Equal(t, int64(1), countRows(), "accepting again adds no row")
			require.NoError(t, db.First(&consent, "user_id = ?", 21).Error)
			assert.Equal(t, int64(1), consent.AcceptedAt, "the first acceptance stays the evidence")

			legal.TermsVersion = "2026-12-01"
			assert.Equal(t, "", acceptedTermsVersion(21), "new terms ask again")
		})
	}
}
