package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Group names read from production on 2026-11-13, one or more per kind.
func TestClassifyRivalGroupOnRealNames(t *testing.T) {
	cases := map[string]string{
		"cc":                  RivalKindPool,
		"cc-max-stable":       RivalKindPool,
		"Claude Code Max":     RivalKindPool,
		"claude-max(外接版)":     RivalKindPool,
		"Claude-MAX企业":        RivalKindPool,
		"claude-enterprise":   RivalKindPool,
		"17-Claude-满血-特惠":     RivalKindPool,
		"AWS-Claude-1":        RivalKindCloud,
		"claude aws官转":        RivalKindCloud,
		"Azure-Claude-1":      RivalKindCloud,
		"Claude-Official":     RivalKindOfficial,
		"Claude 官方纯血高缓存高可用":   RivalKindOfficial,
		"claude_官转":           RivalKindOfficial,
		"Claude-原厂官转":         RivalKindOfficial,
		"🚀Claude-Kiro ￥0.5/刀": RivalKindKiro,
		"15-Claude-KIRO-企业":   RivalKindKiro,
		"ClaudeCode-Kiro逆向":   RivalKindKiro,
		"Claude 逆向Mix":        RivalKindReverse,
		"Claude-web反代":        RivalKindReverse,
		"Claude-反重力反代":        RivalKindReverse,
		"Claude-code优质-蒸馏":    RivalKindReverse,
		"cc-codex-to-claude":  RivalKindReverse,
		"ClaudeCode-Cursor逆向": RivalKindReverse,
		"default":             RivalKindDefault,
		"svip":                RivalKindOther,
		"Claude 特惠分组":         RivalKindOther,
	}
	for name, want := range cases {
		assert.Equal(t, want, ClassifyRivalGroup(name), name)
	}
	assert.Equal(t, RivalKindOfficial, RivalKindOf("svip", map[string]string{"svip": RivalKindOfficial}), "an admin's kind wins")
}

func TestRivalTrust(t *testing.T) {
	assert.Equal(t, RivalTrustOK, RivalTrust(1))
	assert.Equal(t, RivalTrustOK, RivalTrust(7))
	assert.Equal(t, RivalTrustDefault, RivalTrust(7.3))
	assert.Equal(t, RivalTrustUnknown, RivalTrust(0))
	assert.Equal(t, RivalTrustAbnormal, RivalTrust(0.03))
	assert.Equal(t, RivalTrustAbnormal, RivalTrust(30))
}

func ptr(v float64) *float64 { return &v }

func TestRivalBlended(t *testing.T) {
	// 10% uncached, 80% cache reads, 5% writes, 5% output.
	mix := &RivalShares{Uncached: 0.1, CacheRead: 0.8, CacheWrite: 0.05, Output: 0.05}
	got := RivalBlended(ptr(10), ptr(0.05), ptr(1.25), 5, mix)
	require.NotNil(t, got)
	assert.InDelta(t, 10*(0.1+0.8*0.05+0.05*1.25+0.05*5), *got, 1e-9)

	// A site that states no cache ratio bills reads as input: far dearer.
	noCache := RivalBlended(ptr(10), nil, nil, 5, mix)
	assert.InDelta(t, 10*(0.1+0.8+0.05*1.25+0.05*5), *noCache, 1e-9)
	assert.Greater(t, *noCache, *got*2)

	assert.Nil(t, RivalBlended(nil, ptr(0.1), nil, 5, mix))
	assert.Nil(t, RivalBlended(ptr(10), ptr(0.1), nil, 5, nil))
}

func TestRivalAlertLines(t *testing.T) {
	mix := &RivalShares{Uncached: 0.1, CacheRead: 0.8, CacheWrite: 0.05, Output: 0.05}
	blend := func(in float64) *float64 { return RivalBlended(&in, ptr(0.05), ptr(1.25), 5, mix) }
	ref := RivalReference{
		Models: []RivalModelRef{{Model: "claude-opus-5-5", InputCNY: 27.2, Mix: mix}},
		Ours: map[string][]RivalOwnPrice{"claude-opus-5-5": {
			{Group: "Claude 满血（仅限CC）", Kind: RivalOurKind, InputCNY: 7.6, BlendedCNY: blend(7.6)},
		}},
	}
	price := func(group string, input float64) model.RivalPrice {
		return model.RivalPrice{Model: "claude-opus-5-5", GroupName: group, CompletionRatio: 5,
			CacheRatio: ptr(0.05), CreateCacheRatio: ptr(1.25), InputCNY: &input}
	}
	site := model.RivalSite{Name: "Packy"}

	// The pool group falls below us: one line.
	lines := RivalAlertLines(site, 1, []model.RivalPrice{price("cc", 10)}, []model.RivalPrice{price("cc", 7)}, nil, ref)
	require.Len(t, lines, 1)
	assert.Contains(t, lines[0], "Packy 的 claude-opus-5-5（cc）综合价")

	// Already below us and only a little lower: nothing.
	assert.Empty(t, RivalAlertLines(site, 1, []model.RivalPrice{price("cc", 7)}, []model.RivalPrice{price("cc", 6.8)}, nil, ref))
	// Already below us and cut by more than a tenth: one line.
	lines = RivalAlertLines(site, 1, []model.RivalPrice{price("cc", 7)}, []model.RivalPrice{price("cc", 5)}, nil, ref)
	require.Len(t, lines, 1)
	assert.Contains(t, lines[0], "又降价")

	// A cheaper group of another kind is not our kind: nothing.
	assert.Empty(t, RivalAlertLines(site, 1, nil, []model.RivalPrice{price("Claude-kiro", 1)}, nil, ref))
	// Unless an admin calls it a pool.
	assert.Len(t, RivalAlertLines(site, 1, nil, []model.RivalPrice{price("Claude-kiro", 1)}, map[string]string{"Claude-kiro": RivalKindPool}, ref), 1)
	// A site still at new-api's default top-up price is not trusted.
	assert.Empty(t, RivalAlertLines(site, 7.3, []model.RivalPrice{price("cc", 10)}, []model.RivalPrice{price("cc", 0.5)}, nil, ref))
}
