package service

import (
	"testing"

	"github.com/QuantumNous/new-api/relaykit/types"
)

// The capture catalog holds events from the engine and from new-api; an audit
// that filters by protocol must find both, so new-api uses the engine's names.
func TestSessionCaptureProtocolUsesTheEngineNames(t *testing.T) {
	for format, want := range map[types.RelayFormat]string{
		types.RelayFormatOpenAI:          "openai-completions",
		types.RelayFormatOpenAIResponses: "openai-responses",
		types.RelayFormatOpenAIImage:     "openai-images",
		types.RelayFormatEmbedding:       "openai-embeddings",
		types.RelayFormatClaude:          "anthropic",
		types.RelayFormatGemini:          "gemini",
		types.RelayFormatRerank:          "rerank",
		types.RelayFormatTask:            "video",
	} {
		if got := sessionCaptureProtocol(format); got != want {
			t.Errorf("sessionCaptureProtocol(%q) = %q, want %q", format, got, want)
		}
	}
}
