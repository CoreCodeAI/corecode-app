package dto

import (
	"crypto/rand"
	"encoding/hex"
	"maps"
	"strconv"
	"strings"
	"unicode/utf8"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
)

// payloadMinBytes is the shortest "data" string that parseClaudeMedia sets
// aside before the JSON round trip.
const payloadMinBytes = 2048

// payloadMarker prefixes the stand-in for a set-aside payload. It carries a
// per-process random value, so no request can contain it.
var payloadMarker = func() string {
	var nonce [8]byte
	_, _ = rand.Read(nonce[:])
	return "\x00relaykit-payload-" + hex.EncodeToString(nonce[:]) + "-"
}()

// parseClaudeMedia converts message content to media blocks through a JSON
// round trip, as kitutil.Any2Type does, but without copying the base64
// payloads of images and documents through it. A Claude Code request carries
// megabytes of them, and the round trip marshals, scans and copies each one
// several times.
//
// Long strings under a "data" key are replaced by short stand-ins before the
// round trip and put back afterwards. A stand-in is a string, so it decodes
// exactly where the payload would, and the result equals the plain round
// trip's. Anything the stand-ins cannot account for, such as a payload that
// landed in a raw field or was dropped as an unknown field, takes the plain
// round trip.
func parseClaudeMedia(content any) ([]ClaudeMediaMessage, error) {
	items, ok := content.([]any)
	if !ok {
		return kitutil.Any2Type[[]ClaudeMediaMessage](content)
	}
	var stash payloadStash
	slim, changed := stash.slim(items)
	if !changed {
		return kitutil.Any2Type[[]ClaudeMediaMessage](content)
	}
	parsed, err := kitutil.Any2Type[[]ClaudeMediaMessage](slim)
	if err != nil {
		return kitutil.Any2Type[[]ClaudeMediaMessage](content)
	}
	restored := 0
	for i := range parsed {
		part := &parsed[i]
		if stash.isStandIn(part.Data) {
			part.Data = stash.values[stash.index(part.Data)]
			restored++
		}
		if part.Source != nil {
			var n int
			part.Source.Data, n = stash.restore(part.Source.Data)
			restored += n
		}
		var n int
		part.Content, n = stash.restore(part.Content)
		restored += n
		part.Input, n = stash.restore(part.Input)
		restored += n
	}
	if restored != len(stash.values) {
		return kitutil.Any2Type[[]ClaudeMediaMessage](content)
	}
	return parsed, nil
}

type payloadStash struct {
	values []string
}

func (s *payloadStash) standIn(value string) string {
	s.values = append(s.values, value)
	return payloadMarker + strconv.Itoa(len(s.values)-1)
}

func (s *payloadStash) isStandIn(value string) bool {
	if !strings.HasPrefix(value, payloadMarker) {
		return false
	}
	index, err := strconv.Atoi(value[len(payloadMarker):])
	return err == nil && index >= 0 && index < len(s.values)
}

func (s *payloadStash) index(standIn string) int {
	index, _ := strconv.Atoi(standIn[len(payloadMarker):])
	return index
}

// slim returns v with long "data" strings replaced, copying only the maps and
// slices on the way to a replacement. The input is never modified.
func (s *payloadStash) slim(v any) (any, bool) {
	switch v := v.(type) {
	case map[string]any:
		var out map[string]any
		for key, value := range v {
			var replaced any
			changed := false
			if text, ok := value.(string); ok {
				if key == "data" && len(text) >= payloadMinBytes && utf8.ValidString(text) {
					replaced, changed = s.standIn(text), true
				}
			} else {
				replaced, changed = s.slim(value)
			}
			if changed {
				if out == nil {
					out = maps.Clone(v)
				}
				out[key] = replaced
			}
		}
		if out != nil {
			return out, true
		}
	case []any:
		var out []any
		for i, value := range v {
			if replaced, changed := s.slim(value); changed {
				if out == nil {
					out = append([]any(nil), v...)
				}
				out[i] = replaced
			}
		}
		if out != nil {
			return out, true
		}
	}
	return v, false
}

// restore puts the payloads back into a decoded tree, which it owns, and
// reports how many it restored.
func (s *payloadStash) restore(v any) (any, int) {
	switch v := v.(type) {
	case string:
		if s.isStandIn(v) {
			return s.values[s.index(v)], 1
		}
	case map[string]any:
		restored := 0
		for key, value := range v {
			var n int
			v[key], n = s.restore(value)
			restored += n
		}
		return v, restored
	case []any:
		restored := 0
		for i, value := range v {
			var n int
			v[i], n = s.restore(value)
			restored += n
		}
		return v, restored
	}
	return v, 0
}
