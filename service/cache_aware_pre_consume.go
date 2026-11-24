package service

import (
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/pkg/cachex"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/hot"
)

// A long Claude conversation is almost all cache reads, yet the pre-consume
// prices every input token at the full rate, so a balance that covers many
// real requests is refused. When the balance cannot hold the full reservation,
// PreConsumeBilling reserves a cache-based estimate instead, provided the same
// conversation's previous request left a cache that has not yet expired.
const (
	// CacheAwarePreConsumeMargin scales the cache-based estimate, to cover a
	// turn that reads less of the cache than the previous one left behind.
	CacheAwarePreConsumeMargin = 1.5

	// The cache lifetime is trusted only up to this share of its ttl, so a
	// request that lands near the edge is estimated at the full price.
	cacheAwareLifetimeSafety = 0.9

	cacheAwareShortTTL = 5 * time.Minute
	cacheAwareLongTTL  = time.Hour

	cacheAwareSessionNamespace = "new-api:cache_aware_session:v1"
	// An entry outlives the longest cache ttl, so an expired one is never
	// mistaken for a live one by an entry that is still stored.
	cacheAwareSessionTTL      = time.Hour
	cacheAwareSessionCapacity = 100_000
)

// cacheAwareSession is what the previous request of a conversation left.
type cacheAwareSession struct {
	// At is the previous request's start, in unix milliseconds. Anthropic
	// refreshes a cache entry when a request reads it, which is no later than
	// the request's start, so measuring from the start never over-states how
	// long the cache lives.
	At int64 `json:"at"`
	// Tokens is what the request read from and wrote to the cache.
	Tokens int `json:"tokens"`
	// TTL is the seconds the cache it wrote lives: 3600 or 300.
	TTL int `json:"ttl"`
}

var (
	cacheAwareSessionsOnce  sync.Once
	cacheAwareSessionsCache *cachex.HybridCache[cacheAwareSession]
)

