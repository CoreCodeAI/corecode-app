package riskpolicy

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

const emptyConfig = `{"enabled":true,"skip_official":true,"skip_zero":true,"structure":{"min_max_tokens":8192,"require_no_tools":true,"require_single_turn":true,"contest_pattern":""},"hard_needles":[],"needles":[],"patterns":[],"fingerprints":[]}`

func testConfig(changes ...string) string {
	config := emptyConfig
	for i := 0; i < len(changes); i += 2 {
		config = strings.Replace(config, changes[i], changes[i+1], 1)
	}
	return config
}

func testInput(raw string) Input {
	body := gjson.Parse(raw)
	return Input{Inbound: body, Body: body}
}

func TestValidation(t *testing.T) {
	assert.NoError(t, ValidateDistill(emptyConfig))
	for _, config := range []string{
		`{`, `[]`, `{}`, `{"enabled":true}`,
		testConfig(`"skip_zero":true`, `"skip_zero":null`),
		testConfig(`"hard_needles":[]`, `"hard_needles":[42]`),
		testConfig(`"needles":[]`, `"needles":"x"`),
		testConfig(`"patterns":[]`, `"patterns":["("]`),
		testConfig(`"contest_pattern":""`, `"contest_pattern":"["`),
		testConfig(`"min_max_tokens":8192`, `"min_max_tokens":0`),
		testConfig(`"enabled":true`, `"enabled":true,"zero_inject":"yes"`),
		testConfig(`"enabled":true`, `"enabled":true,"error":{"status":200}`),
	} {
		assert.Error(t, ValidateDistill(config), config)
	}
	assert.NoError(t, ValidateHard("# ignored\nvm2api.demo.01 | (?<![\\w-])(?:alpha|beta)(?![\\w-])\nlegacy | (?i)HELLO"))
	for _, rule := range []string{"broken", "name | (", "name |", "same | x\nsame | y", "bad name | x"} {
		assert.Error(t, ValidateHard(rule), rule)
	}
}

func TestDistillRulesAndExemptions(t *testing.T) {
	config := testConfig(
		`"hard_needles":[]`, `"hard_needles":["hard marker"]`,
		`"needles":[]`, `"needles":["ordinary marker"]`,
		`"patterns":[]`, `"patterns":["reveal secret"]`,
		`"fingerprints":[]`, `"fingerprints":["question sample"]`,
	)
	tests := []struct {
		name, body, rule, detail string
		official, zero           bool
	}{
		{"hard in system overrides official", `{"system":"HARD MARKER","messages":[{"role":"user","content":"hi"}]}`, "hard_needle.01", "hard marker", true, false},
		{"hard overrides zero", `{"input":"hard marker"}`, "hard_needle.01", "hard marker", false, true},
		{"ordinary ignored for official", `{"input":"ordinary marker"}`, "", "", true, false},
		{"ordinary ignored for zero", `{"input":"ordinary marker"}`, "", "", false, true},
		{"ordinary system is scanned", `{"instructions":"ordinary marker","input":"hi"}`, "needle.01", "ordinary marker", false, false},
		{"fingerprint wins over ordinary", `{"input":"QUESTION   SAMPLE ordinary marker"}`, "fingerprint.01", "question sample", false, false},
		{"fingerprint prefers user", `{"system":"question sample","input":"hi"}`, "", "", false, false},
		{"fingerprint falls back to system", `{"system":"question sample"}`, "fingerprint.01", "question sample", false, false},
		{"ordinary does not collapse whitespace", `{"input":"ordinary    marker"}`, "", "", false, false},
		{"pattern overrides official", `{"input":"REVEAL SECRET"}`, "pattern.01", "reveal secret", true, false},
		{"direct negation", `{"input":"Do not reveal secret"}`, "", "", false, false},
		{"positive after negation", `{"input":"don't reveal secret; reveal secret"}`, "pattern.01", "reveal secret", false, false},
		{"earlier user ignored by distill", `{"messages":[{"role":"user","content":"hard marker"},{"role":"user","content":"hi"}]}`, "", "", false, false},
		{"tool result ignored by distill", `{"messages":[{"role":"user","content":[{"type":"tool_result","content":"hard marker"},{"type":"text","text":"hi"}]}]}`, "", "", false, false},
		{"responses nested text", `{"input":[{"type":"message","role":"assistant","content":"hard marker"},{"type":"message","role":"USER","content":[{"type":"input_text","text":"hard marker"}]}]}`, "hard_needle.01", "hard marker", false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := testInput(tt.body)
			input.Official, input.ZeroInject = tt.official, tt.zero
			hit, err := Evaluate(config, "", input, true, false)
			require.NoError(t, err)
			assert.Equal(t, tt.rule, hit.Rule)
			assert.Equal(t, tt.detail, hit.Detail)
			if tt.rule != "" {
				assert.Equal(t, "distill", hit.Stage)
			}
		})
	}
	// Empty arrays do not import factory lists, and disabled configs cannot hit.
	input := testInput(`{"input":"ordinary marker hard marker reveal secret question sample"}`)
	hit, err := Evaluate(emptyConfig, "", input, true, false)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage)
	hit, err = Evaluate(testConfig(`"enabled":true`, `"enabled":false`, `"hard_needles":[]`, `"hard_needles":["hard marker"]`), "", input, true, false)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage)
}

