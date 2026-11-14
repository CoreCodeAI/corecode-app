package model_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateClaudeDefaultPromptCacheTTLOption(t *testing.T) {
	for _, value := range []string{"1h", "off", ""} {
		assert.NoError(t, ValidateClaudeDefaultPromptCacheTTLOption("claude.default_prompt_cache_ttl", value), value)
	}
	for _, value := range []string{"1H", "5m", "60m"} {
		assert.Error(t, ValidateClaudeDefaultPromptCacheTTLOption("claude.default_prompt_cache_ttl", value), value)
	}
	for _, value := range []string{"0", "100000"} {
		assert.NoError(t, ValidateClaudeDefaultPromptCacheTTLOption("claude.default_prompt_cache_ttl_min_tokens", value), value)
	}
	for _, value := range []string{"-1", "200K", "", "1.5", " 200000"} {
		assert.Error(t, ValidateClaudeDefaultPromptCacheTTLOption("claude.default_prompt_cache_ttl_min_tokens", value), value)
	}
}
