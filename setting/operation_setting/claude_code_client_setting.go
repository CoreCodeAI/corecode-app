package operation_setting

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// ClaudeCodeClientSetting restricts groups to requests that look like they come
// from the Claude Code CLI. Every signal is sent by the client, so this keeps
// ordinary API clients out of a group; it does not stop a client that copies
// Claude Code's headers and request body.
type ClaudeCodeClientSetting struct {
	// Groups that accept Claude Code requests only. A token whose group is
	// "auto" is checked when any of its candidate groups is listed.
	Groups []string `json:"groups"`
	// Inclusive Claude Code version bounds (x.y.z) for the listed groups.
	// Empty means unbounded.
	MinVersion string `json:"min_version"`
	MaxVersion string `json:"max_version"`
}

var claudeCodeClientSetting = ClaudeCodeClientSetting{
	Groups: []string{},
}

func init() {
	config.GlobalConfig.Register("claude_code_client_setting", &claudeCodeClientSetting)
}

func GetClaudeCodeClientSetting() *ClaudeCodeClientSetting {
	return &claudeCodeClientSetting
}

// IsClaudeCodeOnlyGroup reports whether requests in group must come from Claude Code.
func IsClaudeCodeOnlyGroup(group string) bool {
	return group != "" && slices.Contains(claudeCodeClientSetting.Groups, group)
}

var claudeCodeVersionPattern = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// ValidateClaudeCodeClientGroups checks the JSON value of claude_code_client_setting.groups.
func ValidateClaudeCodeClientGroups(value string) error {
	return validateClientGroups("Claude Code", value)
}

// validateClientGroups checks a JSON array of group names restricted to client.
func validateClientGroups(client, value string) error {
	var groups []string
	if err := common.UnmarshalJsonStr(value, &groups); err != nil {
		return fmt.Errorf("%s groups must be a JSON array of group names: %w", client, err)
	}
	for _, group := range groups {
		if strings.TrimSpace(group) == "" || group != strings.TrimSpace(group) {
			return fmt.Errorf("%s group names must be non-empty and have no surrounding spaces", client)
		}
	}
	return nil
}

// ValidateClaudeCodeVersion checks a min_version or max_version value: empty or x.y.z.
func ValidateClaudeCodeVersion(value string) error {
	if value == "" || claudeCodeVersionPattern.MatchString(value) {
		return nil
	}
	return fmt.Errorf("Claude Code version must be empty or in the form x.y.z, got %q", value)
}
