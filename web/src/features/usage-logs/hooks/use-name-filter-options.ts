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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { displayKeyName } from '@/features/canvas-studio/lib/canvas-link'
import { getApiKeys } from '@/features/keys/api'
import { getUserModels } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

// The token list endpoint caps a page at 100 keys.
const KEY_NAME_PAGE_SIZE = 100

function toOptions(
  names: readonly string[],
  labelOf: (name: string) => string = (name) => name
): ComboboxInputOption[] {
  return [...new Set(names.filter((name) => typeof name === 'string' && name))]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ label: labelOf(name), value: name }))
}

/**
 * Choices for the token-name and model filters. Token names are the viewer's
 * own keys, so they are offered only in the personal view; an administrator
 * looking at every user's logs types the name instead.
 */
export function useNameFilterOptions(isAdminView: boolean): {
  tokenOptions: ComboboxInputOption[]
  modelOptions: ComboboxInputOption[]
} {
  const { t } = useTranslation()
  const { data: keyNames } = useQuery({
    queryKey: ['usage-logs-filter', 'key-names'],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getApiKeys({ p: 1, size: KEY_NAME_PAGE_SIZE })
      )
      const items = result.data?.items
      return Array.isArray(items) ? items.map((key) => key.name) : []
    },
    enabled: !isAdminView,
    staleTime: 60_000,
    meta: { errorToast: false },
  })
  const { data: models } = useQuery({
    queryKey: ['usage-logs-filter', 'models'],
    queryFn: async () => {
      const data = requireServerSuccess(await getUserModels()).data
      return Array.isArray(data) ? data : []
    },
    staleTime: 60_000,
    meta: { errorToast: false },
  })
  const tokenOptions = useMemo(
    () =>
      isAdminView
        ? []
        : toOptions(keyNames ?? [], (name) => displayKeyName(name, t)),
    [isAdminView, keyNames, t]
  )
  const modelOptions = useMemo(() => toOptions(models ?? []), [models])
  return { tokenOptions, modelOptions }
}
