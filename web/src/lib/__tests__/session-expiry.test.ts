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
import { AxiosError } from 'axios'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'
import { api } from '@/lib/http-client'
import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

const origin = 'https://console.example.com'
const originalAdapter = api.defaults.adapter

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

// Runs a request on `page` whose 401 cannot be refreshed and returns the
// address the console replaced the page with.
async function expireSessionOn(page: { pathname: string; search?: string }) {
  const bundle: AuthBundle = {
    access_token: 'expired-access',
    token_type: 'Bearer',
    access_expires_at: 1,
    user: { id: 1, username: 'test-user', role: 1 },
    session: {
      sid: 'expiring-session',
      current: true,
      login_method: 'password',
      ip: '',
      user_agent: '',
      created_at: 1,
      last_active_at: 1,
      expires_at: 2_000_000_000,
    },
  }
  useAuthStore.getState().auth.setBundle(bundle)
  const replace = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    origin,
    pathname: page.pathname,
    search: page.search ?? '',
    hash: '#row-7',
    replace,
  })
  vi.spyOn(XMLHttpRequest.prototype, 'open')
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(function (
    this: XMLHttpRequest
  ) {
    Object.defineProperties(this, {
      status: { value: 401, configurable: true },
      statusText: { value: 'Unauthorized', configurable: true },
      responseText: {
        value: JSON.stringify({ success: false }),
        configurable: true,
      },
      readyState: { value: 4, configurable: true },
    })
    this.onloadend?.(new ProgressEvent('loadend'))
  })
  vi.spyOn(toast, 'error').mockReturnValue('error')
  api.defaults.adapter = async (config) => {
    throw new AxiosError('HTTP 401', 'ERR_BAD_REQUEST', config, undefined, {
      data: { message: 'Access token expired' },
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    })
  }

  await api.get('/api/log/self').catch(() => undefined)

  expect(replace).toHaveBeenCalledTimes(1)
  const target = new URL(replace.mock.calls[0][0], origin)
  expect(target.origin).toBe(origin)
  expect(target.pathname).toBe('/sign-in')
  return target
}

// What sign-in navigates to after signing in: the carried target after its check.
function signInTarget(target: URL) {
  return sanitizeAuthRedirect(target.searchParams.get('redirect'), origin)
}

it('sends a page whose refresh fails to sign-in with the page as the redirect target', async () => {
  const target = await expireSessionOn({
    pathname: '/usage-logs',
    search: '?type=2&q=prod',
  })

  expect(target.searchParams.get('redirect')).toBe('/usage-logs?type=2&q=prod')
  expect(signInTarget(target)).toBe('/usage-logs?type=2&q=prod')
})

it('tells sign-in that the session expired', async () => {
  const target = await expireSessionOn({ pathname: '/keys' })

  expect(target.searchParams.get('reason')).toBe('expired')
})

it.each([
  ['a protocol-relative path', '//attacker.example'],
  ['a dot segment that normalizes to another host', '/.//attacker.example'],
  ['a backslash', '/\\attacker.example/path'],
])(
  'never lets %s in the page address take sign-in to another host',
  async (_name, pathname) => {
    const target = await expireSessionOn({ pathname })

    expect(signInTarget(target)).toBe(null)
  }
)

it('keeps an encoded slash in the page address as a same-origin path', async () => {
  const target = await expireSessionOn({ pathname: '/%2F%2Fattacker.example' })

  expect(signInTarget(target)).toBe('/%2F%2Fattacker.example')
})
