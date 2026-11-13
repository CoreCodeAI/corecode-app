package service

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// The rival price monitor reads other relays' public Claude prices. The site
// list comes from the apiranking.com directory (names and addresses only) and
// from sites an admin adds; the prices come from each site's own
// /api/pricing and /api/status, the public endpoints every new-api console
// reads. Sites that run something else are marked unsupported.
//
// It runs on the master node, every minute while rival_price_setting.enabled
// is on. Every unit of work (the directory read, a directory page, a site
// probe) is claimed through a conditional update, so two servers during a
// release never do the same one twice.

const (
	rivalDirectoryURL      = "https://apiranking.com/"
	rivalDirectoryPageURL  = "https://apiranking.com/p/"
	rivalTickInterval      = time.Minute
	rivalDirectoryInterval = 24 * time.Hour
	rivalPageRefresh       = 7 * 24 * time.Hour
	rivalPageRetry         = time.Hour
	rivalPagesPerTick      = 10
	rivalPageGap           = 3 * time.Second // apiranking answers 429 to bursts
	rivalProbesPerTick     = 30
	rivalProbeWorkers      = 6
	rivalProbeHold         = 30 * time.Minute
	rivalRecheckOK         = 6 * time.Hour
	rivalRecheckFailed     = 24 * time.Hour
	rivalRequestTimeout    = 20 * time.Second
	rivalMaxBody           = 8 << 20
	rivalMaxPricesPerSite  = 400
	rivalUserAgent         = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
)

var (
	rivalTaskOnce sync.Once

	rivalSlugPattern     = regexp.MustCompile(`href="/p/([a-z0-9][a-z0-9-]{0,120})"`)
	rivalLDJSONPattern   = regexp.MustCompile(`(?s)<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>`)
	rivalModelDateSuffix = regexp.MustCompile(`-(20\d{6})$`)

	errRivalNotNewAPI = errors.New("no new-api price list")
)

// StartRivalPriceTask starts the monitor on the master node.
func StartRivalPriceTask() {
	rivalTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(rivalTickInterval)
			defer ticker.Stop()
			for {
				<-ticker.C
				if !system_setting.GetRivalPriceSetting().Enabled {
					continue
				}
				runRivalPriceTick(time.Now())
			}
		})
	})
}

func runRivalPriceTick(now time.Time) {
	ctx := context.Background()
	client, err := newRivalHTTPClient(system_setting.GetRivalPriceSetting().Proxy)
	if err != nil {
		logger.LogWarn(ctx, common.LogText("rival prices: invalid proxy: %v", err))
		return
	}
	if err := syncRivalDirectory(ctx, client, now); err != nil {
		logger.LogWarn(ctx, common.LogText("rival prices: directory sync failed: %v", err))
	}
	if err := readRivalDirectoryPages(ctx, client, now); err != nil {
		logger.LogWarn(ctx, common.LogText("rival prices: directory pages failed: %v", err))
	}
	if err := probeDueRivalSites(ctx, client, now); err != nil {
		logger.LogWarn(ctx, common.LogText("rival prices: probe failed: %v", err))
	}
}

// rivalFetchProtection keeps every probe off private and reserved addresses,
// whatever the site-wide fetch setting says: the addresses come from a third
// party's directory.
func rivalFetchProtection() *common.SSRFProtection {
	return &common.SSRFProtection{
		AllowPrivateIp:         false,
		DomainFilterMode:       false,
		IpFilterMode:           false,
		AllowedPorts:           []int{80, 443, 8080, 8443},
		ApplyIPFilterForDomain: true,
	}
}

type rivalHTTPClient struct {
	client     *http.Client
	protection *common.SSRFProtection
	proxied    bool
}

func newRivalHTTPClient(rawProxy string) (*rivalHTTPClient, error) {
	protection := rivalFetchProtection()
	getProtection := func() (*common.SSRFProtection, bool, error) { return protection, true, nil }
	var proxyURL *url.URL
	if strings.TrimSpace(rawProxy) != "" {
		parsed, err := url.Parse(strings.TrimSpace(rawProxy))
		if err != nil {
			return nil, err
		}
		switch parsed.Scheme {
		case "http", "https", "socks5", "socks5h":
		default:
			return nil, fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
		}
		proxyURL = parsed
	}
	proxy := func(*http.Request) (*url.URL, error) { return proxyURL, nil }
	client := newProtectedFetchHTTPClientWithProxy(nil, nil, getProtection, proxy)
	client.Timeout = rivalRequestTimeout
	return &rivalHTTPClient{client: client, protection: protection, proxied: proxyURL != nil}, nil
}

