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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { PriceBoard } from '../components/price-board'
import type { PricingModel } from '../types'

const GROUP = 'Claude 满血'

const opus: PricingModel = {
  id: 1,
  model_name: 'claude-opus-5-5',
  quota_type: 0,
  model_ratio: 2,
  completion_ratio: 5,
  cache_ratio: 0.05,
  create_cache_ratio: 1.25,
  enable_groups: [GROUP],
  group_ratio: { [GROUP]: 1.5 },
}

afterEach(cleanup)

function boardControls() {
  return {
    search: '',
    onSearchChange: vi.fn(),
    sort: 'input' as const,
    onSortChange: vi.fn(),
  }
}

function renderBoard(price: number, rate: number, onModelClick = vi.fn()) {
  render(
    <PriceBoard
      models={[opus]}
      groupRatio={{ [GROUP]: 1.5 }}
      usableGroup={{ [GROUP]: '仅限 Claude Code CLI 使用' }}
      priceRate={price}
      usdExchangeRate={rate}
      {...boardControls()}
      onModelClick={onModelClick}
    />
  )
  return onModelClick
}

function desktopRow() {
  const table = screen.getByRole('table')
  return within(table).getByRole('row', { name: /claude-opus-5-5/ })
}

it('lists group prices in CNY against the struck official price', () => {
  renderBoard(1, 6.8)

  const row = desktopRow()
  expect(within(row).getByText('¥6')).toBeVisible()
  expect(within(row).getByText('Official ¥27.2')).toBeVisible()
  expect(within(row).getByText('Save 78%')).toBeVisible()
  expect(screen.getByText('仅限 Claude Code CLI 使用')).toBeVisible()
})

it('shows a lone group without a picker or its ratio', () => {
  renderBoard(1, 6.8)

  expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
  expect(screen.getByText(GROUP)).toBeVisible()
  expect(screen.getByText('2.2 of official price')).toBeVisible()
  expect(screen.queryByText(/ratio/)).not.toBeInTheDocument()
})

