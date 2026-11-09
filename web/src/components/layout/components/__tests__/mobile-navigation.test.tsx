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
import { afterEach, expect, test, vi } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth-store'

import { AppHeader } from '../app-header'
import { PublicHeader } from '../public-header'

const LINKS = [
  { title: 'Pricing', href: '/pricing' },
  { title: 'Docs', href: '/docs' },
]

vi.mock('@/hooks/use-top-nav-links', () => ({
  useTopNavLinks: () => LINKS,
}))
vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => ({
    popoverOpen: false,
    setPopoverOpen: () => undefined,
    unreadCount: 0,
    activeTab: 'notice',
    setActiveTab: () => undefined,
    notice: '',
    announcements: [],
    loading: false,
  }),
}))
vi.mock('@/hooks/use-system-config', () => ({
  useSystemConfig: () => ({
    systemName: 'CoreCode',
    logo: '',
    loading: false,
    logoLoaded: true,
  }),
}))
vi.mock('@/components/notification-popover', () => ({
  NotificationPopover: () => null,
}))
vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => null,
}))
vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => null,
}))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/features/system-update/system-update-action', () => ({
  SystemUpdateAction: () => null,
}))
vi.mock('../system-brand', () => ({ SystemBrand: () => null }))

afterEach(() => {
  useAuthStore.getState().auth.reset()
})

async function renderWithRouter(element: React.ReactElement) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <SidebarProvider>{element}</SidebarProvider>,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

function menuFor(toggle: HTMLElement) {
  return document.querySelector(`#${toggle.getAttribute('aria-controls')}`)
}

function hiddenWithoutBreakpoint(element: HTMLElement) {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (node.classList.contains('hidden')) return true
  }
  return false
}

test('the console header offers a labelled menu button that is not hidden below the lg breakpoint', async () => {
  await renderWithRouter(<AppHeader />)
  const menu = screen.getByRole('button', { name: 'Open menu' })
  expect(hiddenWithoutBreakpoint(menu)).toBe(false)
  expect(menu).toHaveAttribute('aria-expanded', 'false')
})

test('opening the console header menu reveals the top-nav links and flips aria-expanded', async () => {
  const user = userEvent.setup()
  await renderWithRouter(<AppHeader />)
  const menu = screen.getByRole('button', { name: 'Open menu' })
  await user.click(menu)
  expect(menu).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findByRole('menuitem', { name: 'Pricing' })).toBeVisible()
})

test('the public mobile menu is inert while closed and exposes its state on the button', async () => {
  await renderWithRouter(<PublicHeader />)
  const toggle = screen.getByRole('button', { name: 'Toggle navigation menu' })
  const menu = menuFor(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(menu).toHaveAttribute('inert')
})

test('opening the public mobile menu makes it interactive and Escape closes it again', async () => {
  const user = userEvent.setup()
  await renderWithRouter(<PublicHeader />)
  const toggle = screen.getByRole('button', { name: 'Toggle navigation menu' })
  const menu = menuFor(toggle)
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(menu).not.toHaveAttribute('inert')
  await user.keyboard('{Escape}')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(menu).toHaveAttribute('inert')
})