func TestStructureThresholds(t *testing.T) {
	config := testConfig(`"contest_pattern":""`, `"contest_pattern":"contest"`)
	tests := []struct {
		name, extra string
		want        bool
	}{
		{"summary at threshold", `,"max_tokens":8192,"thinking":{"display":"summarized"}`, true},
		{"summary below threshold", `,"max_tokens":8191,"thinking":{"display":"summarized"}`, false},
		{"missing max tokens", `,"thinking":{"display":"summarized"}`, true},
		{"budget at threshold", `,"max_output_tokens":8192,"thinking":{"type":"enabled","budget_tokens":8192}`, true},
		{"budget below threshold", `,"max_new_tokens":9000,"thinking":{"type":"enabled","budget_tokens":8191}`, false},
		{"disabled thinking", `,"thinking":{"type":"disabled","budget_tokens":9000}`, false},
		{"adaptive without summary", `,"thinking":{"type":"adaptive"}`, false},
		{"high reasoning effort", `,"reasoning":{"effort":"XHIGH"}`, true},
		{"top level effort", `,"reasoning_effort":"max"`, true},
		{"generation count", `,"n":2`, true},
		{"fallback generation count", `,"n":0,"num_generations":2`, true},
		{"single generation", `,"num_generations":1`, false},
		{"tools stop harvest", `,"tools":[{"name":"tool"}],"n":2`, false},
		{"multiple turns stop harvest", `,"messages":[{"role":"user","content":"first"},{"role":"user","content":"contest"}],"n":2`, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := testInput(`{"input":"contest"` + tt.extra + `}`)
			hit, err := Evaluate(config, "", input, true, false)
			require.NoError(t, err)
			assert.Equal(t, tt.want, hit.Rule == "harvest")
		})
	}
	// Body structure uses inbound tool fallback; thinking is always inbound.
	inbound := gjson.Parse(`{"model":"claude-x","input":"contest","tools":[{}],"thinking":{"display":"summarized"}}`)
	body := gjson.Parse(`{"model":"claude-x","input":"contest","tools":[]}`)
	hit, err := Evaluate(config, "", Input{Inbound: inbound, Body: body}, true, false)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage)
}

