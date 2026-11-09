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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { NotFoundError } from '../not-found-error'

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

async function renderNotFound(embedded: boolean) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <NotFoundError embedded={embedded} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  return router
}

test('inside the console shell the 404 page fills the content area instead of the viewport', async () => {
  await renderNotFound(true)
  const page = screen
    .getByRole('heading', { name: '404' })
    .closest('div.h-full')
  expect(page).not.toBeNull()
  expect(document.querySelector('.h-svh')).toBeNull()
})

test('a signed-in user returns to the dashboard from the 404 page', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'alice', role: 1 })
  const router = await renderNotFound(true)
  await userEvent.click(screen.getByRole('button', { name: 'Back to Home' }))
  expect(router.state.location.pathname).toBe('/dashboard')
})
