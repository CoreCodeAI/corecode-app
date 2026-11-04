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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ClaudeCodeEstimator } from '../components/claude-code-estimator'
import type { PricingModel } from '../types'

const sonnet: PricingModel = {
  id: 1,
  model_name: 'claude-sonnet-5-5',
  quota_type: 0,
  model_ratio: 1,
  completion_ratio: 5,
  cache_ratio: 0.05,
  create_cache_ratio: 1.25,
  enable_groups: ['default'],
  group_ratio: { default: 1.5 },
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
})

afterEach(() => {
  cleanup()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

function amount(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent
}

it('estimates the default Claude Code workload in CNY per turn, day and month', () => {
  render(<ClaudeCodeEstimator models={[sonnet]} priceRate={2} />)

  expect(amount('Per turn')).toBe('¥0.1062')
  expect(amount('Per day')).toBe('¥21.24')
  expect(amount('Per 30 days')).toBe('¥637.2')
  expect(screen.getByText(/The cache saves/)).toHaveTextContent('74%')
})

it('recomputes when the customer changes the workload', async () => {
  const user = userEvent.setup()
  render(<ClaudeCodeEstimator models={[sonnet]} priceRate={2} />)

  const turns = screen.getByLabelText('Turns per day')
  await user.clear(turns)
  await user.type(turns, '100')

  expect(amount('Per day')).toBe('¥10.62')
})

it('offers a model picker only when there is more than one model', () => {
  const { rerender } = render(
    <ClaudeCodeEstimator models={[sonnet]} priceRate={2} />
  )
  expect(
    screen.queryByRole('combobox', { name: 'Model' })
  ).not.toBeInTheDocument()

  rerender(
    <ClaudeCodeEstimator
      models={[sonnet, { ...sonnet, id: 2, model_name: 'claude-opus-5-5' }]}
      priceRate={2}
    />
  )
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
    'claude-sonnet-5-5'
  )
})

it('names the tier a context-priced model bills the workload at', async () => {
  const user = userEvent.setup()
  render(
    <ClaudeCodeEstimator
      models={[
        {
          ...sonnet,
          billing_mode: 'tiered_expr',
          billing_expr:
            'len <= 100000 ? tier("standard", p * 0.1 + c * 0.5 + cr * 0.01 + cc * 0.125) : tier("long_context", p * 0.5 + c * 2.5 + cr * 0.05 + cc * 0.625)',
        },
      ]}
      priceRate={2}
    />
  )
  expect(screen.getByText(/billed at the Standard tier/)).toBeVisible()

  const context = screen.getByLabelText('Context per turn (tokens)')
  await user.clear(context)
  await user.type(context, '150000')

  expect(screen.getByText(/billed at the Long context tier/)).toBeVisible()
})

it('renders nothing for a model priced per request', () => {
  const { container } = render(
    <ClaudeCodeEstimator
      models={[{ ...sonnet, quota_type: 1 }]}
      priceRate={2}
    />
  )
  expect(container).toBeEmptyDOMElement()
})

it('offers only Claude models, not other pools or aliases into them', () => {
  render(
    <ClaudeCodeEstimator
      models={[
        {
          ...sonnet,
          id: 2,
          model_name: 'gemini/claude-sonnet-5-5-high',
          model_ratio: 0.1,
        },
        { ...sonnet, id: 3, model_name: 'gpt-6-luna', model_ratio: 0.05 },
        sonnet,
      ]}
      priceRate={2}
    />
  )

  expect(
    screen.queryByRole('combobox', { name: 'Model' })
  ).not.toBeInTheDocument()
  expect(amount('Per turn')).toBe('¥0.1062')
})
