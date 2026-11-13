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
import { prefetchGet } from '@/lib/prefetch-get'
import { useAuthStore } from '@/stores/auth-store'

const originalAdapter = api.defaults.adapter
const sent: string[] = []
let now = 1000
let reply: (url: string) => unknown = () => ({ success: true, data: 'v1' })

beforeEach(() => {
  sent.length = 0
  now += 60_000 // every test starts after the previous one's entries expired
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  reply = () => ({ success: true, data: 'v1' })
  api.defaults.adapter = (async (config) => {
    const url = api.getUri(config)
    sent.push(url)
    return {
      data: reply(url),
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
  vi.restoreAllMocks()
})

describe('prefetchGet', () => {
  test('the page takes the prefetched response instead of sending another request', async () => {
    prefetchGet('/api/a?x=1')
    const response = await api.get('/api/a?x=1')
    expect(response.data).toEqual({ success: true, data: 'v1' })
    expect(sent).toEqual(['/api/a?x=1'])
  })

  test('readers of the same URL at once share the prefetched response', async () => {
    prefetchGet('/api/a')
    await Promise.all([api.get('/api/a'), api.get('/api/a')])
    expect(sent).toHaveLength(1)
  })

  test('a response serves one load: a later read sends its own request', async () => {
    prefetchGet('/api/a')
    await api.get('/api/a')
    reply = () => ({ success: true, data: 'v2' })
    const again = await api.get('/api/a')
    expect(again.data).toEqual({ success: true, data: 'v2' })
    expect(sent).toHaveLength(2)
  })

  test('a prefetch older than ten seconds is not used', async () => {
    prefetchGet('/api/a')
    now += 10_001
    await api.get('/api/a')
    expect(sent).toHaveLength(2)
  })

  test('hovering again within ten seconds sends nothing new', async () => {
    prefetchGet('/api/a')
    now += 5_000
    prefetchGet('/api/a')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await api.get('/api/a')
    expect(sent).toHaveLength(1)
  })

  test('the loader running again once the page has read the response sends nothing', async () => {
    prefetchGet('/api/a')
    await api.get('/api/a')
    prefetchGet('/api/a')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toHaveLength(1)
  })

  test('a failed prefetch is not handed over: the page sends its own request', async () => {
    reply = () => ({ success: false, message: 'nope' })
    prefetchGet('/api/a')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    reply = () => ({ success: true, data: 'v2' })
    const response = await api.get('/api/a')
    expect(response.data).toEqual({ success: true, data: 'v2' })
    expect(sent).toHaveLength(2)
  })

  test('another session does not get the prefetched response', async () => {
    prefetchGet('/api/a')
    const state = useAuthStore.getState()
    vi.spyOn(useAuthStore, 'getState').mockReturnValue({
      ...state,
      auth: { ...state.auth, session: { sid: 'other-session' } as never },
    })
    await api.get('/api/a')
    expect(sent).toHaveLength(2)
  })

  test('it is still used while index.html boot data is pending for other URLs', async () => {
    window.__bootRequests = {
      data: { '/api/boot-only': Promise.resolve({ status: 200, data: {} }) },
    }
    prefetchGet('/api/a')
    await api.get('/api/a')
    expect(sent).toEqual(['/api/a'])
  })

  test('nothing is sent for a URL index.html has already fetched', async () => {
    // Boot data serves the first ten seconds of a page load.
    vi.spyOn(performance, 'now').mockReturnValue(5_000)
    window.__bootRequests = {
      data: {
        '/api/a': Promise.resolve({ status: 200, data: { boot: true } }),
      },
    }
    prefetchGet('/api/a')
    const response = await api.get('/api/a')
    expect(response.data).toEqual({ boot: true })
    expect(sent).toEqual([])
  })
})
