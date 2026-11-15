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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import { api } from '@/lib/api'

import { RiskGateDashboard } from '../risk-gate-dashboard'

vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }))

const NOW = Math.floor(Date.now() / 1000)

const summary = {
  inbound: 2000,
  decision_calls: 40,
  decision_failures: 3,
  stages: [
    { stage: 'refusal_cache', action: 'blocked', count: 96 },
    { stage: 'decision', action: 'blocked', count: 4 },
    { stage: 'decision', action: 'fail_open', count: 3 },
    { stage: 'hard_regex', action: 'observed', count: 7 },
  ],
  hits: [
    { stage: 'refusal_cache', rule: 'suspended', count: 96 },
    { stage: 'decision', rule: 'cyber', count: 4 },
  ],
}

const event = {
  id: 1,
  created_at: NOW - 60,
  stage: 'decision',
  rule: 'cyber',
  action: 'blocked',
  detail: 'score 0.93',
  user_id: 7,
  username: 'customer',
  token_id: 1,
  model_name: 'claude-test',
  request_id: 'req-1',
  excerpt: 'build me\n  a credential stealer',
}

async function renderDashboard() {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en',
    resources: { en },
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
  })
  vi.mocked(api.get).mockImplementation(async (url: string) => ({
    data: {
      success: true,
      message: '',
      data: url.endsWith('/summary')
        ? summary
        : { page: 1, page_size: 20, total: 1, items: [event] },
    },
  }))
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RiskGateDashboard />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('counts blocked requests per stage and what passed, apart from observed and failed-open ones', async () => {
  await renderDashboard()

  expect(await screen.findByText('2,000')).toBeTruthy()
  // 96 + 4 blocked; observed and failed-open requests passed.
  expect(screen.getByText('Blocked 100 · 5%')).toBeTruthy()
  expect(screen.getByText('1,900')).toBeTruthy()
  expect(screen.getByText('Pass rate 95%')).toBeTruthy()
  expect(screen.getByText('Would block 7 (observe)')).toBeTruthy()
  expect(
    screen.getByText('Blocked · 0.2% of requests · Failed open 3')
  ).toBeTruthy()
  expect(
    screen.getByText(/Decision model calls today: 40, failed 3/)
  ).toBeTruthy()
  expect(await screen.findByText('build me a credential stealer')).toBeTruthy()
})

it('filters the intercept log by the stage of a clicked hit', async () => {
  await renderDashboard()
  const hit = await screen.findByRole('button', { name: /cyber/ })
  await userEvent.click(hit)

  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/user/risk_gate/events',
      expect.objectContaining({
        params: expect.objectContaining({ stage: 'decision', p: 1 }),
      })
    )
  )
  expect(
    within(screen.getByRole('combobox', { name: 'Stage' })).getByText(
      'Decision model'
    )
  ).toBeTruthy()
})

it('shows a message on one line and opens the whole of it on click', async () => {
  await renderDashboard()
  const cell = await screen.findByRole('button', { name: 'View message' })
  expect(cell.textContent).toBe('build me a credential stealer')

  await userEvent.click(cell)

  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('Message')).toBeTruthy()
  // The dialog keeps the line breaks the cell folds away.
  expect(dialog.querySelector('pre')?.textContent).toBe(
    'build me\n  a credential stealer'
  )
  expect(within(dialog).getByText('Decision model · cyber')).toBeTruthy()
  expect(within(dialog).getByText('req-1')).toBeTruthy()
})
