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
import { Suspense } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { getLobeIcon } from '@/lib/lobe-icon'

import { PriceBoard } from '../components/price-board'
import { getExpressionPrice } from '../lib/board-rows'
import { groupVendor, modelVendor } from '../lib/group-vendors'
import type { PricingModel } from '../types'
import fixtures from './fixtures-media.json'

const IMAGE_GROUP = 'GPT生图1-4K'
const VIDEO_GROUP = 'Seedance视频'
const imageTemplate = fixtures.image as unknown as PricingModel
const secondTemplate = fixtures.second as unknown as PricingModel

const imageModels = [
  'gpt-image-2',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.6-flare',
  'gpt-image-2.6-sunburst',
].map((model_name, id): PricingModel => ({
  ...imageTemplate,
  id,
  model_name,
  enable_groups: [IMAGE_GROUP],
}))

afterEach(cleanup)

function renderBoard(
  models: PricingModel[],
  group: string,
  onModelClick = vi.fn()
) {
  render(
    <PriceBoard
      models={models}
      groupRatio={{ [group]: 1 }}
      usableGroup={{ [group]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      search=''
      onSearchChange={vi.fn()}
      sort='input'
      onSortChange={vi.fn()}
      onModelClick={onModelClick}
    />
  )
  return onModelClick
}

it('lists every size-tiered image model with its 1K, 2K and 4K prices', () => {
  renderBoard(imageModels, IMAGE_GROUP)

  expect(
    screen.queryByText('No models match your search.')
  ).not.toBeInTheDocument()
  const table = screen.getByRole('table', { name: 'Priced by usage' })
  for (const model of imageModels) {
    const row = within(table)
      .getByRole('button', { name: model.model_name })
      .closest('tr')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('1K ¥0.04')
    expect(row).toHaveTextContent('2K ¥0.08')
    expect(row).toHaveTextContent('4K ¥0.12')
  }
  // The stale model_price is not what the server charges.
  expect(screen.queryByText(/0\.075/)).not.toBeInTheDocument()
})

it('lists a per-second video model with its price per second', () => {
  const video = {
    ...secondTemplate,
    model_name: 'seedance-2.5-480p',
    enable_groups: [VIDEO_GROUP],
  }
  const perRequest = {
    ...secondTemplate,
    id: 9,
    model_name: 'seedance-2.5-720p-fixed',
    quota_type: 1,
    model_price: 8.8,
    billing_mode: undefined,
    billing_expr: undefined,
    billing_usage_schema: undefined,
    enable_groups: [VIDEO_GROUP],
  } as unknown as PricingModel
  renderBoard([video, perRequest], VIDEO_GROUP)

  const row = screen.getByRole('row', { name: /seedance-2\.5-480p/ })
  expect(row).toHaveTextContent('¥0.48 / second')
  expect(screen.getByText('¥8.8')).toBeVisible()
})

it('links an expression it cannot summarise to its details', async () => {
  const odd: PricingModel = {
    ...imageTemplate,
    model_name: 'odd-model',
    billing_expr:
      'tier("image", fixed(0.5)) * image_count * (param("quality") == "hd" ? 2 : 1)',
    enable_groups: [IMAGE_GROUP],
  }
  const onModelClick = renderBoard([odd], IMAGE_GROUP)

  expect(getExpressionPrice(odd)).toBeNull()
  expect(screen.queryByText(/0\.075/)).not.toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'See pricing details' }))
  expect(onModelClick).toHaveBeenCalledWith('odd-model')
})

it('reads the per-second and per-size prices from the expressions', () => {
  expect(getExpressionPrice(secondTemplate)).toEqual({
    kind: 'second',
    usd: 0.48,
  })
  const image = getExpressionPrice(imageTemplate)
  expect(image?.kind).toBe('image')
  expect(image?.kind === 'image' && image.tiers.map((t) => t.usd)).toEqual([
    0.04, 0.08, 0.12,
  ])
})

it('infers ByteDance and Wan vendors from the model name', () => {
  const named = (model_name: string, group: string) =>
    ({ id: 0, model_name, enable_groups: [group] }) as PricingModel
  expect(modelVendor(named('seedance-2.5-720p', 'a'))).toEqual({
    name: 'ByteDance',
    icon: 'ByteDance.Color',
  })
  expect(modelVendor(named('wan-3.0-prime-1080p', 'a'))).toEqual({
    name: 'Wan',
    icon: 'Wan',
  })
  expect(modelVendor(named('wandb-sweep', 'a'))).toBeNull()
  expect(modelVendor(named('wan3.0-video', 'a'))).toBeNull()
  expect(
    groupVendor([named('seedance-2.5-480p', VIDEO_GROUP)], VIDEO_GROUP)?.icon
  ).toBe('ByteDance.Color')
  expect(groupVendor([named('wan-3.0-480p', 'WAN3.0')], 'WAN3.0')?.icon).toBe(
    'Wan'
  )
})

it('renders both vendor icons instead of the letter fallback', async () => {
  render(
    <Suspense fallback={null}>
      <div data-testid='icons'>
        {getLobeIcon('ByteDance.Color', 16)}
        {getLobeIcon('Wan', 16)}
      </div>
    </Suspense>
  )
  const icons = await screen.findByTestId('icons')
  // ByteDance is a lazy SVG, Wan a bundled image; the letter fallback is neither.
  await vi.waitFor(() => expect(icons.querySelectorAll('svg')).toHaveLength(1))
  expect(icons.querySelectorAll('img')).toHaveLength(1)
  expect(icons.querySelector('div.bg-muted')).toBeNull()
})
