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
/**
 * CoreCode fork: create a first key in one step, for a customer who has none.
 * It builds the payload the create drawer would submit with its defaults: the
 * group the drawer starts on, unlimited quota, never expires.
 */
import type { QueryClient } from '@tanstack/react-query'

import { getUserGroups } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { createApiKey, getApiKey, getTokenAutoGroups } from '../api'
import type { ApiKey } from '../types'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from './api-key-form'

export const STARTER_KEY_NAME = 'claude-code'

/**
 * The group a new key starts on, as the create drawer picks it: Auto when it
 * is the default and offered, else the first Auto group, else the account's.
 */
export function pickStarterGroup(params: {
  defaultUseAutoGroup: boolean
  groupNames: string[]
  autoGroups: string[]
}): string {
  if (!params.defaultUseAutoGroup) return ''
  if (params.groupNames.includes('auto')) return 'auto'
  const offered = new Set(params.groupNames)
  return params.autoGroups.find((group) => offered.has(group)) ?? ''
}

export async function createStarterKey(
  queryClient: QueryClient,
  defaultUseAutoGroup: boolean
): Promise<ApiKey> {
  const [groups, autoGroups] = await Promise.all([
    queryClient.fetchQuery({
      queryKey: ['user-groups'],
      queryFn: async () => requireServerSuccess(await getUserGroups()),
      staleTime: 60 * 1000,
    }),
    queryClient.fetchQuery({
      queryKey: ['token-auto-groups'],
      queryFn: async () => requireServerSuccess(await getTokenAutoGroups()),
      staleTime: 60 * 1000,
    }),
  ])
  const group = pickStarterGroup({
    defaultUseAutoGroup,
    groupNames: Object.keys(groups.data ?? {}),
    autoGroups: autoGroups.data?.groups ?? [],
  })
  const form = getApiKeyFormDefaultValues(group === 'auto')
  const payload = transformFormDataToPayload({
    ...form,
    name: STARTER_KEY_NAME,
    group,
  })
  const created = requireServerSuccess(await createApiKey(payload))
  const id = created.data?.id
  if (!id) throw new Error('The new API key has no id')
  const fetched = requireServerSuccess(await getApiKey(id))
  if (!fetched.data) throw new Error('The new API key could not be read')
  return fetched.data
}
