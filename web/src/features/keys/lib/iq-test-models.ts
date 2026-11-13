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
 * CoreCode fork: which of a key's models the IQ test offers. Kept apart from
 * the questions so the keys table can use it without loading them.
 */

// Image, video and review-only models cannot answer a chat question.
const NON_CHAT_MODEL = /image|seedance|video|sora|veo|^codex-auto-review$/i

/**
 * The models a key can be tested with: its group's chat models, narrowed to
 * the key's own model list when it has one.
 */
export function iqTestModels(
  groupModels: readonly string[],
  key: { model_limits_enabled: boolean; model_limits?: string | null }
): string[] {
  const allowed = key.model_limits_enabled
    ? new Set(
        (key.model_limits ?? '')
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean)
      )
    : null
  return groupModels.filter(
    (model) => !NON_CHAT_MODEL.test(model) && (!allowed || allowed.has(model))
  )
}