func TestHardRulesHistoryAndGates(t *testing.T) {
	rules := "vm2api.distill.01 | (?<![\\w-])extract-me(?![\\w-])\nvm2api.demo.01 | (?<![\\w-])needle(?![\\w-])"
	tests := []struct {
		name, model, text, stage, rule string
		distill, hard, openai          bool
	}{
		{"distill independent of hard", "claude-x", "extract-me", "distill", "vm2api.distill.01", true, false, false},
		{"distill disabled", "claude-x", "extract-me", "", "", false, true, false},
		{"normal independent of distill", "claude-x", "needle", "hard_regex", "vm2api.demo.01", false, true, false},
		{"normal disabled", "claude-x", "needle", "", "", true, false, false},
		{"token starts after hyphen", "claude-x", "other-needle", "", "", false, true, false},
		{"token ends before underscore", "claude-x", "needle_more", "", "", false, true, false},
		{"token with punctuation", "claude-x", "NEEDLE!", "hard_regex", "vm2api.demo.01", false, true, false},
		{"gpt skips all", "openai/GPT-5", "needle", "", "", true, true, false},
		{"gpt enabled normal rule", "openai/GPT-5", "needle", "hard_regex", "vm2api.demo.01", true, true, true},
		{"gpt always skips distill", "GPT-5", "extract-me", "", "", true, true, true},
		{"gpt image not chat", "gpt-image-1", "needle", "hard_regex", "vm2api.demo.01", true, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := emptyConfig
			if tt.openai {
				config = testConfig(`"enabled":true`, `"enabled":true,"openai_platform_enabled":true`)
			}
			input := testInput(fmt.Sprintf(`{"model":%q,"input":%q}`, tt.model, tt.text))
			input.Official, input.ZeroInject = true, true
			hit, err := Evaluate(config, rules, input, tt.distill, tt.hard)
			require.NoError(t, err)
			assert.Equal(t, tt.stage, hit.Stage)
			assert.Equal(t, tt.rule, hit.Rule)
		})
	}
	// Only the latest user text is matched: an earlier turn was matched when it
	// was the latest, and the caller holds a conversation it blocked.
	input := testInput(`{"messages":[{"role":"user","content":"old needle"},{"role":"assistant","content":"ok"},{"role":"user","content":"hello"}]}`)
	hit, err := Evaluate(emptyConfig, rules, input, true, true)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage, "a word in an earlier turn does not block the latest")
	input = testInput(`{"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"ok"},{"role":"user","content":"a needle now"}]}`)
	hit, err = Evaluate(emptyConfig, rules, input, true, true)
	require.NoError(t, err)
	assert.Equal(t, "vm2api.demo.01", hit.Rule)
	assert.Equal(t, "a needle now", hit.Excerpt)
	assert.Equal(t, "a [needle] now", hit.Context)
	// A user turn holding only a tool result or a reminder is not the latest text.
	input = testInput(`{"messages":[{"role":"user","content":"a needle now"},{"role":"assistant","content":"ok"},{"role":"user","content":[{"type":"tool_result","content":"fine"},{"type":"text","text":"<system-reminder>x</system-reminder>"}]}]}`)
	hit, err = Evaluate(emptyConfig, rules, input, true, true)
	require.NoError(t, err)
	assert.Equal(t, "vm2api.demo.01", hit.Rule, "the person's last text is still the latest")
}

func TestHardRulesSkipClientGeneratedTurns(t *testing.T) {
	rules := "vm2api.demo.01 | (?<![\\w-])needle(?![\\w-])"
	for _, text := range []string{
		"<conversation-checkpoint> The following is a summary of earlier work: the needle module",
		"<transcript> {\"user\":\"build the needle\"}",
		"This session is being continued from a previous conversation that ran out of context. needle",
		"The following is the Codex agent history whose request action you are assessing. needle",
		"[Compaction summary — written by the assistant] needle",
	} {
		input := testInput(fmt.Sprintf(`{"messages":[{"role":"user","content":"hello"},{"role":"assistant","content":"ok"},{"role":"user","content":%q}]}`, text))
		hit, err := Evaluate(emptyConfig, rules, input, false, true)
		require.NoError(t, err)
		assert.Empty(t, hit.Stage, text)
		assert.True(t, ClientGenerated(text), text)
	}
	assert.False(t, ClientGenerated("please explain the transcript format"))
}

func TestMatchContext(t *testing.T) {
	long := strings.Repeat("a", 50) + "keygen" + strings.Repeat("b", 50)
	assert.Equal(t, "…"+strings.Repeat("a", 40)+"[keygen]"+strings.Repeat("b", 40)+"…", matchContext(long, "keygen"))
	assert.Equal(t, "实现 ml-kem [keygen] 函数", matchContext("实现 ml-kem keygen 函数", "keygen"))
	assert.Empty(t, matchContext("text", "absent"))
}

