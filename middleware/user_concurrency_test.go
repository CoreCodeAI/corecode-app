package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// userConcurrencyRouter serves /:user/:token/:group; each request holds its
// slot until release is closed, after signalling on started.
func userConcurrencyRouter(release <-chan struct{}, started chan<- struct{}) *gin.Engine {
	router := gin.New()
	router.GET("/:user/:token/:group", func(c *gin.Context) {
		userID, _ := strconv.Atoi(c.Param("user"))
		tokenID, _ := strconv.Atoi(c.Param("token"))
		c.Set(string(constant.ContextKeyUserId), userID)
		c.Set(string(constant.ContextKeyTokenId), tokenID)
		common.SetContextKey(c, constant.ContextKeyUserGroup, c.Param("group"))
	}, UserConcurrencyLimit(), func(c *gin.Context) {
		started <- struct{}{}
		<-release
		c.Status(http.StatusOK)
	})
	return router
}

// withoutConcurrencyTiers clears the paid-total tiers for a test of the
// group and per-user limits.
func withoutConcurrencyTiers(t *testing.T) {
	setting := operation_setting.GetTokenSetting()
	previous := setting.ConcurrencyTiers
	setting.ConcurrencyTiers = nil
	t.Cleanup(func() { setting.ConcurrencyTiers = previous })
}

func TestUserConcurrencyLimit(t *testing.T) {
	require.NoError(t, i18n.Init())
	withoutConcurrencyTiers(t)
	setting := operation_setting.GetTokenSetting()
	previous := setting.ConcurrencyLimits
	setting.ConcurrencyLimits = map[string]int{"default": 2}
	t.Cleanup(func() { setting.ConcurrencyLimits = previous })

	release := make(chan struct{})
	started := make(chan struct{}, 8)
	router := userConcurrencyRouter(release, started)
	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}

	// Requests on two of user 1's tokens fill the user's two slots, so a third
	// token of the same user is rejected.
	var inFlight sync.WaitGroup
	for _, path := range []string{"/1/10/default", "/1/11/default"} {
		inFlight.Go(func() { assert.Equal(t, http.StatusOK, get(path).Code) })
		<-started
	}

	rejected := get("/1/12/default")
	assert.Equal(t, http.StatusTooManyRequests, rejected.Code)
	assert.Equal(t, "1", rejected.Header().Get("Retry-After"))

	assert.Equal(t, 2, UserConcurrencySnapshot()[1])
	userRequestsInFlight.Lock()
	var buffered int64
	for key, count := range userRequestsInFlight.rejected {
		if key.UserId == 1 {
			buffered += count
		}
	}
	userRequestsInFlight.Unlock()
	assert.Positive(t, buffered, "the 429 waits in the buffer for the database")

	// Another user, and a group without a limit, are not affected.
	inFlight.Go(func() { assert.Equal(t, http.StatusOK, get("/2/20/default").Code) })
	<-started
	inFlight.Go(func() { assert.Equal(t, http.StatusOK, get("/3/30/vip").Code) })
	<-started

	// Finished requests free their slots.
	close(release)
	inFlight.Wait()
	userRequestsInFlight.Lock()
	assert.Empty(t, userRequestsInFlight.counts)
	userRequestsInFlight.Unlock()
	inFlight.Go(func() { assert.Equal(t, http.StatusOK, get("/1/10/default").Code) })
	<-started
	inFlight.Wait()
}

// Billing reads the limit to scale its trust threshold (service.BillingSession).
func TestUserConcurrencyLimitInContext(t *testing.T) {
	require.NoError(t, i18n.Init())
	withoutConcurrencyTiers(t)
	setting := operation_setting.GetTokenSetting()
	previous := setting.ConcurrencyLimits
	setting.ConcurrencyLimits = map[string]int{"default": 4}
	t.Cleanup(func() { setting.ConcurrencyLimits = previous })

	router := gin.New()
	router.GET("/:user/:group", func(c *gin.Context) {
		userID, _ := strconv.Atoi(c.Param("user"))
		c.Set(string(constant.ContextKeyUserId), userID)
		common.SetContextKey(c, constant.ContextKeyUserGroup, c.Param("group"))
	}, UserConcurrencyLimit(), func(c *gin.Context) {
		c.String(http.StatusOK, strconv.Itoa(common.GetContextKeyInt(c, constant.ContextKeyUserConcurrencyLimit)))
	})
	for path, want := range map[string]string{"/41/default": "4", "/42/vip": "0"} {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		assert.Equal(t, want, recorder.Body.String(), path)
	}
}

