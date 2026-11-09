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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { Home } from '../index'

const getHomePageContent = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({ getHomePageContent }))
vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/components/layout/components/footer', () => ({
  Footer: () => null,
}))
vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
}))
vi.mock('../components', () => ({
  CTA: () => <div>stock cta</div>,
  Features: () => null,
  Hero: () => <div>stock hero</div>,
  HowItWorks: () => null,
  Stats: () => null,
}))
vi.mock('@/components/rich-content', () => ({
  RichContent: ({ content }: { content: string }) => <div>{content}</div>,
}))

function renderHome(search: string) {
  window.history.replaceState({}, '', `/${search}`)
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: Home }),
      createRoute({
        getParentRoute: () => root,
        path: '/sign-up',
        component: () => <div>Sign-up page</div>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/${search}`] }),
  })
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  useAuthStore.getState().auth.reset('idle')
  vi.clearAllMocks()
})

describe('Home', () => {
  it('sends an invitation visitor with no custom content to sign-up', async () => {
    getHomePageContent.mockResolvedValue({ success: true, data: '' })
    renderHome('?ref=friend')

    expect(await screen.findByText('Sign-up page')).toBeInTheDocument()
    expect(screen.queryByText('stock hero')).toBeNull()
  })

  it('keeps the stock page for a visitor without an invitation code', async () => {
    getHomePageContent.mockResolvedValue({ success: true, data: '' })
    renderHome('')

    expect(await screen.findByText('stock hero')).toBeInTheDocument()
  })

  it('paints cached custom content before the request answers', async () => {
    window.localStorage.setItem('home_page_content', '# cached home')
    getHomePageContent.mockReturnValue(new Promise(() => undefined))
    renderHome('?ref=friend')

    expect(await screen.findByText('# cached home')).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).toBeNull()
    await waitFor(() => expect(getHomePageContent).toHaveBeenCalled())
  })
})