func TestHardTextPreparationAndResponses(t *testing.T) {
	rule := `demo | danger`
	tests := []struct {
		name, body string
		want       bool
	}{
		{"system is excluded", `{"system":"danger","input":"hello"}`, false},
		{"closed reminder excluded", `{"input":"<SYSTEM-REMINDER>danger</system-reminder> hello"}`, false},
		{"unclosed reminder retained", `{"input":"<system-reminder>danger"}`, true},
		{"environment block excluded", `{"input":"# Environment\n - value: danger\n\nhello"}`, false},
		{"prose after environment retained", `{"input":"# Environment\n - shell: zsh\ndanger"}`, true},
		{"tools ignored", `{"messages":[{"role":"user","content":[{"type":"web_search_tool_result","content":"danger"},{"type":"tool_result","content":"danger"},{"type":"function_call_output","text":"danger"},{"type":"text","text":"hello"}]}]}`, false},
		{"roleless response tool ignored", `{"input":[{"type":"function_call_output","content":"danger"}]}`, false},
		{"assistant response ignored", `{"input":[{"role":"assistant","content":"danger"}]}`, false},
		{"response content read", `{"input":[{"role":"user","content":[{"type":"input_text","text":"danger"}]}]}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			hit, err := Evaluate(emptyConfig, rule, testInput(tt.body), false, true)
			require.NoError(t, err)
			assert.Equal(t, tt.want, hit.Rule == "demo")
		})
	}
	// These base64 runs stay lowercase under upstream user-document normalization.
	encodedWon := strings.Repeat("d29u", 8)
	encodedWol := strings.Repeat("d29s", 8)
	input := testInput(fmt.Sprintf(`{"input":%q}`, encodedWon))
	hit, err := Evaluate(emptyConfig, `decoded | wonwon`, input, false, true)
	require.NoError(t, err)
	assert.Equal(t, "decoded", hit.Rule)
	input = testInput(fmt.Sprintf(`{"input":%q}`, strings.Repeat(encodedWol+" ", 24)+encodedWon))
	hit, err = Evaluate(emptyConfig, `decoded | wonwon`, input, false, true)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage, "25th decoded segment exceeds eight segments in each of three passes")
}

func TestCrossSourceExtractionAndOrdering(t *testing.T) {
	config := testConfig(`"hard_needles":[]`, `"hard_needles":["boundary\nboundary"]`)
	inbound := gjson.Parse(`{"system":"boundary","input":"old"}`)
	body := gjson.Parse(`{"system":"boundary","input":"latest"}`)
	hit, err := Evaluate(config, "", Input{Inbound: inbound, Body: body}, true, false)
	require.NoError(t, err)
	assert.Equal(t, "hard_needle.01", hit.Rule, "system is repeated across inbound and body")
	assert.Equal(t, "latest", hit.Excerpt)

	rules := "vm2api.demo.02 | second\nvm2api.demo.01 | first"
	hit, err = Evaluate(emptyConfig, rules, testInput(`{"input":"first second"}`), false, true)
	require.NoError(t, err)
	assert.Equal(t, "vm2api.demo.02", hit.Rule, "rules are ordered by configuration, not text position")
}

func TestRegexUsesJavaScriptUTF16Units(t *testing.T) {
	input := testInput(`{"input":"😀"}`)
	for _, tt := range []struct {
		pattern string
		want    bool
	}{
		{`^.$`, false},
		{`^..$`, true},
		{`^😀$`, true},
		{`^\ud83d\ude00$`, true},
		{`^😀{2}$`, false},
	} {
		hit, err := Evaluate(emptyConfig, "unicode | "+tt.pattern, input, false, true)
		require.NoError(t, err)
		assert.Equal(t, tt.want, hit.Rule == "unicode", tt.pattern)
	}
}

func TestRegexUsesJavaScriptCaseCanonicalization(t *testing.T) {
	for _, tt := range []struct {
		pattern, text string
		want          bool
	}{
		{`s`, "ſ", false},
		{`ſ`, "s", false},
		{`µ`, "μ", true},
		{`[a-z]`, "ſ", false},
	} {
		input := testInput(fmt.Sprintf(`{"input":%q}`, tt.text))
		hit, err := Evaluate(emptyConfig, "case | "+tt.pattern, input, false, true)
		require.NoError(t, err)
		assert.Equal(t, tt.want, hit.Rule == "case", tt)
	}
}

func TestConcurrentPolicyEvaluation(t *testing.T) {
	for i, text := range []string{"alpha", "beta", "clean", "alpha-beta", "(beta)", "ſ", "😀"} {
		t.Run(fmt.Sprintf("request-%d", i), func(t *testing.T) {
			t.Parallel()
			input := testInput(fmt.Sprintf(`{"input":%q}`, text))
			hit, err := Evaluate(emptyConfig, `bounded | (?<![\w-])(?:alpha|beta)(?![\w-])`, input, false, true)
			require.NoError(t, err)
			assert.Equal(t, text == "alpha" || text == "beta" || text == "(beta)", hit.Rule == "bounded")
		})
	}
}

func TestIdenticalSourcesScannedOnce(t *testing.T) {
	config := testConfig(`"hard_needles":[]`, `"hard_needles":["boundary\nboundary"]`)
	hit, err := Evaluate(config, "", testInput(`{"system":"boundary","input":"latest"}`), true, false)
	require.NoError(t, err)
	assert.Empty(t, hit.Stage, "an untransformed request contributes its system prompt once")
	assert.Equal(t, prompt{user: "latest", joined: "boundary\nlatest"}, extractPrompt(testInput(`{"system":"boundary","input":"latest"}`)))
}

func TestVerdictCache(t *testing.T) {
	rules := "cached | needle"
	input := testInput(`{"input":"a needle here"}`)
	hit, err := Evaluate(emptyConfig, rules, input, false, true)
	require.NoError(t, err)
	assert.Equal(t, "cached", hit.Rule)
	key := verdictKey([]string{emptyConfig, rules, "a needle here", "a needle here", hardDocument(input)}, false, true, false, false, false, false)
	verdictCache.Lock()
	cached, found := verdictCache.verdicts[key]
	verdictCache.Unlock()
	require.True(t, found)
	assert.Equal(t, hit, cached.hit)

	hit, err = Evaluate(emptyConfig, rules, testInput(`{"input":"a needle here"}`), false, true)
	require.NoError(t, err)
	assert.Equal(t, "cached", hit.Rule)
	hit, err = Evaluate(emptyConfig, "other | needle", input, false, true)
	require.NoError(t, err)
	assert.Equal(t, "other", hit.Rule, "a rule change is a different key")
}

func TestRegexFaultCarriesStageAndIsNotCached(t *testing.T) {
	// (\w+)+\1x backtracks past the match timeout on a long "abab..." text.
	const slow = `(\w+)+\1x`
	slowPatternConfig := testConfig(`"patterns":[]`, `"patterns":["(\\w+)+\\1x","ababab"]`)
	tests := []struct {
		name, config, rules string
		distill             bool
		stage, rule         string // the hit, when a later rule matches
		faultStage          string // the StageError, when nothing matches
	}{
		{"hard timeout alone", emptyConfig, "slow | " + slow, false, "", "", "hard_regex"},
		{"later hard rule after a hard timeout", emptyConfig, "slow | " + slow + "\nlater | ababab", false, "hard_regex", "later", ""},
		{"later hard rule after a distill hard rule timeout", emptyConfig, "vm2api.distill.01 | " + slow + "\nlater | ababab", true, "hard_regex", "later", ""},
		{"distill hard rule timeout alone", emptyConfig, "vm2api.distill.01 | " + slow, true, "", "", "distill"},
		{"later pattern after a pattern timeout", slowPatternConfig, "", true, "distill", "pattern.02", ""},
		{"hard rule after a pattern timeout", testConfig(`"patterns":[]`, `"patterns":["(\\w+)+\\1x"]`), "later | ababab", true, "hard_regex", "later", ""},
		{"pattern timeout alone", testConfig(`"patterns":[]`, `"patterns":["(\\w+)+\\1x"]`), "", true, "", "", "distill"},
	}
	input := testInput(`{"input":"` + strings.Repeat("ab", 2000) + `"}`)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for range 2 {
				hit, err := Evaluate(tt.config, tt.rules, input, tt.distill, true)
				if tt.faultStage == "" {
					require.NoError(t, err)
					assert.Equal(t, []string{tt.stage, tt.rule}, []string{hit.Stage, hit.Rule})
					continue
				}
				var stageErr *StageError
				require.ErrorAs(t, err, &stageErr, "a fault with no hit is reported, and is not cached as clean")
				assert.Equal(t, tt.faultStage, stageErr.Stage)
				assert.Empty(t, hit.Stage)
			}
		})
	}
}
