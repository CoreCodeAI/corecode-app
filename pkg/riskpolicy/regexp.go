package riskpolicy

import (
	"fmt"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/MoeForge/moejs"
)

// The same immutable script is loaded into exclusively-owned pooled runtimes.
// Each runtime compiles an operator pattern once and reuses it on later calls.
const regexModuleSource = `
const patterns = new Map();
export function compile(source) {
  if (!patterns.has(source)) {
    if (patterns.size >= 512) patterns.delete(patterns.keys().next().value);
    patterns.set(source, { normal: new RegExp(source, 'i'), global: new RegExp(source, 'gi') });
  }
}
export function exec(source, text, all) {
  if (!patterns.has(source)) compile(source);
  const pair = patterns.get(source);
  if (all) {
    const re = pair.global;
    for (const found of text.matchAll(re)) {
      if (!/\b(?:do not|don't|never|must not|should not)\s+$/i.test(text.slice(0, found.index))) {
        return found[0].slice(0, 80);
      }
    }
    return null;
  }
  const found = pair.normal.exec(text);
  return found ? found[0] : null;
}`

const regexTimeout = 200 * time.Millisecond

type jsPattern struct {
	source string
	engine *regexEngine
}

type regexEngine struct {
	module      *moejs.Module
	compileHook moejs.Hook
	execHook    moejs.Hook
	idle        chan *moejs.Runtime
}

type regexSession struct {
	engine *regexEngine
	rt     *moejs.Runtime
}

func newRegexEngine() (*regexEngine, error) {
	module, err := moejs.Compile("risk-policy-regex.mjs", regexModuleSource)
	if err != nil {
		return nil, err
	}
	compileHook, err := module.Hook("compile")
	if err != nil {
		return nil, err
	}
	execHook, err := module.Hook("exec")
	if err != nil {
		return nil, err
	}
	return &regexEngine{module: module, compileHook: compileHook, execHook: execHook, idle: make(chan *moejs.Runtime, min(runtime.GOMAXPROCS(0), 16))}, nil
}

func (engine *regexEngine) get() (*regexSession, error) {
	select {
	case rt := <-engine.idle:
		return &regexSession{engine: engine, rt: rt}, nil
	default:
	}
	rt := moejs.NewRuntime(moejs.Options{})
	if err := rt.Load(engine.module); err != nil {
		return nil, err
	}
	return &regexSession{engine: engine, rt: rt}, nil
}

func (session *regexSession) close() {
	session.rt.ClearInterrupt()
	session.rt.ReleaseCallData()
	select {
	case session.engine.idle <- session.rt:
	default:
	}
}

func (session *regexSession) call(hook moejs.Hook, args ...moejs.Value) (moejs.Value, error) {
	done := make(chan struct{})
	timer := time.AfterFunc(regexTimeout, func() {
		session.rt.Interrupt(fmt.Errorf("policy regex exceeded %s", regexTimeout))
		close(done)
	})
	value, err := session.rt.Call(hook, args...)
	if !timer.Stop() {
		<-done
		// A timed-out rule is skipped and the session runs the next one, so
		// drop the interrupt, which may also have landed after Call returned.
		session.rt.ClearInterrupt()
	}
	return value, err
}

func (session *regexSession) compile(source string) error {
	_, err := session.call(session.engine.compileHook, moejs.String(source))
	return err
}

func (session *regexSession) match(pattern *jsPattern, text string, all bool) (string, bool, error) {
	value, err := session.call(session.engine.execHook, moejs.String(pattern.source), moejs.String(text), moejs.Bool(all))
	if err != nil {
		return "", false, err
	}
	if value.IsNull() {
		return "", false, nil
	}
	if !value.IsString() {
		return "", false, fmt.Errorf("policy regex returned non-string result")
	}
	return value.AsString().GoString(), true, nil
}

func compilePattern(session *regexSession, source string) (*jsPattern, error) {
	// The previous Go-based console accepted an inline case-insensitive prefix.
	// Source rules are always compiled case-insensitively as in vm2api.
	for strings.HasPrefix(source, "(?i)") {
		source = strings.TrimPrefix(source, "(?i)")
	}
	if err := session.compile(source); err != nil {
		return nil, err
	}
	return &jsPattern{source: source, engine: session.engine}, nil
}

var regexEngineOnce struct {
	sync.Once
	engine *regexEngine
	err    error
}

func sharedRegexEngine() (*regexEngine, error) {
	regexEngineOnce.Do(func() {
		regexEngineOnce.engine, regexEngineOnce.err = newRegexEngine()
	})
	return regexEngineOnce.engine, regexEngineOnce.err
}
