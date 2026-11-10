package middleware

import (
	"net/http"
	"regexp"

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

// detectCodexClient returns the name of the first check the request failed,
// or "" when it looks like Codex. Only headers are read, so a WebSocket
// upgrade to /v1/responses is judged the same way as a POST.
func detectCodexClient(c *gin.Context) string {
	if !codexUserAgentPattern.MatchString(c.GetHeader("User-Agent")) {
		return "User-Agent"
	}
	if !codexOriginators[c.GetHeader("Originator")] {
		return "Originator header"
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
	logger.LogWarn(c.Request.Context(), "codex only group %s: %s check failed, rejected=true, user-agent=%q, originator=%q",
		group, failedCheck, clip(c.GetHeader("User-Agent"), 120), clip(c.GetHeader("Originator"), 40))
	abortWithOpenAiMessage(c, http.StatusForbidden,
		i18n.T(c, i18n.MsgAuthCodexOnly, map[string]any{"Group": group}), types.ErrorCodeAccessDenied)
	return false
}
