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
  notFound,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { AuthenticatedLayout } from '@/components/layout'
import { useAuthStore } from '@/stores/auth-store'

import { ShellGeneralError, ShellNotFoundError } from '../shell-errors'

afterEach(() => {
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

// The real layout needs the sidebar and header providers; this stand-in keeps
// the contract that matters here: children replace the page outlet.
vi.mock('@/components/layout', () => ({
  AuthenticatedLayout: (props: { children?: React.ReactNode }) => (
    <div>
      <nav aria-label='console sidebar'>sidebar</nav>
      {props.children ?? <Outlet />}
    </div>
  ),
}))

function Shell() {
  return <AuthenticatedLayout />
}

async function renderConsole(path: string) {
  const root = createRootRoute({
    component: Outlet,
    errorComponent: () => <p>root error page</p>,
    notFoundComponent: () => <p>root not found page</p>,
  })
  const layout = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    component: Shell,
    errorComponent: ShellGeneralError,
    notFoundComponent: ShellNotFoundError,
  })
  const broken = createRoute({
    getParentRoute: () => layout,
    path: '/broken',
    component: () => {
      throw new Error('render failed')
    },
  })
  const missing = createRoute({
    getParentRoute: () => layout,
    path: '/missing-record',
    component: () => {
      throw notFound()
    },
  })
  const router = createRouter({
    routeTree: root.addChildren([layout.addChildren([broken, missing])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

test('a page that crashes keeps the console sidebar and shows the error inside it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  await renderConsole('/broken')
  expect(
    screen.getByRole('navigation', { name: 'console sidebar' })
  ).toBeVisible()
  expect(screen.getByText(/Oops! Something went wrong/)).toBeVisible()
  expect(screen.queryByText('root error page')).not.toBeInTheDocument()
})

test('a console route that throws notFound shows the 404 inside the shell', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  await renderConsole('/missing-record')
  expect(
    await screen.findByRole('navigation', { name: 'console sidebar' })
  ).toBeVisible()
  expect(await screen.findByRole('heading', { name: '404' })).toBeVisible()
})

test('a signed-in user reports a problem through the in-app feedback page, not GitHub', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  await renderConsole('/broken')
  expect(
    screen.getByRole('button', { name: 'Report an issue' })
  ).toHaveAttribute('href', '/feedback')
  expect(document.body.innerHTML).not.toContain('github.com')
})

test('a signed-out visitor is pointed at the docs instead of the feedback inbox', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await renderConsole('/broken')
  expect(
    screen.getByRole('button', { name: 'Report an issue' })
  ).toHaveAttribute('href', '/docs')
})