func cacheAwareSessions() *cachex.HybridCache[cacheAwareSession] {
	cacheAwareSessionsOnce.Do(func() {
		cacheAwareSessionsCache = cachex.NewHybridCache[cacheAwareSession](cachex.HybridCacheConfig[cacheAwareSession]{
			Namespace: cachex.Namespace(cacheAwareSessionNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[cacheAwareSession]{},
			Memory: func() *hot.HotCache[string, cacheAwareSession] {
				return hot.NewHotCache[string, cacheAwareSession](hot.LRU, cacheAwareSessionCapacity).
					WithTTL(cacheAwareSessionTTL).
					WithJanitor().
					Build()
			},
		})
	})
	return cacheAwareSessionsCache
}

// cacheAwareEligible reports whether the request may be admitted on a cache
// estimate: a Claude Messages request, billed by token, with the switch on.
func cacheAwareEligible(c *gin.Context, info *relaycommon.RelayInfo) bool {
	if c == nil || c.Request == nil || info == nil || info.ForcePreConsume || info.RelayFormat != types.RelayFormatClaude {
		return false
	}
	if _, ok := info.Request.(*dto.ClaudeRequest); !ok {
		return false
	}
	return operation_setting.GetBillingSetting().CacheAwarePreConsumeEnabled
}

// cacheAwareSessionKey names the conversation of a request: the channel
// affinity key the client sends (Claude Code's metadata.user_id), the user and
// the model. "" when no affinity rule reads a key from the request, which
// leaves the request on the full estimate.
func cacheAwareSessionKey(c *gin.Context, info *relaycommon.RelayInfo) string {
	fingerprint := ""
	// Channel selection has already read the key of a request that is being
	// settled; billing runs before it and reads the key itself.
	if meta, ok := getChannelAffinityMeta(c); ok && meta.ModelName == info.OriginModelName {
		fingerprint = meta.KeyFingerprint
	} else if setting := operation_setting.GetChannelAffinitySetting(); setting != nil && setting.Enabled {
		if matched, ok := matchChannelAffinityRule(c, setting, info.OriginModelName); ok {
			fingerprint = affinityFingerprint(matched.value)
		}
	}
	if fingerprint == "" {
		return ""
	}
	return fingerprint + ":" + strconv.Itoa(info.UserId) + ":" + info.OriginModelName
}

// RememberCacheAwareSession keeps what a settled Claude request left in the
// cache, for the next request of its conversation. tokens is the cache reads
// plus writes it was billed for.
func RememberCacheAwareSession(c *gin.Context, info *relaycommon.RelayInfo, tokens int, billedLongTTL bool) {
	if tokens <= 0 || !cacheAwareEligible(c, info) {
		return
	}
	key := cacheAwareSessionKey(c, info)
	if key == "" {
		return
	}
	ttl := cacheAwareShortTTL
	if billedLongTTL || common.GetContextKeyBool(c, constant.ContextKeyClaudeDefaultCacheTTL) {
		ttl = cacheAwareLongTTL
	}
	entry := cacheAwareSession{At: info.StartTime.UnixMilli(), Tokens: tokens, TTL: int(ttl / time.Second)}
	if err := cacheAwareSessions().SetWithTTL(key, entry, cacheAwareSessionTTL); err != nil {
		common.SysError(common.LogText("remember cache aware session: %s", err.Error()))
	}
}

// planCacheAwarePreConsume prices the request on the cache its conversation's
// previous request left, when that cache is still alive. nil leaves the
// request on the full estimate: the switch is off, the conversation is unknown
// or its cache has expired, or the model is not priced by token.
func planCacheAwarePreConsume(c *gin.Context, info *relaycommon.RelayInfo, fullQuota int) *relaycommon.CacheAwarePreConsume {
	if fullQuota <= 0 || !cacheAwareEligible(c, info) {
		return nil
	}
	key := cacheAwareSessionKey(c, info)
	if key == "" {
		return nil
	}
	entry, found, err := cacheAwareSessions().Get(key)
	if err != nil {
		common.SysError(common.LogText("read cache aware session: %s", err.Error()))
		return nil
	}
	if !found || entry.Tokens <= 0 {
		return nil
	}

	ttl := time.Duration(entry.TTL) * time.Second
	if ttl <= 0 || ttl > cacheAwareLongTTL {
		ttl = cacheAwareShortTTL
	}
	// A client that asks for the 5-minute ttl gets no longer cache than that,
	// whatever the previous request was billed for.
	if relaycommon.ClientKeepsFiveMinuteCacheTTL(c.Request.Header) {
		ttl = min(ttl, cacheAwareShortTTL)
	}
	gap := max(time.Since(time.UnixMilli(entry.At)), 0)
	if gap > time.Duration(float64(ttl)*cacheAwareLifetimeSafety) {
		return nil
	}

	cacheQuota, ok := estimateCacheAwareQuota(info, entry.Tokens, ttl >= cacheAwareLongTTL)
	if !ok {
		return nil
	}
	// A cache estimate above the full one never helps: the balance already
	// refused the full one.
	cacheQuota = min(cacheQuota, fullQuota)
	if cacheQuota <= 0 {
		return nil
	}
	return &relaycommon.CacheAwarePreConsume{
		FullQuota:  fullQuota,
		CacheQuota: cacheQuota,
		GapSeconds: int(gap / time.Second),
		TTLSeconds: int(ttl / time.Second),
	}
}

// estimateCacheAwareQuota is the pre-consume of a request whose input reads
// previousTokens from the cache and writes the rest back, priced as the
// settlement prices those tokens, times CacheAwarePreConsumeMargin. Output is
// not estimated, as in the full estimate.
func estimateCacheAwareQuota(info *relaycommon.RelayInfo, previousTokens int, longTTL bool) (int, bool) {
	prompt := info.GetEstimatePromptTokens()
	if prompt <= 0 || previousTokens <= 0 {
		return 0, false
	}
	cached := min(prompt, previousTokens)
	written := prompt - cached
	multiplier, err := operation_setting.InputPreConsumeMultiplier()
	if err != nil {
		return 0, false
	}

	var quota float64
	if snap := info.TieredBillingSnapshot; snap != nil {
		if snap.BillingMode != billing_setting.BillingModeTieredExpr {
			return 0, false
		}
		usage := &dto.Usage{
			UsageSemantic: dto.BillingUsageSemanticAnthropic,
			PromptTokensDetails: dto.InputTokenDetails{
				CachedTokens:             cached,
				CacheCreationInputTokens: written,
			},
		}
		if longTTL {
			usage.ClaudeCacheCreation1hTokens = written
		} else {
			usage.ClaudeCacheCreation5mTokens = written
		}
		params := BuildTieredTokenParams(usage, true, billingexpr.UsedVarsByHash(snap.ExprString, snap.ExprHash))
		var requestInput billingexpr.RequestInput
		if info.BillingRequestInput != nil {
			requestInput = *info.BillingRequestInput
		}
		result, err := billingexpr.ComputeTieredQuotaWithRequest(snap, params, requestInput)
		// A price per request has no cache to discount.
		if err != nil || result.BillingUnit == billingexpr.BillingUnitRequest {
			return 0, false
		}
		quota = float64(result.ActualQuotaAfterGroup) * multiplier
	} else {
		price := info.PriceData
		if price.UsePrice || price.ModelRatio <= 0 {
			return 0, false
		}
		// A cache price not configured never makes the estimate cheaper than
		// plain input.
		readRatio, writeRatio := price.CacheRatio, price.CacheCreation5mRatio
		if longTTL {
			writeRatio = price.CacheCreation1hRatio
		}
		if readRatio <= 0 {
			readRatio = 1
		}
		if writeRatio <= 0 {
			writeRatio = 1
		}
		quota = (float64(cached)*readRatio + float64(written)*writeRatio) * price.ModelRatio * price.GroupRatioInfo.GroupRatio * multiplier
	}
	estimate, err := common.QuotaRoundStrict(quota * CacheAwarePreConsumeMargin)
	if err != nil {
		return 0, false
	}
	return estimate, true
}
