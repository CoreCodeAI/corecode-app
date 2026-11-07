// Detection semantics follow vm2api, Copyright (c) 2026 vm2api contributors;
// see LICENSE.vm2api.
package riskpolicy

import (
	"cmp"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/gjson"
)

// Input contains the original inbound request and the possibly transformed body.
// Leave Body empty, or set it to Inbound, when no transformation has occurred;
// either way the request is scanned once.
type Input struct {
	Inbound    gjson.Result
	Body       gjson.Result
	Official   bool
	ZeroInject bool
}

// Hit describes the first match. A zero Hit means no rule matched. Excerpt is
// the latest user text, for the caller's existing event-excerpt handling.
// Context is the matched text with up to matchContextRunes on each side, as
// the hard rules saw it, so a reviewer can tell a real ask from a word that
// only looks like one.
type Hit struct {
	Stage   string
	Rule    string
	Detail  string
	Excerpt string
	Context string
}

const matchContextRunes = 40

// matchContext cuts the text around the first occurrence of match in
// document, marking a cut end with "…".
func matchContext(document, match string) string {
	at := strings.Index(document, match)
	if match == "" || at < 0 {
		return ""
	}
	before := []rune(document[:at])
	after := []rune(document[at+len(match):])
	var builder strings.Builder
	if len(before) > matchContextRunes {
		builder.WriteString("…")
		before = before[len(before)-matchContextRunes:]
	}
	builder.WriteString(string(before))
	builder.WriteString("[")
	builder.WriteString(match)
	builder.WriteString("]")
	if len(after) > matchContextRunes {
		builder.WriteString(string(after[:matchContextRunes]))
		builder.WriteString("…")
	} else {
		builder.WriteString(string(after))
	}
	return builder.String()
}

func needleHit(hay string, needles []namedText) *namedText {
	if hay == "" || len(needles) == 0 {
		return nil
	}
	hay = lowerJS(hay)
	for i := range needles {
		if strings.Contains(hay, needles[i].match) {
			return &needles[i]
		}
	}
	return nil
}

func fingerprintHit(hay string, fingerprints []namedText) *namedText {
	if hay == "" || len(fingerprints) == 0 {
		return nil
	}
	hay = normalizeText(hay)
	if hay == "" {
		return nil
	}
	for i := range fingerprints {
		if fingerprints[i].match != "" && strings.Contains(hay, fingerprints[i].match) {
			return &fingerprints[i]
		}
	}
	return nil
}

// matchDistill returns the first distillation hit. A pattern that fails, such
// as one that exceeds the match timeout, is skipped so that crafted text cannot
// hide later rules behind it; the first such fault is returned when nothing hits.
func matchDistill(config *distillConfig, input Input, prompt prompt, harvest bool) (Hit, error) {
	var fault error
	if needle := needleHit(prompt.joined, config.hardNeedles); needle != nil {
		return Hit{Stage: "distill", Rule: needle.name, Detail: needle.text, Excerpt: prompt.user}, nil
	}
	// Patterns test normalized joined text before official/zero exemptions.
	var hay string
	if len(config.patterns) > 0 {
		hay = normalizeText(prompt.joined)
	}
	if hay != "" {
		session, err := config.patterns[0].re.engine.get()
		if err != nil {
			return Hit{}, err
		}
		defer session.close()
		for _, pattern := range config.patterns {
			evidence, matched, err := session.match(pattern.re, hay, true)
			if err != nil {
				fault = cmp.Or(fault, fmt.Errorf("matching %s: %w", pattern.name, err))
				continue
			}
			if matched {
				if evidence == "" {
					break
				}
				return Hit{Stage: "distill", Rule: pattern.name, Detail: evidence, Excerpt: prompt.user}, nil
			}
		}
	}
	if config.skipOfficial && input.Official || config.skipZero && input.ZeroInject {
		return Hit{}, fault
	}
	fingerprintText := prompt.user
	if fingerprintText == "" {
		fingerprintText = prompt.joined
	}
	if fingerprint := fingerprintHit(fingerprintText, config.fingerprints); fingerprint != nil {
		return Hit{Stage: "distill", Rule: fingerprint.name, Detail: jsPrefix(fingerprint.text, 80), Excerpt: prompt.user}, nil
	}
	if needle := needleHit(prompt.joined, config.needles); needle != nil {
		return Hit{Stage: "distill", Rule: needle.name, Detail: needle.text, Excerpt: prompt.user}, nil
	}
	if config.contest != nil {
		session, err := config.contest.engine.get()
		if err != nil {
			return Hit{}, cmp.Or(fault, err)
		}
		defer session.close()
		_, contest, err := session.match(config.contest, prompt.joined, false)
		if err != nil {
			return Hit{}, cmp.Or(fault, fmt.Errorf("matching contest pattern: %w", err))
		}
		if contest && harvest {
			return Hit{Stage: "distill", Rule: "harvest", Detail: "contest+harvest", Excerpt: prompt.user}, nil
		}
	}
	return Hit{}, fault
}

