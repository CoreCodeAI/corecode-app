package middleware

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

// Codex clients send a User-Agent that starts with their originator and a
// semver, and the same originator in an Originator header, for example
//
//	User-Agent: codex-tui/0.167.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.167.0)
//	Originator: codex-tui
//
// The names below are the ones seen on the relay in November 2026: the CLI
// (codex_cli_rs before 0.150, codex-tui after), codex exec, the IDE extension
// and the desktop app, whose work mode sends codex_work_desktop with the
// desktop User-Agent. A gateway that forwards Codex traffic under its own
// User-Agent, such as axonhub/1.0, is refused.
var codexUserAgentPattern = regexp.MustCompile(`^(codex_cli_rs|codex-tui|codex_exec|codex_vscode|Codex Desktop)/\d+\.\d+\.\d+`)

var codexOriginators = map[string]bool{
	"codex_cli_rs":       true,
	"codex-tui":          true,
	"codex_exec":         true,
	"codex_vscode":       true,
	"Codex Desktop":      true,
	"codex_work_desktop": true,
}

// Codex talks to the Responses API only: /v1/responses, its WebSocket upgrade
// and /v1/responses/compact. A client that sends Codex's headers to Chat
// Completions is something else, and upstream keeps a conversation on one
// backend only for Responses requests, so it would also lose its cache.
const codexResponsesPath = "/v1/responses"

// codexCheckPath names the failed check of a request with Codex's headers on
// another API.
const codexCheckPath = "path"

func isCodexResponsesPath(path string) bool {
	return path == codexResponsesPath || strings.HasPrefix(path, codexResponsesPath+"/")
}

// detectCodexClient returns the name of the first check the request failed,
// or "" when it looks like Codex. Only headers and the path are read, so a
// WebSocket upgrade to /v1/responses is judged the same way as a POST.
func detectCodexClient(c *gin.Context) string {
	if !codexUserAgentPattern.MatchString(c.GetHeader("User-Agent")) {
		return "User-Agent"
	}
	if !codexOriginators[c.GetHeader("Originator")] {
		return "Originator header"
	}
	if !isCodexResponsesPath(c.Request.URL.Path) {
		return codexCheckPath
	}
	return ""
}

// admitCodex reports whether the request looks like Codex. A failed check
// aborts the request when reject is set and only returns false when it is not.
func admitCodex(c *gin.Context, group string, reject bool) bool {
	failedCheck := detectCodexClient(c)
	if failedCheck == "" {
		return true
	}
	if !reject {
		logger.LogWarn(c.Request.Context(), "codex only group %s: %s check failed, rejected=false", group, failedCheck)
		return false
	}
	logger.LogWarn(c.Request.Context(), "codex only group %s: %s check failed, rejected=true, user-agent=%q, originator=%q, path=%q",
		group, failedCheck, clip(c.GetHeader("User-Agent"), 120), clip(c.GetHeader("Originator"), 40), clip(c.Request.URL.Path, 80))
	message := i18n.MsgAuthCodexOnly
	if failedCheck == codexCheckPath {
		message = i18n.MsgAuthCodexOnlyResponses
	}
	abortWithOpenAiMessage(c, http.StatusForbidden,
		i18n.T(c, message, map[string]any{"Group": group}), types.ErrorCodeAccessDenied)
	return false
}
