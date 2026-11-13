package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func readRivalFixture(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile("testdata/rival/" + name)
	require.NoError(t, err)
	return body
}

// packy-pricing.json is PackyAPI's /api/pricing of 2026-11-13, cut to four
// models, with a billing-expression model, a per-call model, the auto group
// and a group without a ratio added.
func TestClaudePricesFromARealPriceList(t *testing.T) {
	pricing, err := ParseRivalPricing(readRivalFixture(t, "packy-pricing.json"))
	require.NoError(t, err)

	prices := pricing.ClaudePrices(1)
	got := map[string]model.RivalPrice{}
	for _, p := range prices {
		got[p.Model+"/"+p.GroupName] = p
	}
	assert.Len(t, got, 6)
	assert.NotContains(t, got, "claude-opus-5-5/auto")
	assert.NotContains(t, got, "claude-opus-5-5/private-vip")
	assert.NotContains(t, got, "claude-haiku-9/cc", "a billing expression has no single ratio")
	assert.NotContains(t, got, "claude-image/cc", "a per-call model has no token price")

	cc := got["claude-opus-5-5/cc"]
	require.NotNil(t, cc.InputCNY)
	assert.InDelta(t, 10.0, *cc.InputCNY, 1e-9) // 2 * $2 * 2.5 * ¥1
	assert.InDelta(t, 50.0, *cc.OutputCNY, 1e-9)
	assert.InDelta(t, 0.5, *cc.CacheReadCNY, 1e-9)

	sonnet, ok := got["claude-sonnet-4-5/cc-expensive"]
	require.True(t, ok, "the date suffix is dropped")
	assert.Equal(t, "claude-sonnet-4-5-20250929", sonnet.RawModel)

	// Without a top-up price the ratios are kept and no CNY figure is made up.
	for _, p := range pricing.ClaudePrices(0) {
		assert.Nil(t, p.InputCNY)
		assert.Greater(t, p.GroupRatio, 0.0)
	}
}

func TestParseRivalPricingRejectsOtherAnswers(t *testing.T) {
	for _, body := range []string{`404 page not found`, `{"code":401,"message":"未登录"}`, `{"success":false}`, `<html></html>`} {
		_, err := ParseRivalPricing([]byte(body))
		assert.ErrorIs(t, err, errRivalNotNewAPI, body)
	}
}

func TestParseRivalStatus(t *testing.T) {
	info := ParseRivalStatus([]byte(`{"success":true,"data":{"price":1,"usd_exchange_rate":7,"system_name":"PackyAPI","version":"v1.0.260","quota_per_unit":500000}}`))
	assert.Equal(t, RivalStatus{Price: 1, ExchangeRate: 7, SystemName: "PackyAPI", Version: "v1.0.260"}, info)
	assert.Equal(t, RivalStatus{}, ParseRivalStatus([]byte(`{"data":{"price":"x"}}`)))
}

func TestNormalizeRivalModel(t *testing.T) {
	assert.Equal(t, "claude-sonnet-4-5", NormalizeRivalModel("claude-sonnet-4-5-20250929"))
	assert.Equal(t, "claude-opus-5-5", NormalizeRivalModel(" Claude-Opus-5.5 "))
	assert.Equal(t, "claude-fable-5-2-thinking", NormalizeRivalModel("claude-fable-5-2-thinking"))
}

// apiranking-packy.html keeps the schema.org block of apiranking.com/p/packyapi-com.
func TestParseRivalDirectory(t *testing.T) {
	page := string(readRivalFixture(t, "apiranking-packy.html"))
	name, siteURL, ok := ParseRivalDirectoryPage(page)
	require.True(t, ok)
	assert.Equal(t, "PackyCode", name)
	assert.Equal(t, "https://www.packyapi.ai", siteURL)

	assert.Equal(t, map[string]string{"packyapi-com": "packyapi-com", "uuapi-io": "uuapi-io"}, ParseRivalDirectorySlugs(page))

	_, _, ok = ParseRivalDirectoryPage(`<script type="application/ld+json">{"provider":{"name":"x","url":"javascript:alert(1)"}}</script>`)
	assert.False(t, ok)
}

func TestRivalProbeCandidates(t *testing.T) {
	site := model.RivalSite{SiteURL: "https://www.packyapi.ai"}
	assert.Equal(t, []string{"https://www.packyapi.ai", "https://api.packyapi.ai", "https://packyapi.ai"}, RivalProbeCandidates(site))

	site.APIBase = "https://api.packyapi.ai"
	assert.Equal(t, "https://api.packyapi.ai", RivalProbeCandidates(site)[0], "the origin that answered last goes first")

	site.APIBaseLocked = true
	assert.Equal(t, []string{"https://api.packyapi.ai"}, RivalProbeCandidates(site))
}

func TestProbeRivalSiteReadsPricesAndStatus(t *testing.T) {
	pricing := readRivalFixture(t, "packy-pricing.json")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pricing":
			_, _ = w.Write(pricing)
		case "/api/status":
			_, _ = w.Write([]byte(`{"success":true,"data":{"price":0.5,"usd_exchange_rate":7,"system_name":"Test"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	client := &rivalHTTPClient{client: srv.Client(), protection: rivalFetchProtection()}

	result := probeRivalSite(context.Background(), client, model.RivalSite{APIBase: srv.URL, APIBaseLocked: true})
	require.Equal(t, model.RivalStatusOK, result.Status, result.Error)
	assert.Equal(t, 0.5, result.TopUpPrice)
	assert.Equal(t, "Test", result.SystemName)
	require.Len(t, result.Prices, 6)
	for _, p := range result.Prices {
		if p.Model == "claude-opus-5-5" && p.GroupName == "cc" {
			assert.InDelta(t, 5.0, *p.InputCNY, 1e-9)
		}
	}

	missing := probeRivalSite(context.Background(), client, model.RivalSite{APIBase: srv.URL + "/none", APIBaseLocked: true})
	assert.Equal(t, model.RivalStatusUnsupported, missing.Status)
	assert.Contains(t, missing.Error, "answered 404")
}

func TestProbeRivalSiteReportsTheFirstAnswerOverLaterNetworkErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	client := &rivalHTTPClient{client: srv.Client(), protection: rivalFetchProtection()}

	// The listed address answers 401; the api. and www. hosts do not resolve.
	result := probeRivalSite(context.Background(), client, model.RivalSite{SiteURL: srv.URL})
	assert.Equal(t, model.RivalStatusUnsupported, result.Status)
	assert.Contains(t, result.Error, "answered 401")
}

func TestRivalClientRefusesPrivateAddresses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":[]}`))
	}))
	defer srv.Close()

	// The server would answer as a proxy too, so only the address check can
	// make the proxied request fail.
	for _, proxy := range []string{"", srv.URL} {
		client, err := newRivalHTTPClient(proxy)
		require.NoError(t, err)
		status, _, err := client.get(context.Background(), srv.URL+"/api/pricing", "application/json")
		assert.Error(t, err, "proxy %q", proxy)
		assert.Zero(t, status)
	}
	_, err := newRivalHTTPClient("ftp://x")
	assert.Error(t, err)
}

func TestNormalizeRivalURL(t *testing.T) {
	got, ok := NormalizeRivalURL("API.Example.com/path?q=1")
	assert.True(t, ok)
	assert.Equal(t, "https://api.example.com", got)
	_, ok = NormalizeRivalURL("file:///etc/passwd")
	assert.False(t, ok)
}
