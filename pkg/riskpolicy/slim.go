package riskpolicy

import "bytes"

// slimMinBytes is the shortest string value that Slim replaces.
const slimMinBytes = 2048

// payloadKeys are the object keys whose long string values are binary payloads
// in the request formats the gate reads: Claude image and document sources
// (data), OpenAI chat image urls (url), Responses images and files
// (image_url, file_data). The policy reads text and content values only, so a
// payload under one of these keys never changes a verdict.
var payloadKeys = [][]byte{[]byte("data"), []byte("url"), []byte("image_url"), []byte("file_data")}

// Slim returns body with every long string value under a payload key emptied.
// A Claude Code body is mostly base64 screenshots, and every gjson lookup that
// passes over them scans each byte; the slim copy keeps the same structure,
// keys and text, at a fraction of the size. It finds string ends with
// bytes.IndexByte, so the payloads themselves are crossed at memory speed.
//
// Slim returns body itself when nothing is replaced, and also when body is not
// well-formed enough to scan (an unterminated string). The result is valid JSON
// whenever body is.
func Slim(body []byte) []byte {
	type span struct{ from, to int }
	var cut []span
	removed := 0
	for i := 0; ; {
		q := bytes.IndexByte(body[i:], '"')
		if q < 0 {
			break
		}
		start := i + q
		end, ok := stringEnd(body, start)
		if !ok {
			return body
		}
		if end-start-1 >= slimMinBytes && payloadValue(body, start) {
			cut = append(cut, span{start + 1, end})
			removed += end - start - 1
		}
		i = end + 1
	}
	if len(cut) == 0 {
		return body
	}
	out := make([]byte, 0, len(body)-removed)
	last := 0
	for _, c := range cut {
		out = append(out, body[last:c.from]...)
		last = c.to
	}
	return append(out, body[last:]...)
}

// stringEnd returns the index of the closing quote of the string whose opening
// quote is at start.
func stringEnd(body []byte, start int) (int, bool) {
	for j := start + 1; ; {
		k := bytes.IndexByte(body[j:], '"')
		if k < 0 {
			return 0, false
		}
		end := j + k
		if !escaped(body, end, start) {
			return end, true
		}
		j = end + 1
	}
}

// escaped reports whether the quote at index is preceded by an odd number of
// backslashes, without reaching back past floor.
func escaped(body []byte, index, floor int) bool {
	n := 0
	for p := index - 1; p > floor && body[p] == '\\'; p-- {
		n++
	}
	return n%2 == 1
}

// payloadValue reports whether the string opening at start is the value of a
// payload key: the preceding tokens are a colon and a key from payloadKeys.
func payloadValue(body []byte, start int) bool {
	p := start - 1
	for p >= 0 && isJSONSpace(body[p]) {
		p--
	}
	if p < 0 || body[p] != ':' {
		return false
	}
	p--
	for p >= 0 && isJSONSpace(body[p]) {
		p--
	}
	if p < 0 || body[p] != '"' {
		return false
	}
	closing := p
	for _, key := range payloadKeys {
		open := closing - len(key) - 1
		if open < 0 || body[open] != '"' || !bytes.Equal(body[open+1:closing], key) {
			continue
		}
		// The opening quote must be a real one, not an escaped quote inside a
		// longer key.
		if !escaped(body, open, -1) {
			return true
		}
	}
	return false
}

func isJSONSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
