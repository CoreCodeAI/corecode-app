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
 * CoreCode fork: which clients a key can be set up for, from its group. The
 * group list says whether the group admits Claude Code alone; the group's
 * models say whether Claude Code, Codex and OpenAI-compatible tools can use it.
 * A key without a group uses the account's group, so all its models count.
 */
import { useQuery } from '@tanstack/react-query'

import { getUserGroups, getUserModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { ApiKey } from '../types'
import { getSetupClients, type SetupClient } from './client-setup'

const EMPTY_MODELS: string[] = []

export function useSetupClients(key: Pick<ApiKey, 'group'> | null): {
  clients: SetupClient[]
  models: string[]
} {
  const group = key?.group ?? ''
  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    staleTime: 5 * 60 * 1000,
    enabled: key !== null,
  })
  const modelsQuery = useQuery({
    queryKey: ['client-setup', 'user-models', group],
    queryFn: async () =>
      requireServerSuccess(await getUserModels(group || undefined)).data ?? [],
    staleTime: 5 * 60 * 1000,
  })

  const groups = groupsQuery.data?.data
  const groupInfo =
    group && groups && !Array.isArray(groups) ? groups[group] : undefined
  const claudeCodeOnly = groupInfo?.claude_code_only === true
  const codexOnly = groupInfo?.codex_only === true
  const models = Array.isArray(modelsQuery.data)
    ? modelsQuery.data
    : EMPTY_MODELS
  // Until the group list arrives a Claude Code only key looks like any other,
  // so the guide stays on Claude Code rather than flashing other clients.
  const clients = getSetupClients({
    claudeCodeOnly,
    codexOnly,
    models: groupsQuery.isSuccess ? models : EMPTY_MODELS,
  })
  return { clients, models }
}
