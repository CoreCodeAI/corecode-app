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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { PriceBoard } from '../components/price-board'
import type { BoardSort } from '../lib/board-rows'
import type { PricingModel } from '../types'

const GROUP = 'Claude 满血'
const CHEAP = 'Claude 特价'

function claude(
  id: number,
  name: string,
  modelRatio: number,
  completionRatio: number
): PricingModel {
  return {
    id,
    model_name: name,
    quota_type: 0,
    model_ratio: modelRatio,
    completion_ratio: completionRatio,
    cache_ratio: 0.1,
    create_cache_ratio: 1.25,
    enable_groups: [GROUP, CHEAP],
  }
}

// Input prices: haiku 1, sonnet 3, opus 5. Output prices: sonnet 6, opus 10, haiku 20.
const models = [
  claude(1, 'claude-opus-5-5', 2.5, 2),
  claude(2, 'claude-haiku-5', 0.5, 20),
  claude(3, 'claude-sonnet-5', 1.5, 2),
]

afterEach(cleanup)

function renderBoard(
  sort: BoardSort = 'input',
  onSearchChange = vi.fn(),
  boardModels = models
) {
  render(
    <PriceBoard
      models={boardModels}
      groupRatio={{ [GROUP]: 1.5, [CHEAP]: 1 }}
      usableGroup={{ [GROUP]: '', [CHEAP]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      search=''
      onSearchChange={onSearchChange}
      sort={sort}
      onSortChange={vi.fn()}
      onModelClick={vi.fn()}
    />
  )
  return onSearchChange
}

function listedModels() {
  const table = screen.getAllByRole('table')[0]
  return within(table)
    .getAllByRole('rowheader')
    .map(
      (cell) =>
        within(cell).getByRole('button', { name: /^claude/ }).textContent
    )
}

it('filters the rows as the customer types and reports the text', async () => {
  const onSearchChange = renderBoard()
  await userEvent
    .setup()
    .type(screen.getByRole('searchbox', { name: 'Search models' }), 'sonn')

  expect(listedModels()).toEqual(['claude-sonnet-5'])
  expect(onSearchChange).toHaveBeenLastCalledWith('sonn')
})

it('says so when no model matches', async () => {
  renderBoard()
  await userEvent
    .setup()
    .type(screen.getByRole('searchbox', { name: 'Search models' }), 'gpt')

  expect(screen.getByText('No models match your search.')).toBeVisible()
})

it('sorts by input price, cheapest first, by default', () => {
  renderBoard('input')
  expect(listedModels()).toEqual([
    'claude-haiku-5',
    'claude-sonnet-5',
    'claude-opus-5-5',
  ])
})

it('sorts by output price when asked', () => {
  renderBoard('output')
  expect(listedModels()).toEqual([
    'claude-sonnet-5',
    'claude-opus-5-5',
    'claude-haiku-5',
  ])
})

it('sorts the biggest savings first, and a marked-up model last', () => {
  renderBoard(
    'savings',
    vi.fn(),
    models.map((model) =>
      model.model_name === 'claude-haiku-5'
        ? { ...model, official_price_markup: 2 }
        : model
    )
  )
  expect(listedModels()).toEqual([
    'claude-sonnet-5',
    'claude-opus-5-5',
    'claude-haiku-5',
  ])
})

it('offers the group as a compact select below the md breakpoint', async () => {
  renderBoard()
  const select = screen.getByRole('combobox', { name: 'Group' })
  expect(select.closest('.md\\:hidden')).not.toBeNull()
  // The radio cards stay for wide screens only.
  expect(screen.getByRole('radiogroup', { name: 'Group' })).toHaveClass(
    'hidden',
    'md:flex'
  )

  await userEvent.setup().click(select)
  await userEvent
    .setup()
    .click(await screen.findByRole('option', { name: /Claude 满血/ }))
  expect(screen.getByRole('combobox', { name: 'Group' })).toHaveTextContent(
    GROUP
  )
})

it('moves the pricing rules below the prices on a phone', () => {
  renderBoard()
  const rules = screen.getByText('Pricing rules').closest('section')
  expect(rules).toHaveClass('order-last', 'md:order-none')
})

it('explains the cache columns', () => {
  renderBoard()
  const table = screen.getAllByRole('table')[0]
  expect(
    within(table).getByRole('button', { name: /^Cache Creation: Cache write:/ })
  ).toBeInTheDocument()
  expect(
    within(table).getByRole('button', { name: /^Cache Read: Cache read:/ })
  ).toBeInTheDocument()
})
