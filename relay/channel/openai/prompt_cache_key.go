package openai

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strconv"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

// derivedPromptCacheKeyPrefix marks keys CoreCode wrote, so a log reader can
// tell them from keys the client sent.
const derivedPromptCacheKeyPrefix = "cc-"

// derivePromptCacheKey gives a Responses request without prompt_cache_key a
// key that is stable for one conversation of one token, on the channels the
// operator listed. An upstream that pins requests to a backend by this key
// then keeps the conversation on the backend that holds its prompt cache;
// without it, requests spread over backends that each cache separately.
//
// The key hashes the token with the conversation's opening: the instructions
// and the first input item. Both stay the same while a conversation grows,
// and differ between conversations, so one customer's parallel sessions do
// not all pile onto one backend.
func derivePromptCacheKey(info *relaycommon.RelayInfo, request *dto.OpenAIResponsesRequest) {
	if info == nil || request == nil || !promptCacheKeyMissing(request.PromptCacheKey) {
		return
	}
	channels := model_setting.GetGlobalSettings().DerivedPromptCacheKeyChannelIDs
	if !slices.Contains(channels, info.ChannelId) {
		return
	}
	opening := firstInputItem(request.Input)
	if len(request.Instructions) == 0 && len(opening) == 0 {
		return
	}
	hash := sha256.New()
	hash.Write([]byte(strconv.Itoa(info.TokenId)))
	hash.Write([]byte{0})
	hash.Write(request.Instructions)
	hash.Write([]byte{0})
	hash.Write(opening)
	key, err := json.Marshal(derivedPromptCacheKeyPrefix + hex.EncodeToString(hash.Sum(nil))[:32])
	if err != nil {
		return
	}
	request.PromptCacheKey = key
}

func promptCacheKeyMissing(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) || bytes.Equal(trimmed, []byte(`""`))
}

// firstInputItem returns the first element of an input array, or the whole
// input when it is a single string or object.
func firstInputItem(input json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(input)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return trimmed
	}
	var items []json.RawMessage
	if err := json.Unmarshal(trimmed, &items); err != nil || len(items) == 0 {
		return nil
	}
	return items[0]
}
