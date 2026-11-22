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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { useTopNavLinks } from '../use-top-nav-links'

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAuthStore.getState().auth.reset()
})

function linkHrefsFor(role?: number, headerNavModules = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], { HeaderNavModules: headerNavModules })
  if (role !== undefined) {
    useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role })
  }
  function Wrapper(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
  const { result } = renderHook(() => useTopNavLinks(), { wrapper: Wrapper })
  return result.current.map((link) => link.href)
}

describe('rankings nav link', () => {
  it('is hidden from visitors and ordinary users', () => {
    expect(linkHrefsFor()).not.toContain('/rankings')
    expect(linkHrefsFor(ROLE.USER)).not.toContain('/rankings')
  })

  it('is shown to administrators and root', () => {
    expect(linkHrefsFor(ROLE.ADMIN)).toContain('/rankings')
    expect(linkHrefsFor(ROLE.SUPER_ADMIN)).toContain('/rankings')
  })

  it('stays hidden from administrators when the module is disabled', () => {
    expect(
      linkHrefsFor(ROLE.ADMIN, JSON.stringify({ rankings: false }))
    ).not.toContain('/rankings')
  })
})

describe('status nav link', () => {
  it('is shown to visitors by default and opens outside the router', () => {
    expect(linkHrefsFor()).toContain('/status/')
  })

  it('is hidden when the module is disabled', () => {
    expect(
      linkHrefsFor(undefined, JSON.stringify({ status: false }))
    ).not.toContain('/status/')
  })
})

describe('enterprise nav link', () => {
  it('is shown to visitors by default', () => {
    expect(linkHrefsFor()).toContain('/enterprise')
  })

  it('is hidden when the module is disabled', () => {
    expect(
      linkHrefsFor(undefined, JSON.stringify({ enterprise: false }))
    ).not.toContain('/enterprise')
  })
})