func TestUserConcurrencyOverride(t *testing.T) {
	require.NoError(t, i18n.Init())
	withoutConcurrencyTiers(t)
	setting := operation_setting.GetTokenSetting()
	previousGroups, previousUsers := setting.ConcurrencyLimits, setting.UserConcurrencyLimits
	// User 7 may run three at once despite the group's one; user 8 is unlimited.
	setting.ConcurrencyLimits = map[string]int{"default": 1}
	setting.UserConcurrencyLimits = map[string]int{"7": 3, "8": 0}
	t.Cleanup(func() { setting.ConcurrencyLimits, setting.UserConcurrencyLimits = previousGroups, previousUsers })

	release := make(chan struct{})
	started := make(chan struct{}, 16)
	router := userConcurrencyRouter(release, started)
	get := func(path string) int {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder.Code
	}
	var inFlight sync.WaitGroup
	for _, path := range []string{"/7/1/default", "/7/2/default", "/7/3/default", "/8/1/default", "/8/2/default", "/9/1/default"} {
		inFlight.Go(func() { assert.Equal(t, http.StatusOK, get(path)) })
		<-started
	}
	assert.Equal(t, http.StatusTooManyRequests, get("/7/4/default"), "the override is the cap")
	assert.Equal(t, http.StatusTooManyRequests, get("/9/2/default"), "users without an override keep the group limit")
	close(release)
	inFlight.Wait()
}

func TestEffectiveUserConcurrencyLimit(t *testing.T) {
	setting := operation_setting.GetTokenSetting()
	previousGroups, previousUsers, previousTiers := setting.ConcurrencyLimits, setting.UserConcurrencyLimits, setting.ConcurrencyTiers
	setting.ConcurrencyLimits = map[string]int{"default": 5, "vip": 15, "free": 0}
	setting.UserConcurrencyLimits = map[string]int{"7": 20, "8": 0}
	setting.ConcurrencyTiers = []operation_setting.ConcurrencyTier{{MinPaid: 2000, Limit: 20}, {MinPaid: 1000, Limit: 10}}
	t.Cleanup(func() {
		setting.ConcurrencyLimits, setting.UserConcurrencyLimits, setting.ConcurrencyTiers = previousGroups, previousUsers, previousTiers
	})
	paid := func(amount float64) func() float64 { return func() float64 { return amount } }
	unread := func() float64 { t.Fatal("an override needs no paid total"); return 0 }

	for _, c := range []struct {
		name   string
		user   int
		group  string
		paid   func() float64
		limit  int
		source string
	}{
		{"an override wins", 7, "default", unread, 20, operation_setting.ConcurrencySourceUser},
		{"an override of 0 lifts the limit", 8, "default", unread, 0, operation_setting.ConcurrencySourceUser},
		{"below the first tier", 9, "default", paid(999.99), 5, operation_setting.ConcurrencySourceGroup},
		{"the first tier", 9, "default", paid(1000), 10, operation_setting.ConcurrencySourceTier},
		{"the highest tier reached", 9, "default", paid(5000), 20, operation_setting.ConcurrencySourceTier},
		{"a group limit above the tier", 9, "vip", paid(1000), 15, operation_setting.ConcurrencySourceGroup},
		{"an unlimited group stays unlimited", 9, "free", paid(5000), 0, operation_setting.ConcurrencySourceGroup},
	} {
		limit, source := operation_setting.EffectiveUserConcurrencyLimit(c.user, c.group, c.paid)
		assert.Equal(t, c.limit, limit, c.name)
		assert.Equal(t, c.source, source, c.name)
	}

	next, ok := operation_setting.NextConcurrencyTier(500, 5)
	assert.True(t, ok)
	assert.Equal(t, operation_setting.ConcurrencyTier{MinPaid: 1000, Limit: 10}, next)
	next, ok = operation_setting.NextConcurrencyTier(1500, 10)
	assert.True(t, ok)
	assert.Equal(t, 20, next.Limit)
	_, ok = operation_setting.NextConcurrencyTier(2500, 20)
	assert.False(t, ok, "past the last tier")
}

func TestUserConcurrencyTierMessage(t *testing.T) {
	require.NoError(t, i18n.Init())
	setting := operation_setting.GetTokenSetting()
	previousGroups, previousTiers := setting.ConcurrencyLimits, setting.ConcurrencyTiers
	setting.ConcurrencyLimits = map[string]int{"default": 1}
	setting.ConcurrencyTiers = []operation_setting.ConcurrencyTier{{MinPaid: 1000, Limit: 2}}
	previousPaid := userPaidMoney
	userPaidMoney = func(userID int) float64 { return map[int]float64{1: 250.5, 2: 1000}[userID] }
	t.Cleanup(func() {
		setting.ConcurrencyLimits, setting.ConcurrencyTiers = previousGroups, previousTiers
		userPaidMoney = previousPaid
	})

	release := make(chan struct{})
	started := make(chan struct{}, 8)
	router := userConcurrencyRouter(release, started)
	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}
	var inFlight sync.WaitGroup
	for _, path := range []string{"/1/1/default", "/2/1/default", "/2/2/default"} {
		inFlight.Go(func() { assert.Equal(t, http.StatusOK, get(path).Code) })
		<-started
	}
	below := get("/1/2/default")
	assert.Equal(t, http.StatusTooManyRequests, below.Code)
	assert.Contains(t, below.Body.String(), "Top up 749.5 more in total to raise the limit to 2", "a user below the tier is told how far it is")
	reached := get("/2/3/default")
	assert.Equal(t, http.StatusTooManyRequests, reached.Code, "the tier raised user 2 to two")
	assert.NotContains(t, reached.Body.String(), "Top up")
	close(release)
	inFlight.Wait()
}

