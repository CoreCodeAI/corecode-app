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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { QueryClient } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { getUptimeStatus } from '@/features/dashboard/api'
import { prefetchCustomerOverview } from '@/features/dashboard/hooks/use-customer-overview'
import { prefetchApiKeys } from '@/features/keys/api-keys-query'
import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import { api } from '@/lib/api'

// The inline script in index.html that sends the boot requests.
const indexHtml = readFileSync(
  resolve(import.meta.dirname, '../../index.html'),
  'utf8'
)
const bootScript =
  [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((script) => script.includes('__bootRequests')) ?? ''

const network: string[] = []
const originalAdapter = api.defaults.adapter
let fetched: { url: string; authorization?: string }[] = []

function runBootScript(pathname: string) {
  window.history.replaceState(null, '', pathname)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = (init.headers ?? {}) as Record<string, string>
      fetched.push({ url, authorization: headers.Authorization })
      const body = url.startsWith('/api/user/auth/refresh')
        ? { success: true, data: { access_token: 'boot-token' } }
        : { success: true, data: { items: [], total: 0, fromBoot: url } }
      return new Response(JSON.stringify(body), { status: 200 })
    })
  )
  new Function(bootScript)()
}

beforeEach(() => {
  fetched = []
  network.length = 0
  document.cookie = 'new_api_has_session=1'
  vi.spyOn(performance, 'now').mockReturnValue(1000)
  api.defaults.adapter = (async (config) => {
    network.push(api.getUri(config))
    return {
      data: { success: true, data: [] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }) as AxiosAdapter
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  delete window.__bootRequests
  localStorage.clear()
  document.cookie = 'new_api_has_session=; max-age=0'
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const dataRequests = () =>
  fetched.filter(
    ({ url }) => !/^\/api\/(status|setup|user\/auth\/refresh)/.test(url)
  )

describe('the page data index.html fetches', () => {
  test('index.html has the boot script', () => {
    expect(bootScript).toContain('boot.data')
  })

  test('serves every request the overview starts, with the refresh token', async () => {
    runBootScript('/dashboard/overview')
    const queryClient = new QueryClient()
    prefetchCustomerOverview(queryClient)
    // The balance card's and the uptime panel's requests, sent on mount.
    await Promise.all([getSelfSubscriptionFull(), getUptimeStatus()])
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))

    expect(dataRequests()).toHaveLength(6)
    for (const request of dataRequests()) {
      expect(request.authorization).toBe('Bearer boot-token')
    }
    expect(network).toEqual([])
  })

  test.each([
    ['the default page size', undefined],
    ['the stored page size', '50'],
  ])('serves the keys table with %s', async (_, stored) => {
    if (stored) localStorage.setItem('page-size', stored)
    runBootScript('/keys')
    const queryClient = new QueryClient()
    prefetchApiKeys(queryClient, {})
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0))

    expect(dataRequests().map(({ url }) => url)).toEqual([
      `/api/token/?p=1&size=${stored ?? 20}`,
    ])
    expect(network).toEqual([])
  })

  test('fetches nothing for the keys page with search parameters', () => {
    runBootScript('/keys?page=2')
    expect(dataRequests()).toEqual([])
  })

  test('fetches nothing without a session hint', () => {
    document.cookie = 'new_api_has_session=; max-age=0'
    runBootScript('/dashboard/overview')
    expect(dataRequests()).toEqual([])
  })
})
