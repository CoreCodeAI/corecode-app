package operation_setting

import (
	"slices"

	"github.com/QuantumNous/new-api/setting/config"
)

// CodexClientSetting restricts groups to requests that look like they come
// from an OpenAI Codex client: the CLI, codex exec, the IDE extension or the
// desktop app. Like ClaudeCodeClientSetting it reads only what the client
// sends, so it keeps ordinary API clients out of a group and does not stop a
// client that copies Codex's headers.
type CodexClientSetting struct {
	// Groups that accept Codex requests only. A token whose group is "auto" is
	// checked when any of its candidate groups is listed.
	Groups []string `json:"groups"`
}

var codexClientSetting = CodexClientSetting{
	Groups: []string{},
}

func init() {
	config.GlobalConfig.Register("codex_client_setting", &codexClientSetting)
}

func GetCodexClientSetting() *CodexClientSetting {
	return &codexClientSetting
}

// IsCodexOnlyGroup reports whether requests in group must come from Codex.
func IsCodexOnlyGroup(group string) bool {
	return group != "" && slices.Contains(codexClientSetting.Groups, group)
}

// ValidateCodexClientGroups checks the JSON value of codex_client_setting.groups.
func ValidateCodexClientGroups(value string) error {
	return validateClientGroups("Codex", value)
}
