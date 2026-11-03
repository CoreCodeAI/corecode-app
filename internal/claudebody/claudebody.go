// Package claudebody builds synthetic Claude Code request bodies for tests and
// benchmarks: a long system prompt, a tool list, and a conversation whose user
// turns carry tool results, long text and many base64 screenshots. Nothing in
// it is real customer or production-rule data.
package claudebody

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math/rand"
	"strings"
	"sync"
)

var (
	imagePool   []string
	imagePoolMu sync.Mutex
)

// screenshot returns the i-th distinct PNG as base64. Dimensions differ per
// index so no two share a length, as real screenshots rarely do.
func screenshot(i int) string {
	imagePoolMu.Lock()
	defer imagePoolMu.Unlock()
	for len(imagePool) <= i {
		n := len(imagePool)
		rng := rand.New(rand.NewSource(int64(n) + 1))
		w, h := 300+n%37, 250+n/37
		img := image.NewNRGBA(image.Rect(0, 0, w, h))
		for p := 0; p < len(img.Pix); p++ {
			img.Pix[p] = uint8(rng.Intn(256))
		}
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				img.SetNRGBA(x, y, color.NRGBA{R: img.Pix[(y*w+x)*4], G: img.Pix[(y*w+x)*4+1], B: img.Pix[(y*w+x)*4+2], A: 255})
			}
		}
		var buf bytes.Buffer
		_ = png.Encode(&buf, img)
		imagePool = append(imagePool, base64.StdEncoding.EncodeToString(buf.Bytes()))
	}
	return imagePool[i]
}

// jsonText escapes s as the inside of a JSON string.
func jsonText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func filler(rng *rand.Rand, n int) string {
	words := []string{"func", "return", "error", "package", "import", "if", "nil", "string", "const", "var", "for", "range", "struct", "type", "go", "test", "line", "\"quoted\"", "path/to/file.go:42", "{", "}", "\n", "\n\t"}
	var b strings.Builder
	for b.Len() < n {
		b.WriteString(words[rng.Intn(len(words))])
		b.WriteByte(' ')
	}
	return b.String()
}

// Options shapes a body.
type Options struct {
	// TargetBytes is the approximate size of the JSON body.
	TargetBytes int
	// ImageShare is the fraction of the body that is base64 image data.
	// Zero means 0.85, a screenshot-heavy Claude Code session.
	ImageShare float64
	Seed       int64
}

// Claude returns a /v1/messages body in the shape Claude Code sends.
func Claude(opt Options) []byte {
	if opt.ImageShare == 0 {
		opt.ImageShare = 0.85
	}
	rng := rand.New(rand.NewSource(opt.Seed + 7))
	var tail strings.Builder
	tail.WriteString(`,"system":[{"type":"text","text":"x-anthropic-billing-header: cc_version=2.1.301.b14; cc_entrypoint=cli;"},`)
	tail.WriteString(`{"type":"text","text":"You are Claude Code, Anthropic's official CLI for Claude.\n` + jsonText(filler(rng, 12000)) + `","cache_control":{"type":"ephemeral"}}],`)
	tail.WriteString(`"tools":[`)
	for i := 0; i < 20; i++ {
		if i > 0 {
			tail.WriteByte(',')
		}
		fmt.Fprintf(&tail, `{"name":"Tool%d","description":"%s","input_schema":{"type":"object","properties":{"path":{"type":"string","description":"%s"},"limit":{"type":"number"}},"required":["path"]}}`,
			i, jsonText(filler(rng, 900)), jsonText(filler(rng, 200)))
	}
	tail.WriteString(`],"metadata":{"user_id":"user_` + strings.Repeat("ab", 32) + `_account__session_0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d"},"max_tokens":32000,"stream":true}`)

	// Claude Code writes model first and messages next, so every later field
	// sits behind the whole conversation.
	var b strings.Builder
	b.WriteString(`{"model":"claude-opus-5-5","messages":[{"role":"user","content":[{"type":"text","text":"<system-reminder>\nSessionStart hook\n</system-reminder>"},{"type":"text","text":"please investigate the flaky test in this repository"}]}`)
	head := b.Len()
	imageBudget := int(float64(opt.TargetBytes) * opt.ImageShare)
	textBudget := opt.TargetBytes - imageBudget
	images, imageBytes, turn := 0, 0, 0
	for b.Len()-head < opt.TargetBytes-tail.Len()-4096 {
		fmt.Fprintf(&b, `,{"role":"assistant","content":[{"type":"text","text":"Looking at it."},{"type":"tool_use","id":"toolu_%04d","name":"Tool1","input":{"path":"/src/file%d.go"}}]},`, turn, turn)
		fmt.Fprintf(&b, `{"role":"user","content":[`)
		switch {
		case turn%3 == 0 && imageBytes < imageBudget:
			// A screenshot returned by a tool.
			fmt.Fprintf(&b, `{"type":"tool_result","tool_use_id":"toolu_%04d","content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"%s"}},{"type":"text","text":"screenshot taken"}]}`, turn, screenshot(images))
			imageBytes += len(screenshot(images))
			images++
		case turn%3 == 1 && imageBytes < imageBudget:
			// A pasted screenshot beside the user's text.
			fmt.Fprintf(&b, `{"type":"tool_result","tool_use_id":"toolu_%04d","content":"%s"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"%s"}},{"type":"text","text":"<system-reminder>\nplan mode is off\n</system-reminder>"}`, turn, jsonText(filler(rng, 2000)), screenshot(images))
			imageBytes += len(screenshot(images))
			images++
		default:
			size := 2000
			if textBudget > 0 {
				size = min(textBudget, 30000)
				textBudget -= size
			}
			fmt.Fprintf(&b, `{"type":"tool_result","tool_use_id":"toolu_%04d","content":"%s"}`, turn, jsonText(filler(rng, size)))
		}
		b.WriteString(`]}`)
		turn++
	}
	b.WriteString(`,{"role":"assistant","content":"ok"},{"role":"user","content":[{"type":"text","text":"now fix the failing test and explain what changed"}]}]`)
	b.WriteString(tail.String())
	return []byte(b.String())
}

// Images reports how many image blocks a body of the options carries, for
// benchmark labels.
func Images(body []byte) int { return bytes.Count(body, []byte(`"type":"image"`)) }
