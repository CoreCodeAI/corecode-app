package service

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// Analysis of rival prices: what kind of channel a group sells, what a
// customer would pay for our own traffic there, and whether a site's
// top-up price can be trusted. The board compares like with like (our
// subscription pool against other pools), and the price-drop alerts use the
// same figures.

const (
	RivalKindOfficial = "official" // the vendor's API, relayed
	RivalKindCloud    = "cloud"    // AWS Bedrock, Google Vertex, Azure
	RivalKindPool     = "pool"     // Claude subscription accounts (Max, Pro, Team)
	RivalKindKiro     = "kiro"     // Kiro and similar IDE quotas
	RivalKindReverse  = "reverse"  // web or client reverse engineering, free tiers
	RivalKindDefault  = "default"  // the default group, kind unknown
	RivalKindOther    = "other"

	// RivalOurKind is the kind our own Claude groups sell.
	RivalOurKind = RivalKindPool

	RivalTrustOK       = "ok"
	RivalTrustUnknown  = "unknown"  // the site states no top-up price
	RivalTrustDefault  = "default"  // 7.3, new-api's default: likely never set
	RivalTrustAbnormal = "abnormal" // below ¥0.1 or above ¥20 per $1

	// A mix needs this many tokens before it stands for a model.
	rivalMixMinTokens = 1_000_000
	// Price-drop alerts: a further cut must take this much off.
	rivalAlertCut = 0.10
)

var RivalKinds = []string{RivalKindOfficial, RivalKindCloud, RivalKindPool, RivalKindKiro, RivalKindReverse, RivalKindDefault, RivalKindOther}

// The first rule that matches a group name decides its kind, so the more
// specific kinds come first: "kiro-max" is Kiro, "aws-cc" is a cloud.
var rivalKindRules = []struct {
	kind    string
	pattern *regexp.Regexp
}{
	{RivalKindKiro, regexp.MustCompile(`(?i)kiro|amazon\s*q|aws-q`)},
	{RivalKindReverse, regexp.MustCompile(`(?i)逆向|反代|蒸馏|reverse|web|网页|free|免费|公益|cursor|windsurf|trae|warp|augment|copilot|antigravity|反重力|codex-to|to-claude`)},
	{RivalKindCloud, regexp.MustCompile(`(?i)aws|bedrock|vertex|gcp|azure|google`)},
	{RivalKindOfficial, regexp.MustCompile(`(?i)offic|官|直连|原生|原厂|api[-_ ]?key|anthropic`)},
	{RivalKindPool, regexp.MustCompile(`(?i)max|pro|team|enterprise|企业|cc|claude[-_ ]?code|号池|满血|订阅|plus|sub`)},
	{RivalKindDefault, regexp.MustCompile(`(?i)^(default|默认)$`)},
}

// ClassifyRivalGroup guesses a group's kind from its name; an admin's
// override (model.RivalGroupKind) wins over it.
func ClassifyRivalGroup(name string) string {
	for _, rule := range rivalKindRules {
		if rule.pattern.MatchString(name) {
			return rule.kind
		}
	}
	return RivalKindOther
}

func IsRivalKind(kind string) bool {
	for _, k := range RivalKinds {
		if k == kind {
			return true
		}
	}
	return false
}

// RivalKindOf is a group's kind: the admin's if set, else its name's.
func RivalKindOf(group string, overrides map[string]string) string {
	if kind, ok := overrides[group]; ok && kind != "" {
		return kind
	}
	return ClassifyRivalGroup(group)
}

// RivalTrust says whether a site's CNY prices can be ranked. A top-up price
// of 7.3 is new-api's default, which sites that sell credit by redemption
// code never change; their real price is elsewhere.
func RivalTrust(topUpPrice float64) string {
	switch {
	case topUpPrice <= 0:
		return RivalTrustUnknown
	case math.Abs(topUpPrice-7.3) < 1e-9:
		return RivalTrustDefault
	case topUpPrice < 0.1 || topUpPrice > 20:
		return RivalTrustAbnormal
	}
	return RivalTrustOK
}

// RivalShares is a token mix as fractions of its total.
type RivalShares struct {
	Uncached   float64 `json:"uncached"`
	CacheRead  float64 `json:"cache_read"`
	CacheWrite float64 `json:"cache_write"`
	Output     float64 `json:"output"`
	Tokens     int64   `json:"tokens"`
	// Model is the model whose traffic this is, or "claude" for every Claude
	// model together when the model alone had too little.
	Model string `json:"model"`
}

