package operation_setting

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// TokenSetting 令牌相关配置
type TokenSetting struct {
	MaxUserTokens int `json:"max_user_tokens"` // 每用户最大令牌数量
	// ConcurrencyLimits caps the requests one user may have in flight across
	// all of the user's tokens, by the user's group. A group that is absent or
	// set to 0 is not limited. The key keeps its token_setting name so stored
	// values and released consoles keep working.
	ConcurrencyLimits map[string]int `json:"concurrency_limits"`
	// UserConcurrencyLimits overrides the group limit for single users, keyed
	// by user id. 0 lifts the limit for that user.
	UserConcurrencyLimits map[string]int `json:"user_concurrency_limits"`
	// UserTokenConcurrencyLimits caps each API key of a user on its own, keyed
	// by user id, so one key of an account that many people share cannot take
	// every slot of the account's limit. Absent or 0 leaves the keys uncapped.
	UserTokenConcurrencyLimits map[string]int `json:"user_token_concurrency_limits"`
	// ConcurrencyTiers raise the group limit by what a user has paid in
	// total through payment gateways, in the payment currency. The highest
	// tier reached applies when it is above the group limit.
	ConcurrencyTiers []ConcurrencyTier `json:"concurrency_tiers"`
}

// ConcurrencyTier is one step of ConcurrencyTiers: paid at least MinPaid,
// the user may run Limit requests at once.
type ConcurrencyTier struct {
	MinPaid float64 `json:"min_paid"`
	Limit   int     `json:"limit"`
}

// 默认配置
var tokenSetting = TokenSetting{
	MaxUserTokens:              1000, // 默认每用户最多 1000 个令牌
	ConcurrencyLimits:          map[string]int{},
	UserConcurrencyLimits:      map[string]int{},
	UserTokenConcurrencyLimits: map[string]int{},
	ConcurrencyTiers:           []ConcurrencyTier{{MinPaid: 1000, Limit: 10}, {MinPaid: 10000, Limit: 20}},
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("token_setting", &tokenSetting)
}

// GetTokenSetting 获取令牌配置
func GetTokenSetting() *TokenSetting {
	return &tokenSetting
}

// GetMaxUserTokens 获取每用户最大令牌数量
func GetMaxUserTokens() int {
	return GetTokenSetting().MaxUserTokens
}

// Where an effective concurrency limit comes from.
const (
	ConcurrencySourceUser  = "user"
	ConcurrencySourceTier  = "tier"
	ConcurrencySourceGroup = "group"
)

// GetUserConcurrencyLimit returns how many requests one user in group may have
// in flight across all of the user's tokens; 0 means unlimited.
func GetUserConcurrencyLimit(group string) int {
	return max(GetTokenSetting().ConcurrencyLimits[group], 0)
}

// ConcurrencyTierLimit returns the limit of the highest tier paid reaches,
// or 0 below the first tier.
func ConcurrencyTierLimit(paid float64) int {
	limit := 0
	for _, tier := range GetTokenSetting().ConcurrencyTiers {
		if paid >= tier.MinPaid && tier.Limit > limit {
			limit = tier.Limit
		}
	}
	return limit
}

// NextConcurrencyTier returns the lowest tier above both paid and limit, the
// next step a user can buy toward.
func NextConcurrencyTier(paid float64, limit int) (ConcurrencyTier, bool) {
	var next ConcurrencyTier
	found := false
	for _, tier := range GetTokenSetting().ConcurrencyTiers {
		if tier.MinPaid > paid && tier.Limit > limit && (!found || tier.MinPaid < next.MinPaid) {
			next, found = tier, true
		}
	}
	return next, found
}

// UserConcurrencyOverride returns a user's per-user limit, if one is set.
func UserConcurrencyOverride(userID int) (int, bool) {
	limit, ok := GetTokenSetting().UserConcurrencyLimits[strconv.Itoa(userID)]
	return max(limit, 0), ok
}

// UserTokenConcurrencyLimit returns how many requests each API key of a user
// may have in flight; 0 means the keys are not capped on their own.
func UserTokenConcurrencyLimit(userID int) int {
	return max(GetTokenSetting().UserTokenConcurrencyLimits[strconv.Itoa(userID)], 0)
}

// EffectiveUserConcurrencyLimit resolves a user's limit: a per-user override
// first, then the higher of the group's limit and the tier the user's paid
// total reaches. 0 means unlimited; a group without a limit stays unlimited.
// paid is read only without an override, so the caller can skip the lookup.
func EffectiveUserConcurrencyLimit(userID int, group string, paid func() float64) (int, string) {
	if limit, ok := UserConcurrencyOverride(userID); ok {
		return limit, ConcurrencySourceUser
	}
	limit := GetUserConcurrencyLimit(group)
	if limit == 0 {
		return 0, ConcurrencySourceGroup
	}
	if len(GetTokenSetting().ConcurrencyTiers) == 0 {
		return limit, ConcurrencySourceGroup
	}
	if tier := ConcurrencyTierLimit(paid()); tier > limit {
		return tier, ConcurrencySourceTier
	}
	return limit, ConcurrencySourceGroup
}

// ValidateConcurrencyLimits checks the JSON value of
// token_setting.concurrency_limits: an object of group names to non-negative
// whole numbers.
func ValidateConcurrencyLimits(value string) error {
	var limits map[string]int
	if err := common.UnmarshalJsonStr(value, &limits); err != nil {
		return fmt.Errorf("Concurrency limits must be a JSON object of group names to whole numbers: %w", err)
	}
	for group, limit := range limits {
		if strings.TrimSpace(group) == "" || group != strings.TrimSpace(group) {
			return fmt.Errorf("Concurrency group names must be non-empty and have no surrounding spaces")
		}
		if limit < 0 {
			return fmt.Errorf("Concurrency limit for group %q cannot be negative", group)
		}
	}
	return nil
}

// ValidateUserConcurrencyLimits checks the JSON value of
// token_setting.user_concurrency_limits and
// token_setting.user_token_concurrency_limits: an object of positive user ids
// to non-negative whole numbers.
func ValidateUserConcurrencyLimits(value string) error {
	var limits map[string]int
	if err := common.UnmarshalJsonStr(value, &limits); err != nil {
		return fmt.Errorf("User concurrency limits must be a JSON object of user ids to whole numbers: %w", err)
	}
	for user, limit := range limits {
		if id, err := strconv.Atoi(user); err != nil || id <= 0 || strconv.Itoa(id) != user {
			return fmt.Errorf("User concurrency limit key %q is not a user id", user)
		}
		if limit < 0 {
			return fmt.Errorf("Concurrency limit for user %s cannot be negative", user)
		}
	}
	return nil
}

// ValidateConcurrencyTiers checks the JSON value of
// token_setting.concurrency_tiers: a list of positive amounts, each with a
// positive limit, and no amount twice.
func ValidateConcurrencyTiers(value string) error {
	var tiers []ConcurrencyTier
	if err := common.UnmarshalJsonStr(value, &tiers); err != nil {
		return fmt.Errorf("Concurrency tiers must be a JSON list of {min_paid, limit}: %w", err)
	}
	seen := make(map[float64]bool, len(tiers))
	for _, tier := range tiers {
		if tier.MinPaid <= 0 || tier.Limit <= 0 {
			return fmt.Errorf("Each concurrency tier needs a positive amount and a positive limit")
		}
		if seen[tier.MinPaid] {
			return fmt.Errorf("Concurrency tier amount %v appears twice", tier.MinPaid)
		}
		seen[tier.MinPaid] = true
	}
	return nil
}
