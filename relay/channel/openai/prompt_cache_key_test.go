package openai

import (
	"encoding/json"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

func withDerivedPromptCacheKeyChannels(t *testing.T, ids []int) {
	t.Helper()
	settings := model_setting.GetGlobalSettings()
	previous := settings.DerivedPromptCacheKeyChannelIDs
	settings.DerivedPromptCacheKeyChannelIDs = ids
	t.Cleanup(func() { settings.DerivedPromptCacheKeyChannelIDs = previous })
}

func responsesRequest(instructions, input string) dto.OpenAIResponsesRequest {
	request := dto.OpenAIResponsesRequest{Model: "gpt-6-astra"}
	if instructions != "" {
		request.Instructions = json.RawMessage(instructions)
	}
	if input != "" {
		request.Input = json.RawMessage(input)
	}
	return request
}

func derivedKey(t *testing.T, channelID, tokenID int, request dto.OpenAIResponsesRequest) string {
	t.Helper()
	info := &relaycommon.RelayInfo{TokenId: tokenID}
	info.ChannelMeta = &relaycommon.ChannelMeta{ChannelId: channelID}
	derivePromptCacheKey(info, &request)
	if len(request.PromptCacheKey) == 0 {
		return ""
	}
	var key string
	if err := json.Unmarshal(request.PromptCacheKey, &key); err != nil {
		t.Fatalf("prompt_cache_key is not a string: %s", request.PromptCacheKey)
	}
	return key
}

func TestDerivedPromptCacheKeyFollowsTheConversation(t *testing.T) {
	withDerivedPromptCacheKeyChannels(t, []int{7})

	firstTurn := responsesRequest(`"You are helpful."`, `[{"role":"user","content":"plan the trip"}]`)
	laterTurn := responsesRequest(`"You are helpful."`, `[{"role":"user","content":"plan the trip"},{"role":"assistant","content":"sure"},{"role":"user","content":"add a day"}]`)
	otherConversation := responsesRequest(`"You are helpful."`, `[{"role":"user","content":"write a poem"}]`)

	first := derivedKey(t, 7, 42, firstTurn)
	if !strings.HasPrefix(first, derivedPromptCacheKeyPrefix) || len(first) != len(derivedPromptCacheKeyPrefix)+32 {
		t.Fatalf("derived key %q has the wrong shape", first)
	}
	if later := derivedKey(t, 7, 42, laterTurn); later != first {
		t.Fatalf("a growing conversation changed its key: %q then %q", first, later)
	}
	if other := derivedKey(t, 7, 42, otherConversation); other == first {
		t.Fatalf("two conversations share key %q", first)
	}
	if otherToken := derivedKey(t, 7, 43, firstTurn); otherToken == first {
		t.Fatalf("two tokens share key %q", first)
	}
}

func TestDerivedPromptCacheKeyLeavesOtherRequestsAlone(t *testing.T) {
	withDerivedPromptCacheKeyChannels(t, []int{7})

	tests := []struct {
		name      string
		channelID int
		request   dto.OpenAIResponsesRequest
		want      string
	}{
		{"channel not listed", 8, responsesRequest(`"sys"`, `"hi"`), ""},
		{"empty request", 7, responsesRequest("", ""), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := derivedKey(t, tt.channelID, 42, tt.request); got != tt.want {
				t.Fatalf("got key %q, want %q", got, tt.want)
			}
		})
	}

	clientKey := responsesRequest(`"sys"`, `"hi"`)
	clientKey.PromptCacheKey = json.RawMessage(`"client-session"`)
	if got := derivedKey(t, 7, 42, clientKey); got != "client-session" {
		t.Fatalf("the client's key was replaced with %q", got)
	}

	for _, empty := range []string{`null`, `""`} {
		request := responsesRequest(`"sys"`, `"hi"`)
		request.PromptCacheKey = json.RawMessage(empty)
		if got := derivedKey(t, 7, 42, request); !strings.HasPrefix(got, derivedPromptCacheKeyPrefix) {
			t.Fatalf("prompt_cache_key %s was not filled, got %q", empty, got)
		}
	}
}

func TestDerivedPromptCacheKeyIsOffByDefault(t *testing.T) {
	withDerivedPromptCacheKeyChannels(t, nil)
	if got := derivedKey(t, 7, 42, responsesRequest(`"sys"`, `"hi"`)); got != "" {
		t.Fatalf("no channel is listed, but key %q was added", got)
	}
}