func sharesOf(mix model.RivalTokenMix, name string) *RivalShares {
	total := mix.Total()
	if total < rivalMixMinTokens {
		return nil
	}
	t := float64(total)
	return &RivalShares{
		Uncached: float64(mix.Uncached) / t, CacheRead: float64(mix.CacheRead) / t,
		CacheWrite: float64(mix.CacheWrite) / t, Output: float64(mix.Output) / t,
		Tokens: total, Model: name,
	}
}

// RivalBlended is what a million tokens of the mix cost at a price: input
// for the uncached share, input times each ratio for the others. A site that
// states no cache ratio bills cache reads as input (new-api's default of 1);
// one that states no write ratio, at 1.25.
func RivalBlended(inputCNY *float64, cacheRatio, createRatio *float64, completionRatio float64, mix *RivalShares) *float64 {
	if inputCNY == nil || mix == nil {
		return nil
	}
	read, write := 1.0, 1.25
	if cacheRatio != nil {
		read = *cacheRatio
	}
	if createRatio != nil {
		write = *createRatio
	}
	v := *inputCNY * (mix.Uncached + mix.CacheRead*read + mix.CacheWrite*write + mix.Output*completionRatio)
	v = roundRival(v)
	return &v
}

// RivalModelRef is one model we sell: its official price and our traffic.
type RivalModelRef struct {
	Model            string       `json:"model"`
	InputCNY         float64      `json:"input_cny"`
	OutputCNY        float64      `json:"output_cny"`
	BlendedCNY       *float64     `json:"blended_cny"`
	CompletionRatio  float64      `json:"completion_ratio"`
	CacheRatio       *float64     `json:"cache_ratio"`
	CreateCacheRatio *float64     `json:"create_cache_ratio"`
	Mix              *RivalShares `json:"mix"`
}

// RivalOwnPrice is our price of a model in one group.
type RivalOwnPrice struct {
	Group      string   `json:"group"`
	Kind       string   `json:"kind"`
	GroupRatio float64  `json:"group_ratio"`
	InputCNY   float64  `json:"input_cny"`
	OutputCNY  float64  `json:"output_cny"`
	CacheRead  *float64 `json:"cache_read_cny"`
	CacheRatio *float64 `json:"cache_ratio"`
	BlendedCNY *float64 `json:"blended_cny"`
}

type RivalReference struct {
	ExchangeRate float64
	TopUpPrice   float64
	Models       []RivalModelRef
	Ours         map[string][]RivalOwnPrice
}

func (r RivalReference) Model(name string) *RivalModelRef {
	for i := range r.Models {
		if r.Models[i].Model == name {
			return &r.Models[i]
		}
	}
	return nil
}

// OurBest is our cheapest group of a model in our own kind, by the blended
// price when there is one, else by input.
func (r RivalReference) OurBest(name string) *RivalOwnPrice {
	var best *RivalOwnPrice
	for i, own := range r.Ours[name] {
		if own.Kind != RivalOurKind {
			continue
		}
		if best == nil || rivalMetric(&own.InputCNY, own.BlendedCNY) < rivalMetric(&best.InputCNY, best.BlendedCNY) {
			best = &r.Ours[name][i]
		}
	}
	return best
}

// rivalMetric is the figure prices are ranked by: blended when known.
func rivalMetric(input, blended *float64) float64 {
	if blended != nil {
		return *blended
	}
	if input != nil {
		return *input
	}
	return math.Inf(1)
}

