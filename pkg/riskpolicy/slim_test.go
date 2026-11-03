package riskpolicy

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func payload(n int) string { return strings.Repeat("QUJD", n/4) }

func TestSlim(t *testing.T) {
	long := payload(4096)
	tests := []struct {
		name, body, want string
	}{
		{"claude image", `{"a":{"source":{"type":"base64","data":"` + long + `"}}}`, `{"a":{"source":{"type":"base64","data":""}}}`},
		{"spaced key", `{"data" :  "` + long + `"}`, `{"data" :  ""}`},
		{"openai url", `{"image_url":{"url":"` + long + `"}}`, `{"image_url":{"url":""}}`},
		{"responses image", `{"image_url":"` + long + `"}`, `{"image_url":""}`},
		{"file data", `{"file_data":"` + long + `"}`, `{"file_data":""}`},
		{"short value kept", `{"data":"abc"}`, `{"data":"abc"}`},
		{"other key kept", `{"text":"` + long + `"}`, `{"text":"` + long + `"}`},
		{"longer key kept", `{"mydata":"` + long + `"}`, `{"mydata":"` + long + `"}`},
		{"key prefix kept", `{"data2":"` + long + `"}`, `{"data2":"` + long + `"}`},
		{"array element kept", `{"data":["` + long + `"]}`, `{"data":["` + long + `"]}`},
		{"escaped quote in key kept", `{"x\"data":"` + long + `"}`, `{"x\"data":"` + long + `"}`},
		{"key after escaped backslash", `{"x\\":1,"data":"` + long + `"}`, `{"x\\":1,"data":""}`},
		{"escapes inside payload", `{"data":"` + long + `\"` + long + `\\"}`, `{"data":""}`},
		{"quotes in earlier text", `{"text":"say \"data\": \"hi\"","data":"` + long + `"}`, `{"text":"say \"data\": \"hi\"","data":""}`},
		{"text mentioning key", `{"text":"` + strings.Repeat(`"data":"`+payload(8)+`" `, 400) + `"}`, `{"text":"` + strings.Repeat(`"data":"`+payload(8)+`" `, 400) + `"}`},
		{"unterminated string", `{"data":"` + long, `{"data":"` + long},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// The unterminated case is not valid JSON on purpose.
			got := string(Slim([]byte(tt.body)))
			assert.Equal(t, tt.want, got)
			if json.Valid([]byte(tt.body)) {
				assert.True(t, json.Valid([]byte(got)))
			}
		})
	}
}

// slimConfig is a generic policy with a rule of every kind the gate reads.
var slimConfig = testConfig(
	`"hard_needles":[]`, `"hard_needles":["hard marker"]`,
	`"needles":[]`, `"needles":["ordinary marker"]`,
	`"patterns":[]`, `"patterns":["reveal secret"]`,
	`"fingerprints":[]`, `"fingerprints":["question sample"]`,
	`"contest_pattern":""`, `"contest_pattern":"contest"`,
)

const slimHardRules = "vm2api.demo.01 | (?i)needle-in-text\nlegacy | (?i)forbidden phrase"

// slimBody assembles a Claude, Responses or chat body that places images and
// text in every position the policy reads, at random.
func slimBody(rng *rand.Rand) string {
	image := func() string { return payload(2048 + rng.Intn(4000)) }
	phrases := []string{"hard marker", "ordinary marker", "reveal secret", "question sample", "contest", "needle-in-text", "forbidden phrase", "nothing special", "do not reveal secret"}
	text := func() string { return phrases[rng.Intn(len(phrases))] }
	part := func(depth int) string {
		switch rng.Intn(6) {
		case 0:
			return fmt.Sprintf(`{"type":"text","text":%q}`, text())
		case 1:
			return fmt.Sprintf(`{"type":"image","source":{"type":"base64","media_type":"image/png","data":"%s"}}`, image())
		case 2:
			return fmt.Sprintf(`{"type":"tool_result","tool_use_id":"t","content":[{"type":"image","source":{"type":"base64","data":"%s"}},{"type":"text","text":%q}]}`, image(), text())
		case 3:
			return fmt.Sprintf(`{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"%s"},"text":%q}`, image(), text())
		case 4:
			return fmt.Sprintf(`{"type":"input_image","image_url":"data:image/png;base64,%s"}`, image())
		default:
			return fmt.Sprintf(`{"type":"image_url","image_url":{"url":"data:image/png;base64,%s"},"text":%q}`, image(), text())
		}
	}
	message := func(role string) string {
		if rng.Intn(4) == 0 {
			return fmt.Sprintf(`{"role":%q,"content":%q}`, role, text())
		}
		parts := make([]string, 1+rng.Intn(4))
		for i := range parts {
			parts[i] = part(0)
		}
		return fmt.Sprintf(`{"role":%q,"content":[%s]}`, role, strings.Join(parts, ","))
	}
	messages := make([]string, 1+rng.Intn(6))
	roles := []string{"user", "assistant", "system", "developer"}
	for i := range messages {
		messages[i] = message(roles[rng.Intn(len(roles))])
	}
	body := fmt.Sprintf(`{"model":"claude-opus-5-5","messages":[%s]`, strings.Join(messages, ","))
	if rng.Intn(2) == 0 {
		body += fmt.Sprintf(`,"system":[{"type":"text","text":%q}]`, text())
	}
	if rng.Intn(3) == 0 {
		body += fmt.Sprintf(`,"input":[{"type":"message","role":"user","content":[%s]}]`, part(0))
	}
	if rng.Intn(3) == 0 {
		body += `,"tools":[{"name":"Read","description":"x"}]`
	}
	if rng.Intn(3) == 0 {
		body += `,"thinking":{"type":"enabled","budget_tokens":10000},"max_tokens":16000`
	}
	return body + `}`
}

// TestSlimKeepsVerdicts checks that evaluating the slim body gives the verdict
// of the full body, hit or miss, across random bodies and all three rule
// stages. It also checks the fields the gate's client recognition reads.
func TestSlimKeepsVerdicts(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	hits := map[string]int{}
	for i := 0; i < 600; i++ {
		raw := slimBody(rng)
		require.True(t, json.Valid([]byte(raw)))
		slim := string(Slim([]byte(raw)))
		require.True(t, json.Valid([]byte(slim)), raw)
		if strings.Contains(raw, "data") {
			assert.Less(t, len(slim), len(raw))
		}
		for _, official := range []bool{false, true} {
			full := Input{Inbound: gjson.Parse(raw), Body: gjson.Parse(raw), Official: official}
			small := Input{Inbound: gjson.Parse(slim), Body: gjson.Parse(slim), Official: official}
			for _, enabled := range [][2]bool{{true, true}, {true, false}, {false, true}} {
				want, wantErr := Evaluate(slimConfig, slimHardRules, full, enabled[0], enabled[1])
				got, gotErr := Evaluate(slimConfig, slimHardRules, small, enabled[0], enabled[1])
				require.Equal(t, wantErr == nil, gotErr == nil)
				require.Equal(t, want, got, raw)
				hits[want.Rule]++
			}
		}
	}
	// The comparison is only meaningful if the bodies hit rules of each kind.
	for _, rule := range []string{"", "hard_needle.01", "needle.01", "pattern.01", "fingerprint.01", "vm2api.demo.01", "legacy"} {
		assert.Positive(t, hits[rule], "no body produced %q", rule)
	}
}
