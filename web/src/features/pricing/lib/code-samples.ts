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
 * Pieces of the model page's code samples that more than one sample shares:
 * the one name of the API key, and the Claude Code setup for a Claude model.
 */

/** The environment variable every code sample reads the API key from. */
export const API_KEY_ENV = 'CORECODE_API_KEY'

export function isClaudeModelName(modelName: string): boolean {
  return /^claude-/i.test(modelName)
}

/**
 * Claude Code reads ANTHROPIC_BASE_URL and appends /v1/messages itself, so the
 * address stays the bare origin.
 */
export function claudeCodeBaseUrl(serverAddress: string): string {
  return serverAddress.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** A settings.json `env` block and the command that starts Claude Code on the model. */
export function buildClaudeCodeSample(
  serverAddress: string,
  modelName: string
): string {
  return [
    '# ~/.claude/settings.json',
    JSON.stringify(
      {
        env: {
          ANTHROPIC_BASE_URL: claudeCodeBaseUrl(serverAddress),
          ANTHROPIC_AUTH_TOKEN: `<${API_KEY_ENV}>`,
        },
      },
      null,
      2
    ),
    '',
    '# then start Claude Code on this model',
    `claude --model ${modelName}`,
  ].join('\n')
}
