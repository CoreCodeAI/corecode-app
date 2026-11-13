package middleware

import (
	"math/rand"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// countModelKeysByByte is upstream's byte-at-a-time jsonModelKeyCounter.Write,
// kept as the reference the IndexByte version must agree with.
func countModelKeysByByte(data []byte) int {
	var c jsonModelKeyCounter
	for _, current := range data {
		if c.inString {
			if c.isKey {
				if c.keyLen < len(c.key) {
					c.key[c.keyLen] = current
				}
				c.keyLen++
			}
			if c.escaped {
				c.escaped = false
				continue
			}
			if current == '\\' {
				c.escaped = true
				continue
			}
			if current != '"' {
				continue
			}
			c.inString = false
			if c.isKey {
				var key string
				if c.keyLen <= len(c.key) && common.Unmarshal(c.key[:c.keyLen], &key) == nil && key == "model" {
					c.count++
				}
				c.expectingKey = false
				c.isKey = false
			}
			continue
		}
		switch current {
		case '"':
			c.inString = true
			c.isKey = c.rootObject && c.depth == 1 && c.expectingKey
			if c.isKey {
				c.key[0], c.keyLen = '"', 1
			}
		case '{':
			c.depth++
			if c.depth == 1 {
				c.rootObject, c.expectingKey = true, true
			}
		case '[':
			c.depth++
		case '}', ']':
			c.depth--
		case ',':
			if c.depth == 1 {
				c.expectingKey = true
			}
		}
	}
	return c.count
}

// countModelKeys writes data to a counter in chunks of the given size, as
// ojson.ValidReader does through a TeeReader; 0 writes it whole.
func countModelKeys(data []byte, chunk int) int {
	var c jsonModelKeyCounter
	if chunk <= 0 {
		chunk = len(data) + 1
	}
	for start := 0; start < len(data); start += chunk {
		_, _ = c.Write(data[start:min(start+chunk, len(data))])
	}
	return c.count
}

func TestJSONModelKeyCounter(t *testing.T) {
	require.Equal(t, 2, countModelKeys([]byte(`{"model":"a","x":{"model":"n"},"model":"b"}`), 0))
	require.Equal(t, 0, countModelKeys([]byte(`{"messages":[{"model":"n"}]}`), 0))
	require.Equal(t, 1, countModelKeys([]byte(`{"a":"\\","model":"x"}`), 0))
	require.Equal(t, 0, countModelKeys([]byte(`{"a":"say \"model\": 1"}`), 0))
	require.Equal(t, 2, countModelKeys([]byte(`{"model":"a","model":"b"}`), 0))
	require.Equal(t, 1, countModelKeys([]byte(`{"model":"x","data":"`+strings.Repeat("QUJD", 50000)+`"}`), 0))
}

// TestJSONModelKeyCounterMatchesByteScan compares the two scanners on random
// strings built from the characters the scanner reacts to, written whole and
// split into chunks that cut escapes and keys apart.
func TestJSONModelKeyCounterMatchesByteScan(t *testing.T) {
	rng := rand.New(rand.NewSource(11))
	pieces := []string{`"`, `\`, `\"`, `\\`, `{`, `}`, `[`, `]`, `,`, `:`, ` `, "\n", `model`, `"model"`, `"model"`, `x`, `"x"`, `é`, `{"model":1}`, `,"model":`, `"model"`}
	for i := 0; i < 20000; i++ {
		var b strings.Builder
		for j := rng.Intn(24); j > 0; j-- {
			b.WriteString(pieces[rng.Intn(len(pieces))])
		}
		data := []byte(b.String())
		want := countModelKeysByByte(data)
		for _, chunk := range []int{0, 1, 2, 3, 7} {
			require.Equal(t, want, countModelKeys(data, chunk), "chunk %d: %q", chunk, data)
		}
	}
}
