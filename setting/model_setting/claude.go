package model_setting

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

//var claudeHeadersSettings = map[string][]string{}
//
//var ClaudeThinkingAdapterEnabled = true
//var ClaudeThinkingAdapterMaxTokens = 8192
//var ClaudeThinkingAdapterBudgetTokensPercentage = 0.8

// ClaudeSettings 定义Claude模型的配置
type ClaudeSettings struct {
	HeadersSettings                       map[string]map[string][]string `json:"model_headers_settings"`
	DefaultMaxTokens                      map[string]int                 `json:"default_max_tokens"`
	ThinkingAdapterEnabled                bool                           `json:"thinking_adapter_enabled"`
	ThinkingAdapterBudgetTokensPercentage float64                        `json:"thinking_adapter_budget_tokens_percentage"`
	// DefaultPromptCacheTTL is the ttl given to the cache breakpoints of a
	// streamed request to an Anthropic channel whose client set none. "1h"
	// turns it on; any other value sends the breakpoints as the client did.
	DefaultPromptCacheTTL string `json:"default_prompt_cache_ttl"`
	// DefaultPromptCacheTTLMinTokens is the estimated prompt size from which
	// DefaultPromptCacheTTL applies. Below it a pause rewrites little, and the
	// 1h write price on every turn would cost more than the pauses save.
	DefaultPromptCacheTTLMinTokens int `json:"default_prompt_cache_ttl_min_tokens"`
}

// 默认配置
var defaultClaudeSettings = ClaudeSettings{
	HeadersSettings:        map[string]map[string][]string{},
	ThinkingAdapterEnabled: true,
	DefaultMaxTokens: map[string]int{
		"default": 8192,
	},
	ThinkingAdapterBudgetTokensPercentage: 0.8,
	DefaultPromptCacheTTL:                 "1h",
	DefaultPromptCacheTTLMinTokens:        200000,
}

// 全局实例
var claudeSettings = defaultClaudeSettings

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("claude", &claudeSettings)
}

// GetClaudeSettings 获取Claude配置
func GetClaudeSettings() *ClaudeSettings {
	// check default max tokens must have default key
	if _, ok := claudeSettings.DefaultMaxTokens["default"]; !ok {
		claudeSettings.DefaultMaxTokens["default"] = 8192
	}
	return &claudeSettings
}

func (c *ClaudeSettings) WriteHeaders(originModel string, httpHeader *http.Header) {
	if headers, ok := c.HeadersSettings[originModel]; ok {
		for headerKey, headerValues := range headers {
			mergedValues := normalizeHeaderListValues(
				append(append([]string(nil), httpHeader.Values(headerKey)...), headerValues...),
			)
			if len(mergedValues) == 0 {
				continue
			}
			httpHeader.Set(headerKey, strings.Join(mergedValues, ","))
		}
	}
}

func normalizeHeaderListValues(values []string) []string {
	normalizedValues := make([]string, 0, len(values))
	seenValues := make(map[string]struct{}, len(values))
	for _, value := range values {
		for item := range strings.SplitSeq(value, ",") {
			normalizedItem := strings.TrimSpace(item)
			if normalizedItem == "" {
				continue
			}
			if _, exists := seenValues[normalizedItem]; exists {
				continue
			}
			seenValues[normalizedItem] = struct{}{}
			normalizedValues = append(normalizedValues, normalizedItem)
		}
	}
	return normalizedValues
}

func (c *ClaudeSettings) GetDefaultMaxTokens(model string) int {
	if maxTokens, ok := c.DefaultMaxTokens[model]; ok {
		return maxTokens
	}
	return c.DefaultMaxTokens["default"]
}

// ValidateClaudeDefaultMaxTokens validates the JSON persisted by the option
// API. Zero stays allowed — the current Messages API accepts max_tokens: 0 as
// cache pre-warming — but negative values are rejected because they would
// wrap into huge unsigned values during request conversion.
func ValidateClaudeDefaultMaxTokens(value string) error {
	var settings map[string]int
	if err := common.UnmarshalJsonStr(value, &settings); err != nil {
		return fmt.Errorf("Claude default max tokens must be a JSON map of model to integer: %w", err)
	}
	if settings == nil {
		return fmt.Errorf("Claude default max tokens must be a JSON map of model to integer")
	}
	for model, maxTokens := range settings {
		if maxTokens < 0 {
			return fmt.Errorf("negative Claude default max_tokens %d for %q", maxTokens, model)
		}
	}
	return nil
}

// ValidateClaudeDefaultPromptCacheTTLOption checks the two default cache ttl
// options before they are stored: the config loader drops a value it cannot
// parse without reporting it, which would leave the running setting unchanged.
func ValidateClaudeDefaultPromptCacheTTLOption(key, value string) error {
	switch key {
	case "claude.default_prompt_cache_ttl":
		if value != "" && value != "1h" && value != "off" {
			return fmt.Errorf("Claude default prompt cache ttl must be \"1h\", or \"off\" or empty to send breakpoints as the client did")
		}
	case "claude.default_prompt_cache_ttl_min_tokens":
		tokens, err := strconv.Atoi(value)
		if err != nil || tokens < 0 {
			return fmt.Errorf("Claude default prompt cache ttl min tokens must be a non-negative integer")
		}
	}
	return nil
}
