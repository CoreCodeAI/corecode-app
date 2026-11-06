package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestClaudeThreadContextIsKeptPerUserAndMessage(t *testing.T) {
	RememberClaudeThreadContext(7, "msg_ctx_a", 182_000)
	tokens, found := ClaudeThreadContextTokens(7, "msg_ctx_a")
	assert.True(t, found)
	assert.Equal(t, 182_000, tokens)

	_, found = ClaudeThreadContextTokens(8, "msg_ctx_a")
	assert.False(t, found, "another user's thread is not read")
	_, found = ClaudeThreadContextTokens(7, "msg_ctx_b")
	assert.False(t, found)

	RememberClaudeThreadContext(7, "", 10)
	RememberClaudeThreadContext(7, "msg_ctx_zero", 0)
	_, found = ClaudeThreadContextTokens(7, "msg_ctx_zero")
	assert.False(t, found)
}

func TestClaudeThreadContinuesNamesThePreviousMessage(t *testing.T) {
	assert.Equal(t, "msg_01", ClaudeThreadContinues([]byte(`{"type":"continue","previous_message_id":"msg_01"}`)))
	assert.Empty(t, ClaudeThreadContinues([]byte(`{"type":"create"}`)))
	assert.Empty(t, ClaudeThreadContinues([]byte(`{"type":"continue"}`)))
	assert.Empty(t, ClaudeThreadContinues(nil))
}