func TestValidateConcurrencyTiers(t *testing.T) {
	assert.NoError(t, operation_setting.ValidateConcurrencyTiers(`[{"min_paid":1000,"limit":10},{"min_paid":2000,"limit":20}]`))
	assert.NoError(t, operation_setting.ValidateConcurrencyTiers(`[]`))
	for _, value := range []string{`{}`, `[{"min_paid":0,"limit":5}]`, `[{"min_paid":10,"limit":0}]`, `[{"min_paid":10,"limit":2},{"min_paid":10,"limit":3}]`} {
		assert.Error(t, operation_setting.ValidateConcurrencyTiers(value), value)
	}
}

func TestValidateUserConcurrencyLimits(t *testing.T) {
	assert.NoError(t, operation_setting.ValidateUserConcurrencyLimits(`{"7":20,"8":0}`))
	assert.NoError(t, operation_setting.ValidateUserConcurrencyLimits(`{}`))
	for _, value := range []string{`{"abc":1}`, `{"0":1}`, `{"07":1}`, `{"7":-1}`, `{"7":1.5}`, `[1]`} {
		assert.Error(t, operation_setting.ValidateUserConcurrencyLimits(value), value)
	}
}

func TestValidateConcurrencyLimits(t *testing.T) {
	assert.NoError(t, operation_setting.ValidateConcurrencyLimits(`{"default":5,"vip":0}`))
	assert.NoError(t, operation_setting.ValidateConcurrencyLimits(`{}`))
	for _, value := range []string{`[5]`, `{"default":-1}`, `{"default":1.5}`, `{" default":5}`, `not json`} {
		assert.Error(t, operation_setting.ValidateConcurrencyLimits(value), value)
	}
}

// An account that many people share caps each of its keys, so one key cannot
// take every slot of the account.
func TestUserTokenConcurrencyLimit(t *testing.T) {
	require.NoError(t, i18n.Init())
	withoutConcurrencyTiers(t)
	setting := operation_setting.GetTokenSetting()
	previousGroups, previousUsers, previousTokens := setting.ConcurrencyLimits, setting.UserConcurrencyLimits, setting.UserTokenConcurrencyLimits
	// User 51 may run three at once, two on any one key; user 52 has no
	// account limit but its keys are capped at one.
	setting.ConcurrencyLimits = map[string]int{"default": 1}
	setting.UserConcurrencyLimits = map[string]int{"51": 3}
	setting.UserTokenConcurrencyLimits = map[string]int{"51": 2, "52": 1}
	t.Cleanup(func() {
		setting.ConcurrencyLimits, setting.UserConcurrencyLimits, setting.UserTokenConcurrencyLimits = previousGroups, previousUsers, previousTokens
	})

	release := make(chan struct{})
	started := make(chan struct{}, 16)
	router := userConcurrencyRouter(release, started)
	get := func(path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		return recorder
	}
	var inFlight sync.WaitGroup
	for _, path := range []string{"/51/510/default", "/51/510/default", "/52/520/vip", "/52/521/vip", "/52/0/vip", "/52/0/vip"} {
		inFlight.Go(func() { assert.Equal(t, http.StatusOK, get(path).Code, path) })
		<-started
	}

	full := get("/51/510/default")
	assert.Equal(t, http.StatusTooManyRequests, full.Code, "the key's own cap")
	assert.Equal(t, "1", full.Header().Get("Retry-After"))
	assert.Contains(t, full.Body.String(), "on this API key: at most 2 at a time")
	assert.Equal(t, http.StatusTooManyRequests, get("/52/520/vip").Code, "a key is capped without an account limit")

	inFlight.Go(func() { assert.Equal(t, http.StatusOK, get("/51/511/default").Code) })
	<-started
	overAccount := get("/51/512/default")
	assert.Equal(t, http.StatusTooManyRequests, overAccount.Code, "the account limit still holds across keys")
	assert.Contains(t, overAccount.Body.String(), "across all of your API keys")

	userRequestsInFlight.Lock()
	assert.Equal(t, map[int]int{510: 2, 511: 1, 520: 1, 521: 1}, userRequestsInFlight.tokenCounts, "requests without a key are not counted per key")
	assert.Equal(t, 3, userRequestsInFlight.counts[51])
	_, counted := userRequestsInFlight.counts[52]
	assert.False(t, counted, "an account without a limit is not counted")
	userRequestsInFlight.Unlock()

	close(release)
	inFlight.Wait()
	userRequestsInFlight.Lock()
	assert.Empty(t, userRequestsInFlight.tokenCounts)
	userRequestsInFlight.Unlock()
}
