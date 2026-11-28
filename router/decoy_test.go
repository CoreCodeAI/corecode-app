package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// useEmptyDatabase gives credential lookups an empty database, and no Redis,
// to miss in.
func useEmptyDatabase(t *testing.T) {
	t.Helper()
	previous, redis := model.DB, common.RedisEnabled
	common.RedisEnabled = false
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Token{}, &model.UserAccessToken{}))
	model.DB = database
	t.Cleanup(func() { model.DB, common.RedisEnabled = previous, redis })
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	common.LogWriterMu.Lock()
	saved := gin.DefaultWriter
	gin.DefaultWriter = &buf
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultWriter = saved
		common.LogWriterMu.Unlock()
	})
	return &buf
}

func decoyLines(log string) []string {
	var lines []string
	for _, line := range strings.Split(log, "\n") {
		if _, event, ok := strings.Cut(line, "| decoy "); ok {
			lines = append(lines, strings.TrimSpace(event))
		}
	}
	return lines
}

func TestDecoyRouteIsLoggedAndRefusedLikeAnAdminRoute(t *testing.T) {
	engine := newAccessTokenScopeTestEngine(t)
	log := captureLog(t)

	req := httptest.NewRequest(http.MethodPost, "/api/internal/quota/grant?user=5433", strings.NewReader(`{"user_id":5433,"quota":500000000}`))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "36.112.10.9:51000"
	req.Header.Set("User-Agent", "python-requests/2.32")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, req)

	assert.Equal(t, http.StatusUnauthorized, recorder.Code)
	lines := decoyLines(log.String())
	require.Len(t, lines, 1, log.String())
	var event map[string]any
	require.NoError(t, common.UnmarshalJsonStr(lines[0], &event))
	assert.Equal(t, "route", event["kind"])
	assert.Equal(t, "36.112.10.9", event["ip"])
	assert.Equal(t, "POST", event["method"])
	assert.Equal(t, "/api/internal/quota/grant", event["path"])
	assert.Equal(t, "user=5433", event["query"])
	assert.Equal(t, `{"user_id":5433,"quota":500000000}`, event["body"])
	assert.Equal(t, "python-requests/2.32", event["ua"])
	assert.EqualValues(t, http.StatusUnauthorized, event["status"])
}

func TestDecoyCredentialIsLoggedOnTheConsoleAndTheRelay(t *testing.T) {
	useEmptyDatabase(t)
	engine := newAccessTokenScopeTestEngine(t)
	for _, tc := range []struct{ path, header, value string }{
		{"/api/user/self", "Authorization", "Bearer " + middleware.DecoyCredentials[0]},
		{"/v1/models", "Authorization", "Bearer " + middleware.DecoyCredentials[1]},
		{"/v1/messages", "X-Api-Key", middleware.DecoyCredentials[1]},
	} {
		log := captureLog(t)
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		req.Header.Set(tc.header, tc.value)
		engine.ServeHTTP(httptest.NewRecorder(), req)
		lines := decoyLines(log.String())
		require.Len(t, lines, 1, tc.path)
		assert.Contains(t, lines[0], `"kind":"credential"`, tc.path)
		assert.Contains(t, lines[0], `"path":"`+tc.path+`"`, tc.path)
	}
}

func TestOrdinaryRequestsLogNoDecoy(t *testing.T) {
	useEmptyDatabase(t)
	engine := newAccessTokenScopeTestEngine(t)
	log := captureLog(t)
	for _, path := range []string{"/api/status", "/api/user/self", "/api/nonexistent"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer sk-anOrdinaryKeyThatIsNotADecoy")
		engine.ServeHTTP(httptest.NewRecorder(), req)
	}
	assert.Empty(t, decoyLines(log.String()))
}

// The console bundle has to carry what the server watches for, or nothing
// will ever take the bait.
func TestDecoyCredentialsAreInTheBundle(t *testing.T) {
	source, err := os.ReadFile("../web/src/lib/operator-tools.ts")
	require.NoError(t, err)
	for _, credential := range middleware.DecoyCredentials {
		assert.Contains(t, string(source), "'"+credential+"'")
	}
	for _, path := range []string{"quota/grant", "topup/credit", "redemption/issue", "config/export"} {
		assert.Contains(t, string(source), "'/api/internal/"+path+"'")
	}
}
