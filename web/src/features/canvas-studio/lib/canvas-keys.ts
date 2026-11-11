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
 * CoreCode fork: find or create the key the canvas app runs on.
 */
import { t } from 'i18next'

import { createApiKey, fetchTokenKey, getApiKeys } from '@/features/keys/api'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from '@/features/keys/lib/api-key-form'
import type { ApiKey } from '@/features/keys/types'
import {
  createServerError,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { CANVAS_KEY_GROUP, CANVAS_KEY_NAME, pickCanvasKey } from './canvas-link'

// The server caps a page at 100 rows.
const PAGE_SIZE = 100
const MAX_PAGES = 10

async function listAllKeys(): Promise<ApiKey[]> {
  const keys: ApiKey[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = requireServerSuccess(
      await getApiKeys({ p: page, size: PAGE_SIZE })
    )
    const items = result.data?.items ?? []
    keys.push(...items)
    if (items.length < PAGE_SIZE || keys.length >= (result.data?.total ?? 0)) {
      break
    }
  }
  return keys
}

/** The full key (with `sk-`) of one key row. */
export async function fetchFullKey(id: number): Promise<string> {
  const result = await fetchTokenKey(id)
  if (!result.success || !result.data?.key) {
    throw createServerError(result, t('Failed to load API keys'))
  }
  return `sk-${result.data.key}`
}

/**
 * The full key to hand the canvas, or null when the account has no suitable
 * key. Never creates one.
 */
export async function findCanvasKey(): Promise<string | null> {
  const picked = pickCanvasKey(await listAllKeys())
  return picked ? fetchFullKey(picked.id) : null
}

/**
 * Create the canvas key through the payload the key form submits with its
 * defaults: group `auto`, unlimited quota, never expires. Call only after an
 * explicit click.
 */
export async function createCanvasKey(): Promise<string> {
  const payload = transformFormDataToPayload({
    ...getApiKeyFormDefaultValues(true),
    name: CANVAS_KEY_NAME,
    group: CANVAS_KEY_GROUP,
  })
  const created = requireServerSuccess(await createApiKey(payload))
  const id = created.data?.id
  if (!id) throw new Error('The new API key has no id')
  return fetchFullKey(id)
}