// BuildRivalReference lists our Claude models priced per token: the official
// price (our ratio divided by its official_price_markup, at our exchange
// rate) and our price in each group, each blended over our customers'
// traffic of that model. The official cache ratios are ours: our Claude
// ratios are set to the vendor's.
func BuildRivalReference(mixes map[string]model.RivalTokenMix) RivalReference {
	exchange := operation_setting.USDExchangeRate
	byModel := map[string]model.RivalTokenMix{}
	var claude model.RivalTokenMix
	for name, mix := range mixes {
		if !strings.Contains(strings.ToLower(name), "claude") {
			continue
		}
		n := NormalizeRivalModel(name)
		m := byModel[n]
		m.Uncached += mix.Uncached
		m.CacheRead += mix.CacheRead
		m.CacheWrite += mix.CacheWrite
		m.Output += mix.Output
		byModel[n] = m
		claude.Uncached += mix.Uncached
		claude.CacheRead += mix.CacheRead
		claude.CacheWrite += mix.CacheWrite
		claude.Output += mix.Output
	}
	ref := RivalReference{ExchangeRate: exchange, TopUpPrice: operation_setting.Price, Ours: map[string][]RivalOwnPrice{}}
	for _, p := range model.GetPricing() {
		if !strings.Contains(strings.ToLower(p.ModelName), "claude") {
			continue
		}
		if p.QuotaType != 0 || p.ModelRatio <= 0 || p.BillingExpr != "" {
			continue
		}
		name := NormalizeRivalModel(p.ModelName)
		markup := 1.0
		if p.OfficialPriceMarkup != nil && *p.OfficialPriceMarkup > 0 {
			markup = *p.OfficialPriceMarkup
		}
		mix := sharesOf(byModel[name], name)
		if mix == nil {
			mix = sharesOf(claude, "claude")
		}
		officialInput := p.ModelRatio / markup * 2 * exchange
		ref.Models = append(ref.Models, RivalModelRef{
			Model: name, InputCNY: officialInput, OutputCNY: officialInput * p.CompletionRatio,
			BlendedCNY:      RivalBlended(&officialInput, p.CacheRatio, p.CreateCacheRatio, p.CompletionRatio, mix),
			CompletionRatio: p.CompletionRatio, CacheRatio: p.CacheRatio, CreateCacheRatio: p.CreateCacheRatio,
			Mix: mix,
		})
		for _, group := range p.EnableGroup {
			if group == "auto" {
				continue
			}
			ratio := ratio_setting.GetGroupRatio(group)
			input := p.ModelRatio * 2 * ratio * operation_setting.Price
			own := RivalOwnPrice{Group: group, Kind: RivalOurKind, GroupRatio: ratio, InputCNY: input,
				OutputCNY: input * p.CompletionRatio, CacheRatio: p.CacheRatio,
				BlendedCNY: RivalBlended(&input, p.CacheRatio, p.CreateCacheRatio, p.CompletionRatio, mix)}
			if p.CacheRatio != nil {
				cache := input * *p.CacheRatio
				own.CacheRead = &cache
			}
			ref.Ours[name] = append(ref.Ours[name], own)
		}
	}
	sort.Slice(ref.Models, func(i, j int) bool { return ref.Models[i].Model < ref.Models[j].Model })
	return ref
}

// rivalBestOfKind is a site's cheapest price of a model in a kind, ranked
// as rivalMetric ranks, with its blended price.
func rivalBestOfKind(prices []model.RivalPrice, modelName, kind string, overrides map[string]string, mix *RivalShares) (*model.RivalPrice, *float64) {
	var best *model.RivalPrice
	var bestBlended *float64
	for i := range prices {
		p := &prices[i]
		if p.Model != modelName || p.InputCNY == nil || RivalKindOf(p.GroupName, overrides) != kind {
			continue
		}
		blended := RivalBlended(p.InputCNY, p.CacheRatio, p.CreateCacheRatio, p.CompletionRatio, mix)
		if best == nil || rivalMetric(p.InputCNY, blended) < rivalMetric(best.InputCNY, bestBlended) {
			best, bestBlended = p, blended
		}
	}
	return best, bestBlended
}

// RivalAlertLines lists what one probe changed that the owner should hear:
// a site whose cheapest group of our kind now undercuts our cheapest, or one
// already below us that cut again by a tenth. A first read is a baseline
// and says nothing, and a site whose top-up price cannot be trusted is
// skipped, since its CNY figures are not what customers pay.
func RivalAlertLines(site model.RivalSite, topUpPrice float64, previous, current []model.RivalPrice, overrides map[string]string, ref RivalReference) []string {
	if RivalTrust(topUpPrice) != RivalTrustOK {
		return nil
	}
	name := site.Name
	if name == "" {
		name = site.Slug
	}
	var lines []string
	for _, m := range ref.Models {
		ours := ref.OurBest(m.Model)
		if ours == nil {
			continue
		}
		us := rivalMetric(&ours.InputCNY, ours.BlendedCNY)
		now, nowBlended := rivalBestOfKind(current, m.Model, RivalOurKind, overrides, m.Mix)
		if now == nil {
			continue
		}
		after := rivalMetric(now.InputCNY, nowBlended)
		label := "输入价"
		if nowBlended != nil && ours.BlendedCNY != nil {
			label = "综合价"
		}
		was, wasBlended := rivalBestOfKind(previous, m.Model, RivalOurKind, overrides, m.Mix)
		switch {
		case after < us && (was == nil || rivalMetric(was.InputCNY, wasBlended) >= us):
			lines = append(lines, fmt.Sprintf("%s 的 %s（%s）%s ¥%.2f，低于我们的 ¥%.2f（%s）",
				name, m.Model, now.GroupName, label, after, us, ours.Group))
		case was != nil && after < us && after < rivalMetric(was.InputCNY, wasBlended)*(1-rivalAlertCut):
			lines = append(lines, fmt.Sprintf("%s 又降价：%s（%s）%s ¥%.2f → ¥%.2f，我们 ¥%.2f",
				name, m.Model, now.GroupName, label, rivalMetric(was.InputCNY, wasBlended), after, us))
		}
	}
	return lines
}
