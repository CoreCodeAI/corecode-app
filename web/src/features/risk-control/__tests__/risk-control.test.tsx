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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { RiskControl } from '..'

const search: { tab?: 'violations' | 'audit' } = {}

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => search,
    useNavigate: () => vi.fn(),
  }),
}))

// One stable payload, as react-query hands back between refetches.
const OPTIONS = {
  data: {
    success: true,
    data: [
      { key: 'violation_guard_setting.lenient_categories', value: 'cyber' },
    ],
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}

vi.mock(
  '@/features/system-settings/hooks/use-system-options',
  async (orig) => ({
    ...(await orig<object>()),
    useSystemOptions: () => OPTIONS,
  })
)

vi.mock('@/features/system-settings/violation-guard/violation-records', () => ({
  ViolationRecords: () => <div>violation records</div>,
}))

vi.mock('@/features/system-settings/risk-gate/risk-gate-dashboard', () => ({
  RiskGateDashboard: () => <div>risk gate dashboard</div>,
}))

async function renderPage() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en },
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient()
  const tree = () => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <RiskControl />
      </I18nextProvider>
    </QueryClientProvider>
  )
  const view = render(tree())
  return { ...view, rerenderPage: () => view.rerender(tree()) }
}

beforeEach(() => {
  delete search.tab
})

afterEach(() => {
  cleanup()
})

it('shows the violation records with their settings folded away', async () => {
  await renderPage()

  expect(screen.getByText('violation records')).toBeTruthy()
  expect(screen.queryByText('risk gate dashboard')).toBeNull()
  expect(
    screen.queryByRole('button', { name: /Save violation settings/ })
  ).toBeNull()
})

it('opens the settings with the saved values and its own save button', async () => {
  const { rerenderPage } = await renderPage()

  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  const input = screen.getByLabelText('Warn-first categories')
  expect((input as HTMLInputElement).value).toBe('cyber')
  expect(
    screen.getByRole('button', { name: /Save violation settings/ })
  ).toBeTruthy()

  // An unsaved edit survives the page rendering again.
  await userEvent.type(input, ',jailbreak')
  rerenderPage()
  expect(
    (screen.getByLabelText('Warn-first categories') as HTMLInputElement).value
  ).toBe('cyber,jailbreak')
})

it('shows the risk audit on its tab', async () => {
  search.tab = 'audit'
  await renderPage()

  expect(screen.getByText('risk gate dashboard')).toBeTruthy()
  expect(screen.queryByText('violation records')).toBeNull()
  const tabs = screen.getByRole('tablist')
  expect(
    within(tabs)
      .getByRole('tab', { name: 'Risk audit' })
      .getAttribute('aria-selected')
  ).toBe('true')
})
