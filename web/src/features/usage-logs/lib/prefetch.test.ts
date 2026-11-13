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
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getLogStats, getUserLogStats } from '../api'
import { prefetchCommonLogsPage } from './prefetch'
import { buildApiParams, fetchLogsByCategory } from './utils'

const originalAdapter = api.defaults.adapter
const sent: string[] = []
let now = 1_000_000

function signInAs(role: number) {
  const state = useAuthStore.getState()
  vi.spyOn(useAuthStore, 'getState').mockReturnValue({
    ...state,
    auth: { ...state.auth, user: { ...state.auth.user, role } as never },
  })
}

function setPhone(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query === '(max-width: 640px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

// What UsageLogsTable and CommonLogsStats request on their first render.
async function loadPageLikeTheTable(
  search: Record<string, unknown>,
  isAdmin: boolean,
  pageSize: number
) {
  await fetchLogsByCategory({
    logCategory: 'common',
    isAdmin,
    page: 1,
    pageSize,
    searchParams: search,
    columnFilters: [],
  })
  const statsParams = buildApiParams({
    page: 1,
    pageSize: 1,
    searchParams: search,
    columnFilters: [],
    isAdmin,
  })
  await (isAdmin ? getLogStats(statsParams) : getUserLogStats(statsParams))
}

beforeEach(() => {
  sent.length = 0
  now += 60_000
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  api.defaults.adapter = (async (config) => {
    sent.push(api.getUri(config))
    return {
      data: { success: true, data: { items: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }) as AxiosAdapter
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('prefetchCommonLogsPage', () => {
  test.each([
    ['a customer on a desktop', ROLE.USER, false, 100],
    ['an admin on a desktop', ROLE.ADMIN, true, 100],
    ['a customer on a phone', ROLE.USER, false, 20],
  ])(
    'the page reuses both prefetched requests for %s',
    async (_who, role, isAdmin, pageSize) => {
      signInAs(role)
      setPhone(pageSize === 20)
      prefetchCommonLogsPage({})
      await vi.waitFor(() => expect(sent).toHaveLength(2))
      await loadPageLikeTheTable({}, isAdmin, pageSize)
      expect(sent).toHaveLength(2)
    }
  )

  test('filters in the link are part of the prefetched URLs', async () => {
    signInAs(ROLE.USER)
    setPhone(false)
    const search = { model: 'claude-fable-5', token: 'key-1', page: 2 }
    prefetchCommonLogsPage(search)
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[0]).toContain('model_name=claude-fable-5')
    expect(sent[0]).toContain('p=2')
    await fetchLogsByCategory({
      logCategory: 'common',
      isAdmin: false,
      page: 2,
      pageSize: 100,
      searchParams: search,
      columnFilters: [],
    })
    expect(sent).toHaveLength(2)
  })
})
