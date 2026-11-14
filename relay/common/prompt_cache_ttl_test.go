package common

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// The shape Claude Code 2.1.322 sends: breakpoints without ttl on the system
// prompt and the last message block, plus a tool whose input happens to carry
// a cache_control key and a tool_result with a breakpoint on a nested block.
const claudeCodeBody = `{"model":"claude-opus-5-5","max_tokens":128000,"stream":true,` +
	`"system":[{"type":"text","text":"billing header"},{"type":"text","text":"You are Claude Code.","cache_control":{"type":"ephemeral"}}],` +
	`"tools":[{"name":"Edit","input_schema":{"type":"object","properties":{"z_path":{"type":"string"},"a_text":{"type":"string"}}},"cache_control":{"type":"ephemeral"}}],` +
	`"messages":[` +
	`{"role":"user","content":"start"},` +
	`{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"cache_control":{"type":"ephemeral"}}}]},` +
	`{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"ok","cache_control":{"type":"ephemeral"}}]},` +
	`{"type":"text","text":"next","cache_control": { "type" : "ephemeral" }}]}]}`

func TestDefaultPromptCacheTTLFillsEveryBreakpointTheClientLeftWithout(t *testing.T) {
	out, changed := DefaultPromptCacheTTL([]byte(claudeCodeBody), "1h")
	require.True(t, changed)
	require.True(t, gjson.ValidBytes(out))

	for _, path := range []string{
		"system.1.cache_control",
		"tools.0.cache_control",
		"messages.2.content.0.content.0.cache_control",
		"messages.2.content.1.cache_control",
	} {
		assert.Equal(t, "1h", gjson.GetBytes(out, path+".ttl").String(), path)
		assert.Equal(t, "ephemeral", gjson.GetBytes(out, path+".type").String(), path)
	}
	assert.False(t, gjson.GetBytes(out, "messages.1.content.0.input.cache_control.ttl").Exists(),
		"a cache_control key inside tool input is conversation content")

	// Every other byte is the client's: removing the inserted fields gives
	// back the body as sent, with the tool schema's property order intact.
	assert.Equal(t, claudeCodeBody, strings.ReplaceAll(string(out), `,"ttl":"1h"`, ""))
}

func TestDefaultPromptCacheTTLLeavesTheBodyWhenTheClientChoseATTL(t *testing.T) {
	for _, ttl := range []string{"5m", "1h"} {
		// Only the last breakpoint carries the client's ttl; filling the
		// others could put a 1h breakpoint after a 5m one, which Anthropic
		// rejects.
		body := strings.Replace(claudeCodeBody, `"cache_control": { "type" : "ephemeral" }`,
			`"cache_control":{"type":"ephemeral","ttl":"`+ttl+`"}`, 1)
		require.NotEqual(t, claudeCodeBody, body)
		out, changed := DefaultPromptCacheTTL([]byte(body), "1h")
		assert.False(t, changed, ttl)
		assert.Equal(t, body, string(out), ttl)
	}
}

func TestDefaultPromptCacheTTLHandlesTopLevelAndEmptyBreakpoints(t *testing.T) {
	body := `{"model":"m","cache_control":{},"messages":[{"role":"user","content":"hi"}]}`
	out, changed := DefaultPromptCacheTTL([]byte(body), "1h")
	require.True(t, changed)
	assert.Equal(t, `{"model":"m","cache_control":{"ttl":"1h"},"messages":[{"role":"user","content":"hi"}]}`, string(out))
}

func TestDefaultPromptCacheTTLLeavesABodyWithoutBreakpoints(t *testing.T) {
	for _, body := range []string{
		`{"model":"m","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`,
		`{"model":"m","messages":[{"role":"user","content":"hi","cache_control":{"type":"ephemeral"}}]}`,
		`[]`,
		`not json`,
	} {
		out, changed := DefaultPromptCacheTTL([]byte(body), "1h")
		assert.False(t, changed, body)
		assert.Equal(t, body, string(out), body)
	}
}

// A 1.5 MB Claude Code turn: 300 messages with 5 KB tool results, the size of
// the largest bodies seen in production.
func BenchmarkDefaultPromptCacheTTL(b *testing.B) {
	var sb strings.Builder
	sb.WriteString(`{"model":"claude-opus-5-5","stream":true,"system":[{"type":"text","text":"x","cache_control":{"type":"ephemeral"}}],"messages":[`)
	filler := strings.Repeat("a", 5000)
	for i := range 300 {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(`{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":[{"type":"text","text":"` + filler + `"}]}]}`)
	}
	sb.WriteString(`,{"role":"user","content":[{"type":"text","text":"go","cache_control":{"type":"ephemeral"}}]}]}`)
	body := []byte(sb.String())
	b.SetBytes(int64(len(body)))
	for b.Loop() {
		if _, changed := DefaultPromptCacheTTL(body, "1h"); !changed {
			b.Fatal("no breakpoint filled")
		}
	}
}
