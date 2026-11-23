package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPISourceUpstream serves a new-api whose key has no limit of its own and
// whose owner holds 167,644,190 quota at 500,000 per USD.
func newAPISourceUpstream(t *testing.T, paths *[]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*paths = append(*paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/usage/token/":
			_, _ = w.Write([]byte(`{"code":true,"data":{"total_available":-12345,"unlimited_quota":true,"user_quota":{"total_available":167644190}}}`))
		case "/api/status":
			_, _ = w.Write([]byte(`{"success":true,"data":{"quota_per_unit":500000}}`))
		case "/v1/dashboard/billing/subscription":
			_, _ = w.Write([]byte(`{"hard_limit_usd":99998975,"has_payment_method":true}`))
		case "/v1/dashboard/billing/usage":
			_, _ = w.Write([]byte(`{"total_usage":0}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func newOpenAICustomChannel(t *testing.T, baseURL, otherSettings string) *model.Channel {
	t.Helper()
	channel := &model.Channel{
		Type:          constant.ChannelTypeOpenAI,
		BaseURL:       &baseURL,
		Key:           "sk-upstream",
		Name:          "openai-custom",
		OtherSettings: otherSettings,
	}
	require.NoError(t, model.DB.Create(channel).Error)
	return channel
}

func TestOpenAICustomChannelWithNewAPIBalanceSourceReadsTheAccountQuota(t *testing.T) {
	setupSub2APIBalanceTest(t)
	var paths []string
	server := newAPISourceUpstream(t, &paths)
	defer server.Close()

	channel := newOpenAICustomChannel(t, server.URL, `{"balance_source":"newapi"}`)
	result, err := updateChannelBalance(channel)
	require.NoError(t, err)
	assert.InDelta(t, 167644190.0/500000, result.Balance, 1e-9)
	assert.InDelta(t, 167644190.0/500000, channel.Balance, 1e-9)
	assert.Equal(t, []string{"/api/usage/token/", "/api/status"}, paths)
}

func TestOpenAICustomChannelWithoutBalanceSourceKeepsTheSubscriptionRead(t *testing.T) {
	setupSub2APIBalanceTest(t)
	var paths []string
	server := newAPISourceUpstream(t, &paths)
	defer server.Close()

	channel := newOpenAICustomChannel(t, server.URL, "")
	result, err := updateChannelBalance(channel)
	require.NoError(t, err)
	assert.InDelta(t, 99998975.0, result.Balance, 1e-6)
	assert.Equal(t, []string{"/v1/dashboard/billing/subscription", "/v1/dashboard/billing/usage"}, paths)
}

func TestNewAPIBalanceSourceKeepsTheStoredBalanceWhenTheQueryFails(t *testing.T) {
	setupSub2APIBalanceTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":false,"message":"invalid token"}`))
	}))
	defer server.Close()

	channel := newOpenAICustomChannel(t, server.URL, `{"balance_source":"newapi"}`)
	require.NoError(t, model.DB.Model(channel).Update("balance", 12.5).Error)
	channel.Balance = 12.5

	_, err := updateChannelBalance(channel)
	require.ErrorContains(t, err, "invalid token")
	stored := model.Channel{}
	require.NoError(t, model.DB.First(&stored, channel.Id).Error)
	assert.InDelta(t, 12.5, stored.Balance, 1e-9)
	assert.Equal(t, channel.Status, stored.Status)
}
