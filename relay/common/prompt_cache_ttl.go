package common

import (
	"slices"
	"strconv"
	"strings"

	"github.com/tidwall/gjson"
)

// ExtendedCacheTTLBeta is the anthropic-beta value Claude Code sends with
// 1-hour cache breakpoints.
const ExtendedCacheTTLBeta = "extended-cache-ttl-2025-04-11"

// DefaultPromptCacheTTL gives every cache_control breakpoint of a Claude
// Messages body the given ttl, when the client set a ttl on none of them.
//
// A breakpoint without ttl means 5 minutes upstream, and Claude Code sends
// none unless CLAUDE_CODE_PROMPT_CACHE_TTL is set, so the client's default
// takes the relay's. A ttl on any breakpoint is the client's own choice and
// leaves the whole body as sent: Anthropic rejects a 1h breakpoint after a 5m
// one, so mixing the client's values with the default could fail the request.
//
// Only the places the Messages API reads breakpoints from are visited: the
// top level, system and tool definitions, message content blocks, and the
// blocks inside a tool_result. A cache_control key elsewhere, such as inside a
// tool's input, is conversation content. The rest of the body keeps its bytes,
// so the prompt prefix stays identical from turn to turn.
func DefaultPromptCacheTTL(body []byte, ttl string) ([]byte, bool) {
	type breakpoint struct {
		end   int // offset of the object's closing brace
		empty bool
	}
	var breakpoints []breakpoint
	clientChose := false
	visit := func(holder gjson.Result) {
		cacheControl := holder.Get("cache_control")
		if !cacheControl.Exists() {
			return
		}
		if !cacheControl.IsObject() || cacheControl.Get("ttl").Exists() {
			clientChose = true
			return
		}
		end := cacheControl.Index + len(cacheControl.Raw) - 1
		if cacheControl.Index <= 0 || end >= len(body) || string(body[cacheControl.Index:end+1]) != cacheControl.Raw {
			// An offset gjson could not place; leave the body as sent.
			clientChose = true
			return
		}
		inner := strings.TrimSpace(cacheControl.Raw[1 : len(cacheControl.Raw)-1])
		breakpoints = append(breakpoints, breakpoint{end: end, empty: inner == ""})
	}

	root := gjson.ParseBytes(body)
	if !root.IsObject() {
		return body, false
	}
	visit(root)
	for _, field := range []string{"system", "tools"} {
		if list := root.Get(field); list.IsArray() {
			list.ForEach(func(_, item gjson.Result) bool {
				visit(item)
				return true
			})
		}
	}
	root.Get("messages").ForEach(func(_, message gjson.Result) bool {
		content := message.Get("content")
		if !content.IsArray() {
			return true
		}
		content.ForEach(func(_, block gjson.Result) bool {
			visit(block)
			if block.Get("type").String() == "tool_result" {
				if nested := block.Get("content"); nested.IsArray() {
					nested.ForEach(func(_, inner gjson.Result) bool {
						visit(inner)
						return true
					})
				}
			}
			return true
		})
		return true
	})

	if clientChose || len(breakpoints) == 0 {
		return body, false
	}
	slices.SortFunc(breakpoints, func(a, b breakpoint) int { return a.end - b.end })
	field := `"ttl":` + strconv.Quote(ttl)
	out := make([]byte, 0, len(body)+len(breakpoints)*(len(field)+1))
	last := 0
	for _, point := range breakpoints {
		out = append(out, body[last:point.end]...)
		if !point.empty {
			out = append(out, ',')
		}
		out = append(out, field...)
		last = point.end
	}
	out = append(out, body[last:]...)
	if !gjson.ValidBytes(out) {
		// Insertion only adds a field to objects gjson placed, so this should
		// not happen; a body the upstream would reject must never leave.
		return body, false
	}
	return out, true
}
