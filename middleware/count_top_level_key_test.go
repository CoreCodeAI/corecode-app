package middleware

import (
	"math/rand"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// countTopLevelJSONKeyByByte is the byte-at-a-time scanner that
// countTopLevelJSONKey replaced, kept as the reference it must agree with.
func countTopLevelJSONKeyByByte(data []byte, target string) int {
	depth := 0
	inString := false
	escaped := false
	stringStart := 0
	expectingKey := false
	count := 0
	for index, current := range data {
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if current == '\\' {
				escaped = true
				continue
			}
			if current != '"' {
				continue
			}
			inString = false
			if depth == 1 && expectingKey {
				key := string(data[stringStart:index])
				var decodedKey string
				if common.Unmarshal(data[stringStart-1:index+1], &decodedKey) == nil {
					key = decodedKey
				}
				cursor := index + 1
				for cursor < len(data) && (data[cursor] == ' ' || data[cursor] == '\t' || data[cursor] == '\r' || data[cursor] == '\n') {
					cursor++
				}
				if cursor < len(data) && data[cursor] == ':' && key == target {
					count++
				}
				expectingKey = false
			}
			continue
		}
		switch current {
		case '"':
			inString = true
			stringStart = index + 1
		case '{':
			depth++
			if depth == 1 {
				expectingKey = true
			}
		case '}':
			depth--
		case ',':
			if depth == 1 {
				expectingKey = true
			}
		}
	}
	return count
}

func TestCountTopLevelJSONKey(t *testing.T) {
	require.Equal(t, 2, countTopLevelJSONKey([]byte(`{"model":"a","x":{"model":"n"},"model":"b"}`), "model"))
	require.Equal(t, 0, countTopLevelJSONKey([]byte(`{"messages":[{"model":"n"}]}`), "model"))
	require.Equal(t, 1, countTopLevelJSONKey([]byte(`{"a":"\\","model":"x"}`), "model"))
	require.Equal(t, 0, countTopLevelJSONKey([]byte(`{"a":"say \"model\": 1"}`), "model"))
	require.Equal(t, 1, countTopLevelJSONKey([]byte(`{"model":"x","data":"`+strings.Repeat("QUJD", 50000)+`"}`), "model"))
}

// TestCountTopLevelJSONKeyMatchesByteScan compares the two scanners on
// random strings built from the characters the scanner reacts to.
func TestCountTopLevelJSONKeyMatchesByteScan(t *testing.T) {
	rng := rand.New(rand.NewSource(11))
	pieces := []string{`"`, `\`, `\"`, `\\`, `{`, `}`, `[`, `]`, `,`, `:`, ` `, "\n", `model`, `"model"`, `"model"`, `x`, `"x"`, `é`, `{"model":1}`, `,"model":`}
	for i := 0; i < 20000; i++ {
		var b strings.Builder
		for j := rng.Intn(24); j > 0; j-- {
			b.WriteString(pieces[rng.Intn(len(pieces))])
		}
		data := []byte(b.String())
		require.Equal(t, countTopLevelJSONKeyByByte(data, "model"), countTopLevelJSONKey(data, "model"), "%q", data)
	}
}
