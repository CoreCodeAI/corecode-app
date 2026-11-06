package service

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	"github.com/samber/hot"
	"github.com/tidwall/gjson"
)

// A Claude message thread (beta message-threads-2026-08-12) keeps the
// conversation upstream, so a continuation carries only the new messages
// while Anthropic bills the whole context. The size of each threaded
// response's context is kept here, so the next turn's estimate includes it.
const (
	claudeThreadContextNamespace = "new-api:claude_thread_context:v1"
	// Anthropic deletes a thread at most an hour after its last use.
	claudeThreadContextTTL      = time.Hour
	claudeThreadContextCapacity = 100_000
)

var (
	claudeThreadContextOnce  sync.Once
	claudeThreadContextCache *cachex.HybridCache[int]
)

func claudeThreadContexts() *cachex.HybridCache[int] {
	claudeThreadContextOnce.Do(func() {
		claudeThreadContextCache = cachex.NewHybridCache[int](cachex.HybridCacheConfig[int]{
			Namespace: cachex.Namespace(claudeThreadContextNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.IntCodec{},
			Memory: func() *hot.HotCache[string, int] {
				return hot.NewHotCache[string, int](hot.LRU, claudeThreadContextCapacity).
					WithTTL(claudeThreadContextTTL).
					WithJanitor().
					Build()
			},
		})
	})
	return claudeThreadContextCache
}

func claudeThreadContextKey(userID int, messageID string) string {
	return strconv.Itoa(userID) + ":" + messageID
}

// ClaudeThreadContinues returns the message a Claude request's thread
// continues from, or "" when it creates a thread or has none.
func ClaudeThreadContinues(thread []byte) string {
	if len(thread) == 0 || gjson.GetBytes(thread, "type").String() != "continue" {
		return ""
	}
	return strings.TrimSpace(gjson.GetBytes(thread, "previous_message_id").String())
}

// RememberClaudeThreadContext keeps the tokens of a threaded response's
// whole context, input and output, under the user and response id.
func RememberClaudeThreadContext(userID int, messageID string, tokens int) {
	if messageID == "" || tokens <= 0 {
		return
	}
	if err := claudeThreadContexts().SetWithTTL(claudeThreadContextKey(userID, messageID), tokens, claudeThreadContextTTL); err != nil {
		common.SysError(common.LogText("remember claude thread context: %s", err.Error()))
	}
}

// ClaudeThreadContextTokens is the context a continuation of messageID
// carries upstream, as remembered for the same user.
func ClaudeThreadContextTokens(userID int, messageID string) (int, bool) {
	if messageID == "" {
		return 0, false
	}
	tokens, found, err := claudeThreadContexts().Get(claudeThreadContextKey(userID, messageID))
	if err != nil {
		common.SysError(common.LogText("read claude thread context: %s", err.Error()))
		return 0, false
	}
	return tokens, found
}