// matchHard returns the first hard rule that matches. Like matchDistill, it
// skips a rule that fails and returns the first fault only when nothing hits.
func matchHard(rules []hardRule, document string, distillOn, hardOn, openai bool, excerpt string) (Hit, error) {
	if document == "" {
		return Hit{}, nil
	}
	var fault error
	var session *regexSession
	defer func() {
		if session != nil {
			session.close()
		}
	}()
	for _, rule := range rules {
		if rule.distill {
			if !distillOn || openai {
				continue
			}
		} else if !hardOn {
			continue
		}
		if session == nil {
			var err error
			session, err = rule.re.engine.get()
			if err != nil {
				return Hit{}, cmp.Or(fault, err)
			}
		}
		match, found, err := session.match(rule.re, document, false)
		if err != nil {
			stage := "hard_regex"
			if rule.distill {
				stage = "distill"
			}
			if fault == nil {
				fault = &StageError{Stage: stage, Err: fmt.Errorf("matching hard rule %s: %w", rule.name, err)}
			}
			continue
		}
		if !found {
			continue
		}
		keyword := jsPrefix(normalizeWhitespace(match), 40)
		if keyword == "" {
			keyword = "custom"
			if strings.HasPrefix(rule.name, "vm2api.") {
				parts := strings.Split(rule.name, ".")
				if len(parts) > 2 && parts[1] != "" {
					keyword = parts[1]
				}
			}
		}
		stage := "hard_regex"
		if rule.distill {
			stage = "distill"
		}
		return Hit{Stage: stage, Rule: rule.name, Detail: keyword, Excerpt: excerpt, Context: matchContext(document, match)}, nil
	}
	return Hit{}, fault
}

func normalizeWhitespace(s string) string {
	var out strings.Builder
	out.Grow(len(s))
	space := false
	for _, r := range s {
		if isJSSpace(r) {
			space = out.Len() > 0
			continue
		}
		if space {
			out.WriteByte(' ')
		}
		space = false
		out.WriteRune(r)
	}
	return out.String()
}

// StageError is a fault in one stage: an invalid rule source or a regex that
// failed or ran out of time. It never stands for a clean match.
type StageError struct {
	Stage string
	Err   error
}

func (e *StageError) Error() string { return e.Err.Error() }
func (e *StageError) Unwrap() error { return e.Err }

// Claude Code resends the whole conversation on every tool step while the text
// the rules read stays the same, so a verdict is reused for that text.
const (
	verdictCacheTTL      = time.Hour
	verdictCacheCapacity = 20000
)

type cachedVerdict struct {
	hit     Hit
	expires time.Time
}

var verdictCache = struct {
	sync.Mutex
	verdicts map[[32]byte]cachedVerdict
}{verdicts: map[[32]byte]cachedVerdict{}}

// verdictKey hashes everything a verdict depends on. Each part is length
// prefixed, so no two different inputs share a key.
func verdictKey(parts []string, flags ...bool) [32]byte {
	hash := sha256.New()
	var size [8]byte
	for _, part := range parts {
		binary.LittleEndian.PutUint64(size[:], uint64(len(part)))
		hash.Write(size[:])
		hash.Write([]byte(part))
	}
	for _, flag := range flags {
		if flag {
			hash.Write([]byte{1})
		} else {
			hash.Write([]byte{0})
		}
	}
	var key [32]byte
	hash.Sum(key[:0])
	return key
}

// Evaluate applies a structured distill configuration and ordered hard rules.
// A rule whose regex fails, including by the finite match timeout, is skipped
// and every later rule still runs, so a hit after it is still reported. When
// nothing hits, the first such fault is returned to the caller as a
// *StageError; it is never silently interpreted as a clean match. Verdicts
// are cached; errors are not.
func Evaluate(distillSource, hardSource string, input Input, distillEnabled, hardEnabled bool) (Hit, error) {
	config, err := cachedDistill(distillSource)
	if err != nil {
		return Hit{}, &StageError{Stage: "distill", Err: err}
	}
	openai := openaiModel(input)
	if openai && !config.openaiEnabled {
		return Hit{}, nil
	}
	distillOn := distillEnabled && config.enabled
	if !distillOn && !hardEnabled || openai && !hardEnabled {
		return Hit{}, nil
	}
	p := extractPrompt(input)
	document := hardDocument(input)
	harvest := distillOn && !openai && config.contest != nil && isHarvest(input, config)
	key := verdictKey([]string{distillSource, hardSource, p.user, p.joined, document},
		distillOn, hardEnabled, openai, harvest, input.Official, input.ZeroInject)
	now := time.Now()
	verdictCache.Lock()
	cached, found := verdictCache.verdicts[key]
	verdictCache.Unlock()
	if found && now.Before(cached.expires) {
		return cached.hit, nil
	}

	hit, err := evaluate(config, hardSource, input, p, document, harvest, distillOn, hardEnabled, openai)
	if err != nil {
		return Hit{}, err
	}
	verdictCache.Lock()
	if len(verdictCache.verdicts) >= verdictCacheCapacity {
		clear(verdictCache.verdicts)
	}
	verdictCache.verdicts[key] = cachedVerdict{hit: hit, expires: now.Add(verdictCacheTTL)}
	verdictCache.Unlock()
	return hit, nil
}

func evaluate(config *distillConfig, hardSource string, input Input, p prompt, document string, harvest, distillOn, hardEnabled, openai bool) (Hit, error) {
	// A fault in the distillation stage does not stop the hard rules.
	var fault error
	if distillOn && !openai {
		hit, err := matchDistill(config, input, p, harvest)
		if hit.Stage != "" {
			return hit, nil
		}
		if err != nil {
			fault = &StageError{Stage: "distill", Err: err}
		}
	}
	rules, err := cachedHard(hardSource)
	if err != nil {
		return Hit{}, cmp.Or(fault, error(&StageError{Stage: "hard_regex", Err: err}))
	}
	hit, err := matchHard(rules, document, distillOn, hardEnabled, openai, p.user)
	if hit.Stage != "" {
		return hit, nil
	}
	if stageErr := (*StageError)(nil); err != nil && !errors.As(err, &stageErr) {
		err = &StageError{Stage: "hard_regex", Err: err}
	}
	return Hit{}, cmp.Or(fault, err)
}