// get fetches a URL and returns its status and at most rivalMaxBody bytes.
// Through a proxy the dialer never sees the target, so the address is checked
// here first.
func (c *rivalHTTPClient) get(ctx context.Context, target, accept string) (int, []byte, error) {
	if c.proxied {
		if err := c.protection.ValidateURL(target); err != nil {
			return 0, nil, err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, rivalRequestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("User-Agent", rivalUserAgent)
	req.Header.Set("Accept", accept)
	resp, err := c.client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, rivalMaxBody))
	return resp.StatusCode, body, err
}

// ---- directory ----

func syncRivalDirectory(ctx context.Context, client *rivalHTTPClient, now time.Time) error {
	claimed, err := model.ClaimRivalDirectorySync(model.RivalSourceDirectory, now.Unix(), now.Add(rivalDirectoryInterval).Unix())
	if err != nil || !claimed {
		return err
	}
	status, body, err := client.get(ctx, rivalDirectoryURL, "text/html")
	if err == nil && status != http.StatusOK {
		err = fmt.Errorf("status %d", status)
	}
	if err != nil {
		_ = model.FinishRivalDirectorySync(model.RivalSourceDirectory, now.Unix(), 0, err.Error())
		return err
	}
	slugs := ParseRivalDirectorySlugs(string(body))
	if len(slugs) == 0 {
		err = errors.New("the directory page lists no sites")
		_ = model.FinishRivalDirectorySync(model.RivalSourceDirectory, now.Unix(), 0, err.Error())
		return err
	}
	if _, err := model.UpsertRivalDirectorySlugs(slugs); err != nil {
		return err
	}
	return model.FinishRivalDirectorySync(model.RivalSourceDirectory, now.Unix(), len(slugs), "")
}

// ParseRivalDirectorySlugs lists the site slugs an apiranking page links to,
// each named by its slug until its own page is read.
func ParseRivalDirectorySlugs(page string) map[string]string {
	slugs := map[string]string{}
	for _, m := range rivalSlugPattern.FindAllStringSubmatch(page, -1) {
		slugs[m[1]] = m[1]
	}
	return slugs
}

// ParseRivalDirectoryPage reads a site's name and address from the
// schema.org data of its apiranking page: the object under "provider".
func ParseRivalDirectoryPage(page string) (name, siteURL string, ok bool) {
	for _, m := range rivalLDJSONPattern.FindAllStringSubmatch(page, -1) {
		var doc any
		if err := common.Unmarshal([]byte(strings.TrimSpace(m[1])), &doc); err != nil {
			continue
		}
		if name, siteURL, ok = findRivalProvider(doc); ok {
			return name, siteURL, true
		}
	}
	return "", "", false
}

func findRivalProvider(node any) (string, string, bool) {
	switch v := node.(type) {
	case map[string]any:
		if provider, ok := v["provider"].(map[string]any); ok {
			name, _ := provider["name"].(string)
			link, _ := provider["url"].(string)
			if normalized, ok := normalizeRivalURL(link); ok {
				return strings.TrimSpace(html.UnescapeString(name)), normalized, true
			}
		}
		for _, child := range v {
			if name, link, ok := findRivalProvider(child); ok {
				return name, link, true
			}
		}
	case []any:
		for _, child := range v {
			if name, link, ok := findRivalProvider(child); ok {
				return name, link, true
			}
		}
	}
	return "", "", false
}

// normalizeRivalURL keeps an http(s) address's scheme and host, which is all a
// probe needs.
func normalizeRivalURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", false
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), true
}

// NormalizeRivalURL is normalizeRivalURL for the admin API.
func NormalizeRivalURL(raw string) (string, bool) {
	return normalizeRivalURL(raw)
}

func isOwnRivalHost(siteURL string) bool {
	own, err := url.Parse(system_setting.ServerAddress)
	if err != nil || own.Hostname() == "" {
		return false
	}
	u, err := url.Parse(siteURL)
	if err != nil {
		return false
	}
	return bareRivalHost(u.Hostname()) == bareRivalHost(own.Hostname())
}

func bareRivalHost(host string) string {
	return strings.TrimPrefix(strings.ToLower(host), "www.")
}

