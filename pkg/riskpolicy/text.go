// Text extraction follows vm2api, Copyright (c) 2026 vm2api contributors;
// see LICENSE.vm2api.
package riskpolicy

import (
	"math"
	"strconv"
	"strings"
	"sync"

	"github.com/tidwall/gjson"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var lowercasePool = sync.Pool{New: func() any { return cases.Lower(language.Und) }}

func lowerJS(s string) string {
	ascii := true
	for i := range len(s) {
		if s[i] >= 0x80 {
			ascii = false
			break
		}
	}
	if ascii {
		return strings.ToLower(s)
	}
	caser := lowercasePool.Get().(cases.Caser)
	out := caser.String(s)
	lowercasePool.Put(caser)
	return out
}

// ECMAScript whitespace is not identical to unicode.IsSpace: in particular,
// it includes BOM but not U+0085.
func isJSSpace(r rune) bool {
	return r == '\t' || r == '\n' || r == '\v' || r == '\f' || r == '\r' ||
		r == ' ' || r == '\u00a0' || r == '\u1680' || (r >= '\u2000' && r <= '\u200a') ||
		r == '\u2028' || r == '\u2029' || r == '\u202f' || r == '\u205f' || r == '\u3000' || r == '\ufeff'
}

func trimJS(s string) string {
	return strings.TrimFunc(s, isJSSpace)
}

func normalizeText(s string) string {
	s = lowerJS(s)
	var out strings.Builder
	out.Grow(len(s))
	pendingSpace := false
	var last rune
	for _, r := range s {
		if isJSSpace(r) {
			if out.Len() > 0 && last != '\\' {
				pendingSpace = true
			}
			continue
		}
		if pendingSpace {
			out.WriteByte(' ')
		}
		pendingSpace = false
		out.WriteRune(r)
		last = r
	}
	return out.String()
}

func toolPayload(value gjson.Result) bool {
	if !value.IsObject() {
		return false
	}
	typ := jsString(value.Get("type"))
	return typ == "tool_result" || typ == "function_call_output" || strings.HasSuffix(typ, "_tool_result")
}

// The distill and hard paths intentionally differ: distill excludes only
// tool_result array parts, whereas the hard document excludes all tool payloads.
func contentText(value gjson.Result, hard bool) string {
	if value.Type == gjson.String {
		return value.Str
	}
	if value.IsArray() {
		var parts []string
		value.ForEach(func(_, part gjson.Result) bool {
			if !hard && part.Get("type").Str == "tool_result" {
				return true
			}
			if text := contentText(part, hard); text != "" {
				parts = append(parts, text)
			}
			return true
		})
		return strings.Join(parts, "\n")
	}
	if !value.IsObject() || (hard && toolPayload(value)) {
		return ""
	}
	if text := value.Get("text"); text.Type == gjson.String {
		return text.Str
	}
	content := value.Get("content")
	if content.Type == gjson.String {
		return content.Str
	}
	if content.IsArray() {
		return contentText(content, hard)
	}
	return ""
}

func systemText(body gjson.Result) string {
	if !body.IsObject() && !body.IsArray() {
		return ""
	}
	value := body.Get("system")
	if value.Type == gjson.String || value.IsArray() {
		return contentText(value, false)
	}
	value = body.Get("instructions")
	if value.Type == gjson.String || value.IsArray() {
		return contentText(value, false)
	}
	return ""
}

func messageTexts(body gjson.Result, hard bool, roles ...string) []string {
	var texts []string
	messages := body.Get("messages")
	if !messages.IsArray() {
		return texts
	}
	messages.ForEach(func(_, message gjson.Result) bool {
		role := message.Get("role")
		if role.Type != gjson.String {
			return true
		}
		for _, wanted := range roles {
			if role.Str == wanted {
				if text := contentText(message.Get("content"), hard); text != "" {
					texts = append(texts, text)
				}
				break
			}
		}
		return true
	})
	return texts
}

func userTexts(body gjson.Result, hard bool) []string {
	texts := messageTexts(body, hard, "user")
	input := body.Get("input")
	if input.Type == gjson.String {
		if input.Str != "" {
			texts = append(texts, input.Str)
		}
		return texts
	}
	if !input.IsArray() {
		return texts
	}
	input.ForEach(func(_, item gjson.Result) bool {
		if item.Type == gjson.String {
			if item.Str != "" {
				texts = append(texts, item.Str)
			}
			return true
		}
		if (!item.IsObject() && !item.IsArray()) || (hard && toolPayload(item)) {
			return true
		}
		role := item.Get("role")
		if role.Type == gjson.String && role.Str != "" && lowerJS(role.Str) != "user" {
			return true
		}
		content := item.Get("content")
		if !content.Exists() {
			content = item
		}
		if text := contentText(content, hard); text != "" {
			texts = append(texts, text)
		}
		return true
	})
	return texts
}

type prompt struct {
	user   string
	joined string
}

// sources returns the request bodies to scan. A Body identical to Inbound is
// scanned once, so an untransformed request does not double the work.
func (input Input) sources() []gjson.Result {
	if !input.Body.Exists() || input.Body.Raw == input.Inbound.Raw {
		return []gjson.Result{input.Inbound}
	}
	return []gjson.Result{input.Inbound, input.Body}
}

func extractPrompt(input Input) prompt {
	sources := input.sources()
	var users []string
	for _, src := range sources {
		users = append(users, userTexts(src, false)...)
	}
	var latest string
	if len(users) != 0 {
		latest = users[len(users)-1]
	}
	var parts []string
	for _, src := range sources {
		if text := systemText(src); text != "" {
			parts = append(parts, text)
		}
	}
	for _, src := range sources {
		parts = append(parts, messageTexts(src, false, "system", "developer")...)
	}
	if latest != "" {
		parts = append(parts, latest)
	}
	return prompt{user: latest, joined: strings.Join(parts, "\n")}
}

// clientGeneratedPrefixes start user turns that agent clients write from
// earlier work rather than from what the person typed: Claude Code's
// compaction summary and conversation checkpoint, the transcript its client
// checks carry, and Codex's reviewer prompt. Their words come from code and
// tool output, so a forbidden word in a repository would block every later
// request of the session. They are compared after normalizeText, lowercase.
var clientGeneratedPrefixes = []string{
	"<conversation-checkpoint>",
	"<transcript>",
	"this session is being continued from a previous conversation",
	"the following is the codex agent history",
	"[compaction summary",
}

func clientGenerated(normalized string) bool {
	for _, prefix := range clientGeneratedPrefixes {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return false
}

// ClientGenerated reports whether a user turn is one an agent client wrote
// from earlier work, by the same test the hard rules use.
func ClientGenerated(text string) bool {
	return clientGenerated(normalizeText(stripEnvironment(stripReminders(text))))
}

// hardDocument is the latest user text that a person wrote, which the hard
// rules match. Earlier turns were matched when each was the latest; a turn the
// gate blocked is held by the caller, so the history is not matched again.
// Matching it again blocked a whole session over a word a client had written
// into a summary of the work.
func hardDocument(input Input) string {
	latest := ""
	for _, src := range input.sources() {
		for _, text := range userTexts(src, true) {
			text = normalizeText(stripEnvironment(stripReminders(text)))
			if text == "" || clientGenerated(text) {
				continue
			}
			latest = text
		}
	}
	return prepareText(latest)
}

func jsTruthy(value gjson.Result) bool {
	switch value.Type {
	case gjson.True:
		return true
	case gjson.String:
		return value.Str != ""
	case gjson.Number:
		return value.Num != 0 && !math.IsNaN(value.Num)
	case gjson.JSON:
		return true
	default:
		return false
	}
}

func jsString(value gjson.Result) string {
	switch value.Type {
	case gjson.String:
		return value.Str
	case gjson.True:
		return "true"
	case gjson.False:
		return "false"
	case gjson.Number:
		return strconv.FormatFloat(value.Num, 'f', -1, 64)
	case gjson.JSON:
		if value.IsArray() {
			var parts []string
			value.ForEach(func(_, item gjson.Result) bool {
				parts = append(parts, jsString(item))
				return true
			})
			return strings.Join(parts, ",")
		}
		return "[object Object]"
	default:
		return ""
	}
}

func jsNumber(value gjson.Result) float64 {
	switch value.Type {
	case gjson.Number:
		return value.Num
	case gjson.True:
		return 1
	case gjson.False, gjson.Null:
		return 0
	case gjson.String, gjson.JSON:
		text := trimJS(jsString(value))
		if text == "" {
			return 0
		}
		if strings.HasPrefix(text, "0x") || strings.HasPrefix(text, "0X") || strings.HasPrefix(text, "0b") || strings.HasPrefix(text, "0B") || strings.HasPrefix(text, "0o") || strings.HasPrefix(text, "0O") {
			n, err := strconv.ParseUint(text[2:], map[byte]int{'x': 16, 'b': 2, 'o': 8}[text[1]|0x20], 64)
			if err == nil {
				return float64(n)
			}
			return math.NaN()
		}
		n, err := strconv.ParseFloat(text, 64)
		if err == nil {
			return n
		}
	}
	return math.NaN()
}

func openaiModel(input Input) bool {
	model := input.Body.Get("model")
	if model.Type == gjson.Null {
		model = input.Inbound.Get("model")
	}
	if !jsTruthy(model) {
		return false
	}
	raw := trimJS(jsString(model))
	id := raw
	for _, part := range strings.Split(raw, "/") {
		if part != "" {
			id = part
		}
	}
	id = strings.ToLower(trimJS(id))
	return strings.HasPrefix(id, "gpt") && !strings.HasPrefix(id, "gpt-image")
}

func arrayLength(value gjson.Result) int {
	if !value.IsArray() {
		return 0
	}
	// Counted in place: Array would build a slice of every element.
	count := 0
	value.ForEach(func(_, _ gjson.Result) bool {
		count++
		return true
	})
	return count
}

// ArrayLength is the number of elements of value, zero when it is not an array.
func ArrayLength(value gjson.Result) int { return arrayLength(value) }

func tokenLimit(body gjson.Result) (float64, bool) {
	for _, key := range []string{"max_tokens", "max_output_tokens", "max_new_tokens"} {
		value := body.Get(key)
		if value.Type != gjson.Null {
			return jsNumber(value), true
		}
	}
	return 0, false
}

func isHarvest(input Input, config *distillConfig) bool {
	src := input.Body
	if !src.IsObject() && !src.IsArray() {
		src = input.Inbound
	}
	messages := src.Get("messages")
	count := 0
	if messages.IsArray() {
		count = arrayLength(messages)
	} else if src.Get("input").Type != gjson.Null {
		count = 1
	}
	if config.singleTurn && count > 1 {
		return false
	}
	tools := arrayLength(src.Get("tools"))
	if tools == 0 {
		tools = arrayLength(input.Inbound.Get("tools"))
	}
	if config.noTools && tools > 0 {
		return false
	}
	if config.minTokens <= 0 || math.IsNaN(config.minTokens) || math.IsInf(config.minTokens, 0) {
		return false
	}
	limit, found := tokenLimit(src)
	if !found {
		limit, found = tokenLimit(input.Inbound)
	}
	if found && limit < config.minTokens {
		return false
	}
	thinking := input.Inbound.Get("thinking")
	if thinking.IsObject() || thinking.IsArray() {
		if lowerJS(jsString(thinking.Get("display"))) == "summarized" {
			return true
		}
		if lowerJS(jsString(thinking.Get("type"))) == "enabled" && jsNumber(thinking.Get("budget_tokens")) >= config.minTokens {
			return true
		}
	}
	effort := input.Inbound.Get("reasoning_effort")
	if !jsTruthy(effort) {
		effort = input.Inbound.Get("reasoning.effort")
	}
	switch lowerJS(jsString(effort)) {
	case "high", "xhigh", "max":
		return true
	}
	n := input.Inbound.Get("n")
	if !jsTruthy(n) {
		n = input.Inbound.Get("num_generations")
	}
	return jsTruthy(n) && jsNumber(n) > 1
}
