package middleware

import (
	"maps"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// userRequestsInFlight counts each user's unfinished relay requests across all
// of the user's tokens. It lives in process memory: one new-api instance serves
// the relay, and a crash cannot leave a stale count behind the way a shared
// counter would. With several instances each one enforces the limit on its own
// share of the traffic.
var userRequestsInFlight = struct {
	sync.Mutex
	counts map[int]int
	// tokenCounts holds the same per API key, only for the keys of users
	// whose keys are capped on their own (operation_setting.UserTokenConcurrencyLimit).
	tokenCounts map[int]int
	// rejected holds 429s not yet written to the database. Those requests
	// never reach the request logs, so the root dashboard reads them from
	// model.UserConcurrencyRejection.
	rejected map[model.ConcurrencyRejectionKey]int64
}{counts: map[int]int{}, tokenCounts: map[int]int{}, rejected: map[model.ConcurrencyRejectionKey]int64{}}

const userConcurrencyRejectionFlushInterval = 30 * time.Second

// UserConcurrencySnapshot returns every user's requests in flight on this
// instance.
func UserConcurrencySnapshot() map[int]int {
	userRequestsInFlight.Lock()
	defer userRequestsInFlight.Unlock()
	return maps.Clone(userRequestsInFlight.counts)
}

// recordUserConcurrencyRejection must be called with userRequestsInFlight held.
func recordUserConcurrencyRejection(userID int, now time.Time) {
	userRequestsInFlight.rejected[model.ConcurrencyRejectionKey{
		HourStart: now.Truncate(time.Hour).Unix(),
		UserId:    userID,
	}]++
}

// StartUserConcurrencyRejectionFlush writes the buffered 429s every 30
// seconds. Shutdown calls FlushUserConcurrencyRejections for the rest.
func StartUserConcurrencyRejectionFlush() {
	gopool.Go(func() {
		ticker := time.NewTicker(userConcurrencyRejectionFlushInterval)
		defer ticker.Stop()
		for range ticker.C {
			FlushUserConcurrencyRejections()
		}
	})
}

var userConcurrencyRejectionWriting sync.Mutex

// FlushUserConcurrencyRejections writes the buffered 429s. Counts that fail to
// write go back into the buffer for the next flush.
func FlushUserConcurrencyRejections() {
	userConcurrencyRejectionWriting.Lock()
	defer userConcurrencyRejectionWriting.Unlock()
	userRequestsInFlight.Lock()
	pending := userRequestsInFlight.rejected
	userRequestsInFlight.rejected = map[model.ConcurrencyRejectionKey]int64{}
	userRequestsInFlight.Unlock()
	if len(pending) == 0 {
		return
	}
	failed := model.AddUserConcurrencyRejections(pending)
	if len(failed) == 0 {
		return
	}
	userRequestsInFlight.Lock()
	for key, count := range failed {
		userRequestsInFlight.rejected[key] += count
	}
	userRequestsInFlight.Unlock()
}

// userPaidMoney is the paid total the tiers read; tests replace it.
var userPaidMoney = model.CachedUserPaidMoney

// userConcurrencyMessage says the limit and, unless it is a per-user
// override, how much more paid in total raises it.
func userConcurrencyMessage(c *gin.Context, limit int, source string, paidTotal func() float64) string {
	if source != operation_setting.ConcurrencySourceUser && len(operation_setting.GetTokenSetting().ConcurrencyTiers) > 0 {
		if next, ok := operation_setting.NextConcurrencyTier(paidTotal(), limit); ok {
			return i18n.T(c, i18n.MsgUserConcurrencyLimitNextTier, map[string]any{
				"Max":       limit,
				"Remaining": strconv.FormatFloat(math.Ceil((next.MinPaid-paidTotal())*100)/100, 'f', -1, 64),
				"Next":      next.Limit,
			})
		}
	}
	return i18n.T(c, i18n.MsgUserConcurrencyLimitReached, map[string]any{"Max": limit})
}

// UserConcurrencyLimit rejects a request with 429 while its user already has as
// many requests in flight, over all of the user's tokens, as the user's limit
// allows (operation_setting.EffectiveUserConcurrencyLimit), or while its token
// has as many as each of the user's tokens may (operation_setting.UserTokenConcurrencyLimit).
// A streamed response holds its slots until the stream ends.
func UserConcurrencyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := c.GetInt(string(constant.ContextKeyUserId))
		if userID == 0 {
			c.Next()
			return
		}
		paid := -1.0
		paidTotal := func() float64 {
			if paid < 0 {
				paid = userPaidMoney(userID)
			}
			return paid
		}
		limit, source := operation_setting.EffectiveUserConcurrencyLimit(userID,
			common.GetContextKeyString(c, constant.ContextKeyUserGroup), paidTotal)
		// A request without a token, such as the playground's, has no key to cap.
		tokenID := c.GetInt(string(constant.ContextKeyTokenId))
		tokenLimit := 0
		if tokenID != 0 {
			tokenLimit = operation_setting.UserTokenConcurrencyLimit(userID)
		}
		if limit == 0 && tokenLimit == 0 {
			c.Next()
			return
		}

		userRequestsInFlight.Lock()
		if tokenLimit > 0 && userRequestsInFlight.tokenCounts[tokenID] >= tokenLimit {
			recordUserConcurrencyRejection(userID, time.Now())
			userRequestsInFlight.Unlock()
			c.Header("Retry-After", "1")
			abortWithOpenAiMessage(c, http.StatusTooManyRequests,
				i18n.T(c, i18n.MsgTokenConcurrencyLimitReached, map[string]any{"Max": tokenLimit}))
			return
		}
		if limit > 0 && userRequestsInFlight.counts[userID] >= limit {
			recordUserConcurrencyRejection(userID, time.Now())
			userRequestsInFlight.Unlock()
			c.Header("Retry-After", "1")
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, userConcurrencyMessage(c, limit, source, paidTotal))
			return
		}
		if limit > 0 {
			userRequestsInFlight.counts[userID]++
		}
		if tokenLimit > 0 {
			userRequestsInFlight.tokenCounts[tokenID]++
		}
		userRequestsInFlight.Unlock()
		if limit > 0 {
			// Billing scales its trust threshold by this, so a balance cannot be
			// overdrawn by as many unreserved requests as the limit admits.
			common.SetContextKey(c, constant.ContextKeyUserConcurrencyLimit, limit)
		}

		defer func() {
			userRequestsInFlight.Lock()
			defer userRequestsInFlight.Unlock()
			if limit > 0 {
				userRequestsInFlight.counts[userID]--
				if userRequestsInFlight.counts[userID] <= 0 {
					delete(userRequestsInFlight.counts, userID)
				}
			}
			if tokenLimit > 0 {
				userRequestsInFlight.tokenCounts[tokenID]--
				if userRequestsInFlight.tokenCounts[tokenID] <= 0 {
					delete(userRequestsInFlight.tokenCounts, tokenID)
				}
			}
		}()
		c.Next()
	}
}
