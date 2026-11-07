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
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'

import { RiskControl } from '..'

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

afterEach(() => {
  cleanup()
})

it('shows the risk audit and the violation records on one page, settings folded', async () => {
  await renderPage()

  expect(screen.getByText('risk gate dashboard')).toBeTruthy()
  expect(screen.getByText('violation records')).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
})

it('opens each settings panel with the saved values and its own save button', async () => {
  const { rerenderPage } = await renderPage()

  await userEvent.click(
    screen.getByRole('button', { name: 'Usage policy violations · Settings' })
  )
  const input = screen.getByLabelText('Warn-first categories')
  expect((input as HTMLInputElement).value).toBe('cyber')
  const panel = input.closest('[data-slot=collapsible]') as HTMLElement
  expect(
    within(panel).getByRole('button', { name: /Save violation settings/ })
  ).toBeTruthy()

  // An unsaved edit survives the page rendering again.
  await userEvent.type(input, ',jailbreak')
  rerenderPage()
  expect(
    (screen.getByLabelText('Warn-first categories') as HTMLInputElement).value
  ).toBe('cyber,jailbreak')

  await userEvent.click(
    screen.getByRole('button', { name: 'Risk audit · Settings' })
  )
  expect(screen.getAllByRole('button', { name: /^Save/ })).toHaveLength(2)
})
