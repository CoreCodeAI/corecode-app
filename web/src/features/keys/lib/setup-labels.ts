/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * CoreCode fork: the labels, sources and hints of the client setup snippets,
 * shared by the key's setup guide and the onboarding wizard so the two never
 * give different words for the same snippet.
 */
import type { ClientSetupTarget } from './client-setup'

export const TARGET_LABELS: Record<ClientSetupTarget, string> = {
  settings: 'settings.json',
  shell: 'macOS / Linux',
  powershell: 'Windows',
  'cc-switch': 'CC Switch',
  magpie: 'Magpie',
  'codex-config': 'config.toml',
  'codex-shell': 'macOS / Linux',
  'codex-powershell': 'Windows',
  'codex-cc-switch': 'CC Switch',
  'codex-magpie': 'Magpie',
  'openai-shell': 'macOS / Linux',
  'openai-powershell': 'Windows',
  'openai-curl': 'curl',
}

/** What the snippet is: a file to edit or the shell to paste it into. */
export const TARGET_SOURCES: Record<ClientSetupTarget, string> = {
  settings: '~/.claude/settings.json',
  shell: 'bash / zsh',
  powershell: 'PowerShell',
  'cc-switch': 'CC Switch · settings.json',
  magpie: 'bash / zsh',
  'codex-config': '~/.codex/config.toml',
  'codex-shell': 'bash / zsh',
  'codex-powershell': 'PowerShell',
  'codex-cc-switch': 'CC Switch · config.toml',
  'codex-magpie': 'bash / zsh',
  'openai-shell': 'bash / zsh',
  'openai-powershell': 'PowerShell',
  'openai-curl': 'bash / zsh',
}

export function getTargetHint(
  target: ClientSetupTarget,
  t: (key: string) => string
): string {
  switch (target) {
    case 'settings':
      return t(
        'Recommended. Merge this env block into ~/.claude/settings.json (Windows: %USERPROFILE%\\.claude\\settings.json), then open a new terminal and run claude.'
      )
    case 'shell':
      return t(
        'For the current terminal only. Add the two export lines to ~/.zshrc or ~/.bashrc to keep them.'
      )
    case 'powershell':
      return t(
        'For the current PowerShell window only. Use setx for both variables to keep them, then reopen the terminal.'
      )
    case 'cc-switch':
      return t(
        'Import with one click, or add a custom provider in CC Switch and paste this config. New Claude Code sessions use it after you switch.'
      )
    case 'magpie':
      return t(
        'Adds this gateway as a Magpie provider and switches Claude Code to it. New sessions use it.'
      )
    case 'codex-magpie':
      return t(
        'Adds this gateway as a Magpie provider and switches Codex to it. One provider serves Claude Code and Codex, so add it once.'
      )
    case 'codex-config':
      return t(
        'Recommended. Add this to ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml). Codex reads the key from the variable named in env_key; set it on the macOS / Linux or Windows tab.'
      )
    case 'codex-shell':
      return t(
        'Sets the key Codex reads, for the current terminal only. Add the export line to ~/.zshrc or ~/.bashrc to keep it.'
      )
    case 'codex-powershell':
      return t(
        'Sets the key Codex reads, for the current PowerShell window only. Use setx to keep it, then reopen the terminal.'
      )
    case 'codex-cc-switch':
      return t(
        'Import with one click, or add a custom Codex provider in CC Switch with this config. New Codex sessions use it after you switch.'
      )
    case 'openai-shell':
      return t(
        'For SDKs and tools that speak the OpenAI API and read these variables. Anthropic SDKs take the address without /v1.'
      )
    case 'openai-powershell':
      return t(
        'For SDKs and tools that speak the OpenAI API, in the current PowerShell window only. Anthropic SDKs take the address without /v1.'
      )
    case 'openai-curl':
      return t(
        'A Chat Completions request. Any tool that lets you set an OpenAI base URL works with the same address and key.'
      )
  }
}