func readRivalDirectoryPages(ctx context.Context, client *rivalHTTPClient, now time.Time) error {
	sites, err := model.ClaimRivalDirectoryPages(now.Add(-rivalPageRefresh).Unix(), now.Unix(), rivalPagesPerTick)
	if err != nil {
		return err
	}
	retryAt := now.Add(-rivalPageRefresh + rivalPageRetry).Unix()
	for i, site := range sites {
		if i > 0 {
			time.Sleep(rivalPageGap)
		}
		status, body, err := client.get(ctx, rivalDirectoryPageURL+url.PathEscape(site.Slug), "text/html")
		if err != nil || status != http.StatusOK {
			_ = model.UpdateRivalSite(site.Id, map[string]any{"directory_checked_at": retryAt})
			if status == http.StatusTooManyRequests {
				return nil
			}
			continue
		}
		name, siteURL, ok := ParseRivalDirectoryPage(string(body))
		if !ok {
			continue
		}
		if name == "" {
			name = site.Name
		}
		if err := model.SetRivalSiteDirectoryEntry(site.Id, name, siteURL); err != nil {
			return err
		}
		if isOwnRivalHost(siteURL) {
			_ = model.UpdateRivalSite(site.Id, map[string]any{"enabled": false})
		}
	}
	return nil
}

// ---- probing ----

func probeDueRivalSites(ctx context.Context, client *rivalHTTPClient, now time.Time) error {
	sites, err := model.ClaimRivalSitesDue(now.Unix(), now.Add(rivalProbeHold).Unix(), rivalProbesPerTick)
	if err != nil {
		return err
	}
	work := make(chan model.RivalSite)
	var wg sync.WaitGroup
	for i := 0; i < rivalProbeWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for site := range work {
				result := probeRivalSite(ctx, client, site)
				checked := time.Now()
				next := checked.Add(rivalRecheckOK)
				if result.Status != model.RivalStatusOK {
					next = checked.Add(rivalRecheckFailed)
				}
				if err := model.SaveRivalProbe(site.Id, result, checked.Unix(), next.Unix()); err != nil {
					logger.LogWarn(ctx, common.LogText("rival prices: saving %s failed: %v", site.Slug, err))
				}
			}
		}()
	}
	for _, site := range sites {
		work <- site
	}
	close(work)
	wg.Wait()
	return nil
}

// RivalProbeCandidates lists the origins tried for a site's price list: the
// one that answered last, the listed address, then api.<domain> and the
// domain with and without www, since many relays serve their console on
// another host than their landing page. An admin's address is the only one.
func RivalProbeCandidates(site model.RivalSite) []string {
	if site.APIBaseLocked && site.APIBase != "" {
		return []string{site.APIBase}
	}
	var out []string
	seen := map[string]bool{}
	add := func(origin string) {
		if origin != "" && !seen[origin] {
			seen[origin] = true
			out = append(out, origin)
		}
	}
	add(site.APIBase)
	u, err := url.Parse(site.SiteURL)
	if err == nil && u.Host != "" {
		add(u.Scheme + "://" + u.Host)
		bare := bareRivalHost(u.Host)
		add("https://api." + bare)
		add("https://" + bare)
		add("https://www." + bare)
	}
	return out
}

func probeRivalSite(ctx context.Context, client *rivalHTTPClient, site model.RivalSite) model.RivalProbeResult {
	// The first answer that was not a price list says the most (a 401 from
	// the listed address); a network error only matters when nothing answered.
	var answerErr, networkErr error
	for _, origin := range RivalProbeCandidates(site) {
		status, body, err := client.get(ctx, origin+"/api/pricing", "application/json")
		if err != nil {
			if networkErr == nil {
				networkErr = err
			}
			continue
		}
		if status != http.StatusOK {
			if answerErr == nil {
				answerErr = fmt.Errorf("%s/api/pricing answered %d", origin, status)
			}
			continue
		}
		pricing, err := ParseRivalPricing(body)
		if err != nil {
			if answerErr == nil {
				answerErr = fmt.Errorf("%s/api/pricing: %w", origin, err)
			}
			continue
		}
		result := model.RivalProbeResult{Status: model.RivalStatusOK, APIBase: origin}
		if status, body, err := client.get(ctx, origin+"/api/status", "application/json"); err == nil && status == http.StatusOK {
			info := ParseRivalStatus(body)
			result.SystemName, result.Version = info.SystemName, info.Version
			result.TopUpPrice, result.ExchangeRate = info.Price, info.ExchangeRate
		}
		result.Prices = pricing.ClaudePrices(result.TopUpPrice)
		return result
	}
	if answerErr != nil {
		return model.RivalProbeResult{Status: model.RivalStatusUnsupported, Error: answerErr.Error()}
	}
	result := model.RivalProbeResult{Status: model.RivalStatusError}
	if networkErr != nil {
		result.Error = networkErr.Error()
	}
	return result
}

