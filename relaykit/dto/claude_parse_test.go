package dto

import (
	"math/rand"
	"reflect"
	"strings"
	"testing"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/stretchr/testify/require"
)

func randomPayload(rng *rand.Rand) any {
	switch rng.Intn(6) {
	case 0:
		return strings.Repeat("QUJD", 700+rng.Intn(200)) // long base64
	case 1:
		return "short"
	case 2:
		return strings.Repeat("\xff", 3000) // long, invalid UTF-8
	case 3:
		return float64(rng.Intn(10))
	case 4:
		return strings.Repeat("é", 1500) // long, multibyte
	default:
		return nil
	}
}

func randomTree(rng *rand.Rand, depth int) any {
	if depth > 3 {
		return randomPayload(rng)
	}
	switch rng.Intn(4) {
	case 0:
		items := make([]any, rng.Intn(4))
		for i := range items {
			items[i] = randomTree(rng, depth+1)
		}
		return items
	case 1:
		return randomPart(rng, depth+1)
	default:
		return randomPayload(rng)
	}
}

// randomPart builds a map shaped like a media block, with fields that decode,
// fields of the wrong type, unknown fields and payloads in every position the
// parser has to account for.
func randomPart(rng *rand.Rand, depth int) map[string]any {
	part := map[string]any{}
	types := []string{"text", "image", "tool_use", "tool_result", "document", "thinking"}
	if rng.Intn(10) > 0 {
		part["type"] = types[rng.Intn(len(types))]
	}
	if rng.Intn(2) == 0 {
		part["text"] = "hello <b> & world"
	}
	if rng.Intn(3) == 0 {
		part["data"] = randomPayload(rng)
	}
	if rng.Intn(2) == 0 {
		source := map[string]any{"type": "base64", "media_type": "image/png", "data": randomPayload(rng)}
		if rng.Intn(5) == 0 {
			source["url"] = randomPayload(rng)
		}
		if rng.Intn(8) == 0 {
			source["type"] = 7.0
		}
		part["source"] = source
	}
	if rng.Intn(3) == 0 {
		part["content"] = randomTree(rng, depth+1)
	}
	if rng.Intn(4) == 0 {
		part["input"] = randomTree(rng, depth+1)
	}
	if rng.Intn(6) == 0 {
		part["cache_control"] = map[string]any{"type": "ephemeral", "data": randomPayload(rng)}
	}
	if rng.Intn(6) == 0 {
		part["citations"] = []any{map[string]any{"data": randomPayload(rng)}}
	}
	if rng.Intn(6) == 0 {
		part["usage"] = map[string]any{"input_tokens": 3.0, "data": randomPayload(rng)}
	}
	if rng.Intn(6) == 0 {
		part["mystery"] = map[string]any{"data": randomPayload(rng)}
	}
	if rng.Intn(10) == 0 {
		part["is_error"] = "yes"
	}
	if rng.Intn(10) == 0 {
		part["Data"] = randomPayload(rng)
	}
	return part
}

// TestParseClaudeMediaMatchesRoundTrip checks that setting payloads aside
// gives exactly the result of the plain JSON round trip, errors included.
func TestParseClaudeMediaMatchesRoundTrip(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 4000; i++ {
		items := make([]any, rng.Intn(5))
		for j := range items {
			if rng.Intn(15) == 0 {
				items[j] = randomPayload(rng)
				continue
			}
			items[j] = randomPart(rng, 0)
		}
		var content any = items
		if rng.Intn(20) == 0 {
			content = randomPayload(rng)
		}
		want, wantErr := kitutil.Any2Type[[]ClaudeMediaMessage](content)
		got, gotErr := parseClaudeMedia(content)
		require.Equal(t, wantErr == nil, gotErr == nil, "case %d", i)
		require.True(t, reflect.DeepEqual(want, got), "case %d", i)
	}
}

func TestParseClaudeMediaLeavesInputUntouched(t *testing.T) {
	payload := strings.Repeat("QUJD", 1000)
	content := []any{map[string]any{"type": "image", "source": map[string]any{"type": "base64", "data": payload}}}
	parts, err := parseClaudeMedia(content)
	require.NoError(t, err)
	require.Equal(t, payload, parts[0].Source.Data)
	require.Equal(t, payload, content[0].(map[string]any)["source"].(map[string]any)["data"])
}

func BenchmarkParseClaudeMedia(b *testing.B) {
	payload := strings.Repeat("QUJD", 100_000)
	content := []any{
		map[string]any{"type": "text", "text": "look at this"},
		map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": "image/png", "data": payload}},
		map[string]any{"type": "tool_result", "tool_use_id": "t", "content": []any{map[string]any{"type": "image", "source": map[string]any{"type": "base64", "data": payload}}}},
	}
	b.Run("round_trip", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_, _ = kitutil.Any2Type[[]ClaudeMediaMessage](content)
		}
	})
	b.Run("payloads_aside", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			_, _ = parseClaudeMedia(content)
		}
	})
}
