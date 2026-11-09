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
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { createAppQueryClient, shouldRetryQuery } from '@/lib/query-client'

afterEach(() => {
  vi.restoreAllMocks()
})

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } })

test.each([
  [400, false],
  [401, false],
  [403, false],
  [404, false],
  [429, false],
  [500, true],
  [502, true],
  [503, true],
  [504, true],
])('a first failure with HTTP %s retries: %s', (status, retries) => {
  expect(shouldRetryQuery(0, httpError(status))).toBe(retries)
})

test('a request that never got an answer retries, an unrelated exception does not', () => {
  const network = Object.assign(new Error('Network Error'), {
    code: 'ERR_NETWORK',
  })
  expect(shouldRetryQuery(0, network)).toBe(true)
  expect(shouldRetryQuery(0, new Error('render failed'))).toBe(false)
})

test('a failing 503 is retried at most twice', () => {
  expect(shouldRetryQuery(0, httpError(503))).toBe(true)
  expect(shouldRetryQuery(1, httpError(503))).toBe(true)
  expect(shouldRetryQuery(2, httpError(503))).toBe(false)
})

test('a background query that fails with 500 only notifies and leaves the page where it is', async () => {
  const notify = vi.spyOn(toast, 'error').mockReturnValue('error')
  window.history.replaceState({}, '', '/dashboard/overview')
  const client = createAppQueryClient()
  await client
    .fetchQuery({
      queryKey: ['feedback-unread'],
      queryFn: () => Promise.reject(httpError(500)),
      retry: false,
    })
    .catch(() => undefined)
  expect(window.location.pathname).toBe('/dashboard/overview')
  expect(notify).toHaveBeenCalledTimes(1)
})

test('meta.errorToast false keeps a silent poll silent', async () => {
  const notify = vi.spyOn(toast, 'error').mockReturnValue('error')
  const client = createAppQueryClient()
  await client
    .fetchQuery({
      queryKey: ['feedback-unread-silent'],
      queryFn: () => Promise.reject(httpError(500)),
      retry: false,
      meta: { errorToast: false },
    })
    .catch(() => undefined)
  expect(notify).not.toHaveBeenCalled()
})