// RivalPricing is the part of a new-api /api/pricing answer the monitor reads.
type RivalPricing struct {
	Success    bool               `json:"success"`
	GroupRatio map[string]float64 `json:"group_ratio"`
	Data       []struct {
		ModelName       string   `json:"model_name"`
		QuotaType       int      `json:"quota_type"`
		ModelRatio      float64  `json:"model_ratio"`
		CompletionRatio float64  `json:"completion_ratio"`
		CacheRatio      *float64 `json:"cache_ratio"`
		BillingExpr     string   `json:"billing_expr"`
		EnableGroups    []string `json:"enable_groups"`
	} `json:"data"`
}

func ParseRivalPricing(body []byte) (RivalPricing, error) {
	var pricing RivalPricing
	if err := common.Unmarshal(body, &pricing); err != nil {
		return pricing, errRivalNotNewAPI
	}
	if !pricing.Success || pricing.Data == nil {
		return pricing, errRivalNotNewAPI
	}
	return pricing, nil
}

// ClaudePrices lists each Claude model's price in each group a visitor can
// see. Prices are CNY per million tokens, from the console's own arithmetic:
// model_ratio * 2 USD, times the group ratio, times the CNY paid for $1 of
// credit. A model priced per call or by a billing expression is left out, as
// are the auto group and groups without a ratio.
func (p RivalPricing) ClaudePrices(topUpPrice float64) []model.RivalPrice {
	type key struct{ model, group string }
	best := map[key]model.RivalPrice{}
	var order []key
	for _, m := range p.Data {
		if !strings.Contains(strings.ToLower(m.ModelName), "claude") {
			continue
		}
		if m.QuotaType != 0 || m.ModelRatio <= 0 || m.BillingExpr != "" {
			continue
		}
		name := NormalizeRivalModel(m.ModelName)
		for _, group := range m.EnableGroups {
			ratio, ok := p.GroupRatio[group]
			if !ok || ratio <= 0 || group == "auto" {
				continue
			}
			price := model.RivalPrice{
				Model: name, GroupName: group, RawModel: m.ModelName,
				ModelRatio: m.ModelRatio, CompletionRatio: m.CompletionRatio, CacheRatio: m.CacheRatio,
				GroupRatio: ratio,
			}
			if topUpPrice > 0 {
				input := roundRival(m.ModelRatio * 2 * ratio * topUpPrice)
				output := roundRival(input * m.CompletionRatio)
				price.InputCNY, price.OutputCNY = &input, &output
				if m.CacheRatio != nil {
					cache := roundRival(input * *m.CacheRatio)
					price.CacheReadCNY = &cache
				}
			}
			k := key{name, group}
			prev, seen := best[k]
			if !seen {
				order = append(order, k)
			}
			if !seen || price.ModelRatio*price.GroupRatio < prev.ModelRatio*prev.GroupRatio {
				best[k] = price
			}
		}
	}
	if len(order) > rivalMaxPricesPerSite {
		order = order[:rivalMaxPricesPerSite]
	}
	out := make([]model.RivalPrice, 0, len(order))
	for _, k := range order {
		out = append(out, best[k])
	}
	return out
}

func roundRival(v float64) float64 {
	return math.Round(v*10000) / 10000
}

// NormalizeRivalModel maps a site's model name onto one key: lower case,
// dots and underscores as dashes, a trailing date dropped, so
// claude-sonnet-4.5-20250929 and claude-sonnet-4-5 compare.
func NormalizeRivalModel(name string) string {
	n := strings.ToLower(strings.TrimSpace(name))
	n = strings.NewReplacer(".", "-", "_", "-").Replace(n)
	return rivalModelDateSuffix.ReplaceAllString(n, "")
}

// RivalStatus is the part of a new-api /api/status answer the monitor reads.
type RivalStatus struct {
	Price        float64
	ExchangeRate float64
	SystemName   string
	Version      string
}

func ParseRivalStatus(body []byte) RivalStatus {
	var doc struct {
		Data map[string]any `json:"data"`
	}
	if err := common.Unmarshal(body, &doc); err != nil || doc.Data == nil {
		return RivalStatus{}
	}
	number := func(key string) float64 {
		if v, ok := doc.Data[key].(float64); ok && v > 0 && !math.IsInf(v, 0) {
			return v
		}
		return 0
	}
	text := func(key string) string {
		v, _ := doc.Data[key].(string)
		return v
	}
	return RivalStatus{
		Price:        number("price"),
		ExchangeRate: number("usd_exchange_rate"),
		SystemName:   text("system_name"),
		Version:      text("version"),
	}
}