it('lets the customer pick between several groups', async () => {
  const cheap = 'Claude 特价'
  render(
    <PriceBoard
      models={[{ ...opus, enable_groups: [GROUP, cheap] }]}
      groupRatio={{ [GROUP]: 1.5, [cheap]: 1 }}
      usableGroup={{ [GROUP]: '', [cheap]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  const cheapRadio = screen.getByRole('radio', { name: new RegExp(cheap) })
  expect(cheapRadio).toHaveAttribute('aria-checked', 'true')
  expect(within(desktopRow()).getByText('¥4')).toBeVisible()

  await userEvent
    .setup()
    .click(screen.getByRole('radio', { name: new RegExp(GROUP) }))
  expect(within(desktopRow()).getByText('¥6')).toBeVisible()
})

it('claims no saving when the group price is above the official price', () => {
  renderBoard(7.3, 7.3)
  expect(within(desktopRow()).queryByText(/Save/)).not.toBeInTheDocument()
})

it('opens the model details from the model name', async () => {
  const onModelClick = renderBoard(1, 6.8)
  await userEvent.setup().click(
    within(screen.getByRole('table')).getByRole('button', {
      name: 'claude-opus-5-5',
    })
  )
  expect(onModelClick).toHaveBeenCalledWith('claude-opus-5-5')
})

it('lists models from cheapest to most expensive', () => {
  render(
    <PriceBoard
      models={[
        opus,
        { ...opus, id: 2, model_name: 'claude-haiku-5-5', model_ratio: 0.1 },
        { ...opus, id: 3, model_name: 'claude-fable-5-1', model_ratio: 5 },
      ]}
      groupRatio={{ [GROUP]: 1.5 }}
      usableGroup={{ [GROUP]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  const names = within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0].textContent)
  expect(names).toEqual([
    'claude-haiku-5-5',
    'claude-opus-5-5',
    'claude-fable-5-1',
  ])
})

it('puts Claude first and selects it even when another pool is cheaper', () => {
  const gpt: PricingModel = {
    ...opus,
    id: 9,
    model_name: 'gpt-6-luna',
    enable_groups: ['GPT'],
  }
  render(
    <PriceBoard
      models={[opus, gpt]}
      groupRatio={{ [GROUP]: 1.9, GPT: 0.8 }}
      usableGroup={{ [GROUP]: '仅限 Claude Code CLI 使用', GPT: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  const radios = screen.getAllByRole('radio')
  expect(radios[0]).toHaveAccessibleName(new RegExp(GROUP))
  expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  expect(within(radios[0]).getByText('Claude Code')).toBeVisible()
  expect(screen.getByText('Claude, made for Claude Code')).toBeVisible()
  expect(screen.getByText('More models')).toBeVisible()
})

it('shows a marked-up model at its official price and explains its saving', async () => {
  const fable: PricingModel = {
    ...opus,
    id: 3,
    model_name: 'claude-fable-5-1',
    model_ratio: 7.5,
    cache_ratio: 0.025,
    official_price_markup: 1.5,
  }
  render(
    <PriceBoard
      models={[opus, fable]}
      groupRatio={{ [GROUP]: 1.5 }}
      usableGroup={{ [GROUP]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  const row = within(screen.getByRole('table')).getByRole('row', {
    name: /claude-fable-5-1/,
  })
  expect(within(row).getByText('¥22.5')).toBeVisible()
  expect(within(row).getByText('Official ¥68')).toBeVisible()
  const saving = within(row).getByRole('button', { name: /Save 67%/ })
  expect(within(desktopRow()).getByText('Save 78%')).toBeVisible()

  const user = userEvent.setup()
  await user.hover(saving)
  expect(await screen.findByText(MARKUP_HELP)).toBeInTheDocument()
  await user.unhover(saving)
  await waitFor(() => expect(screen.queryByText(MARKUP_HELP)).toBeNull())

  // A click, and a tap on a touch screen, opens it too, and it stays open
  // after the pointer leaves until the reader dismisses it.
  await user.click(saving)
  expect(await screen.findByText(MARKUP_HELP)).toBeInTheDocument()
  await user.unhover(saving)
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(screen.getByText(MARKUP_HELP)).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText(MARKUP_HELP)).toBeNull())
})

const MARKUP_HELP =
  'This model costs more to serve, so it is priced at 1.5× the official price before the group discount.'

const imageModel: PricingModel = {
  id: 3,
  model_name: 'gpt-image-2',
  quota_type: 1,
  model_ratio: 0,
  model_price: 0.075,
  completion_ratio: 0,
  enable_groups: ['GPT'],
}

it('lists a per-request model apart, at its price per request in the group', () => {
  const chat: PricingModel = {
    ...opus,
    model_name: 'gpt-6-sol',
    enable_groups: ['GPT'],
  }
  render(
    <PriceBoard
      models={[chat, imageModel]}
      groupRatio={{ GPT: 0.8 }}
      usableGroup={{ GPT: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  const perRequest = screen.getByRole('table', { name: 'Per-request' })
  const row = within(perRequest).getByRole('row', { name: /gpt-image-2/ })
  // 0.075 × 0.8 × ¥1, with no official price beside it.
  expect(within(row).getByText('¥0.06')).toBeVisible()
  expect(within(row).queryByText(/Official/)).toBeNull()
  expect(within(perRequest).queryByText('gpt-6-sol')).toBeNull()

  const [tokenTable] = screen.getAllByRole('table')
  expect(tokenTable).not.toBe(perRequest)
  expect(within(tokenTable).getByText('gpt-6-sol')).toBeInTheDocument()
  expect(within(tokenTable).queryByText('gpt-image-2')).toBeNull()
})

it('shows only the per-request table for a group of per-request models', () => {
  render(
    <PriceBoard
      models={[
        {
          ...imageModel,
          model_name: 'grok-imagine-image',
          model_price: 0.05,
          enable_groups: ['Grok'],
        },
      ]}
      groupRatio={{ Grok: 1.2 }}
      usableGroup={{ Grok: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      {...boardControls()}
      onModelClick={vi.fn()}
    />
  )

  expect(screen.getAllByRole('table')).toHaveLength(1)
  const row = within(
    screen.getByRole('table', { name: 'Per-request' })
  ).getByRole('row', { name: /grok-imagine-image/ })
  expect(within(row).getByText('¥0.06')).toBeVisible()
  expect(screen.queryByText('Input price')).toBeNull()
})
