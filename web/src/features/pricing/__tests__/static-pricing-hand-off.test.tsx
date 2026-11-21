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
import { QueryClient } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sanitizeAuthRedirect } from '@/features/auth/lib/auth-redirect'
import { useAuthStore } from '@/stores/auth-store'

import { Route as ModelRoute } from '../../../routes/pricing/$modelId/index'
import { Route as PricingRoute } from '../../../routes/pricing/index'
import { staticPricingServes, staticPricingTarget } from '../lib/static-pricing'

const access = vi.hoisted(() => vi.fn())

vi.mock('@/lib/nav-modules', () => ({ getModuleAccessForGuard: access }))
vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/features/pricing', () => ({
  Pricing: () => <div>console price list</div>,
}))
vi.mock('@/features/pricing/components/model-details', () => ({
  ModelDetails: () => <div>console model details</div>,
}))

// The document's own load: what the proxy answered with.
function loadedAt(url: string) {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { name: url } as PerformanceEntry,
  ])
}

function stubLocation(search: string) {
  const replace = vi.fn()
  vi.stubGlobal('location', { ...window.location, search, replace })
  return replace
}

function renderAt(path: string) {
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Outlet,
  })
  const router = createRouter({
    routeTree: root.addChildren([
      PricingRoute.update({
        id: '/pricing/',
        path: '/pricing/',
        getParentRoute: () => root,
      } as never),
      ModelRoute.update({
        id: '/pricing/$modelId/',
        path: '/pricing/$modelId/',
        getParentRoute: () => root,
      } as never),
      createRoute({
        getParentRoute: () => root,
        path: '/sign-in',
        component: () => <div>sign-in page</div>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => <div>console home</div>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  })
  render(<RouterProvider router={router} />)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  access.mockReset()
  useAuthStore.getState().auth.reset('idle')
})

describe('staticPricingServes', () => {
  it('is true for a document loaded on another console page', () => {
    loadedAt('https://corecode.live/dashboard')
    expect(staticPricingServes()).toBe(true)
  })

  it('is false for a document loaded under /pricing, so it cannot loop', () => {
    for (const url of [
      'http://localhost:5173/pricing',
      'http://localhost:5173/pricing/',
      'http://localhost:5173/pricing/claude-opus-5-5',
    ]) {
      loadedAt(url)
      expect(staticPricingServes()).toBe(false)
    }
  })

  it('is false without a navigation entry', () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    expect(staticPricingServes()).toBe(false)
  })

  it('does not take /pricing-like paths for the static page', () => {
    loadedAt('https://corecode.live/pricingx')
    expect(staticPricingServes()).toBe(true)
  })
})

describe('staticPricingTarget', () => {
  it('goes to the list, keeping only the filters the static page reads', () => {
    expect(staticPricingTarget('')).toBe('/pricing/')
    expect(
      staticPricingTarget('?search=opus&group=Claude&vendor=x&view=table')
    ).toBe('/pricing/?search=opus&group=Claude')
  })

  it('leaves a model to the proxy, which knows whether it has a page', () => {
    expect(staticPricingTarget('?search=x', 'claude-opus-5-5')).toBe(
      '/pricing/claude-opus-5-5'
    )
    expect(staticPricingTarget('', 'a b/c')).toBe('/pricing/a%20b%2Fc')
  })
})

describe('console pricing routes', () => {
  it('hand a client-side visit to the static list with a full load', async () => {
    access.mockResolvedValue({ enabled: true, requireAuth: false })
    loadedAt('https://corecode.live/dashboard')
    const replace = stubLocation('?search=opus')
    renderAt('/pricing/?search=opus')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/pricing/?search=opus')
    )
    expect(screen.queryByText('console price list')).toBeNull()
  })

  it('hand a model visit to /pricing/<modelId> for the proxy to route', async () => {
    access.mockResolvedValue({ enabled: true, requireAuth: false })
    loadedAt('https://corecode.live/dashboard')
    const replace = stubLocation('')
    renderAt('/pricing/claude-opus-5-5/')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/pricing/claude-opus-5-5')
    )
    expect(screen.queryByText('console model details')).toBeNull()
  })

  it('render the console list where the console itself served /pricing/', async () => {
    access.mockResolvedValue({ enabled: true, requireAuth: false })
    loadedAt('http://localhost:5173/pricing/')
    const replace = stubLocation('')
    renderAt('/pricing/')

    expect(await screen.findByText('console price list')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('render the console model page where the console served the model URL', async () => {
    access.mockResolvedValue({ enabled: true, requireAuth: false })
    loadedAt('http://localhost:5173/pricing/claude-opus-5-5')
    const replace = stubLocation('')
    renderAt('/pricing/claude-opus-5-5/')

    expect(await screen.findByText('console model details')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('still send a visitor to sign-in first when the module requires it', async () => {
    access.mockResolvedValue({ enabled: true, requireAuth: true })
    loadedAt('https://corecode.live/dashboard')
    const replace = stubLocation('')
    renderAt('/pricing/')

    expect(await screen.findByText('sign-in page')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('send a signed-in visitor on after the sign-in redirect to /pricing', async () => {
    // Sign-in keeps /pricing as its redirect target and navigates there with
    // the router; the route then hands the visit to the static page.
    expect(sanitizeAuthRedirect('/pricing', 'https://corecode.live')).toBe(
      '/pricing'
    )
    access.mockResolvedValue({ enabled: true, requireAuth: true })
    useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
    loadedAt('https://corecode.live/sign-in?redirect=%2Fpricing')
    const replace = stubLocation('')
    renderAt('/pricing')

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/pricing/'))
  })

  it('go home when the module is disabled', async () => {
    access.mockResolvedValue({ enabled: false, requireAuth: false })
    loadedAt('https://corecode.live/dashboard')
    const replace = stubLocation('')
    renderAt('/pricing/')

    expect(await screen.findByText('console home')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
