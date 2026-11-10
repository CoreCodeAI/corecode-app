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

const officialSecond = (
  per_second: number
): PricingModel['official_media_price'] => ({
  currency: 'CNY',
  per_second,
})

function videoModel(
  model_name: string,
  usd: number,
  official: PricingModel['official_media_price']
): PricingModel {
  return {
    ...secondTemplate,
    model_name,
    billing_expr: `tier("base", u("seconds") * ${usd})`,
    official_media_price: official,
    enable_groups: [VIDEO_GROUP],
  }
}

it('shows the official price per second and the saving on a video row', () => {
  renderBoard(
    [videoModel('seedance-2.5-480p', 0.48, officialSecond(0.67))],
    VIDEO_GROUP
  )

  const row = screen.getByRole('row', { name: /seedance-2\.5-480p/ })
  expect(within(row).getByText('¥0.48 / second')).toBeVisible()
  expect(within(row).getByText('Official ¥0.67 / second')).toHaveClass(
    'line-through'
  )
  expect(within(row).getByText('Save 28%')).toBeVisible()
})

it('shows no chip when the video is dearer than the official price', () => {
  renderBoard(
    [videoModel('wan-3.0-480p', 0.48, officialSecond(0.3))],
    VIDEO_GROUP
  )

  const row = screen.getByRole('row', { name: /wan-3\.0-480p/ })
  expect(within(row).getByText('Official ¥0.3 / second')).toBeVisible()
  expect(within(row).queryByText(/^Save/)).not.toBeInTheDocument()
})

it('converts a USD official image price and shows only the configured tiers', () => {
  const image: PricingModel = {
    ...imageModels[0],
    official_media_price: {
      currency: 'USD',
      per_image: { '1K': 0.0317, '2K': 0.0475 },
    },
  }
  renderBoard([image], IMAGE_GROUP)

  const row = screen.getByRole('row', { name: /gpt-image-2/ })
  expect(within(row).getByText('Official ¥0.2156')).toBeVisible()
  expect(within(row).getByText('Official ¥0.323')).toBeVisible()
  // 4K has no official figure, so it has no struck-through line.
  expect(within(row).getAllByText(/^Official/)).toHaveLength(2)
  expect(within(row).getByText('Save 81%')).toBeVisible()
})

it('takes the image chip from the 1K tier only', () => {
  const image: PricingModel = {
    ...imageModels[0],
    official_media_price: { currency: 'USD', per_image: { '2K': 0.0475 } },
  }
  renderBoard([image], IMAGE_GROUP)

  const row = screen.getByRole('row', { name: /gpt-image-2/ })
  expect(within(row).getAllByText(/^Official/)).toHaveLength(1)
  expect(within(row).queryByText(/^Save/)).not.toBeInTheDocument()
})

it('lists no official figure for a model without one', () => {
  const image: PricingModel = {
    ...imageModels[0],
    official_media_price: undefined,
  }
  renderBoard([image], IMAGE_GROUP)

  expect(screen.queryByText(/^Official/)).not.toBeInTheDocument()
  expect(screen.queryByText(/^Save/)).not.toBeInTheDocument()
})

it('shows a per-call video its official per-second price as a reference', () => {
  const fixed = {
    ...secondTemplate,
    id: 9,
    model_name: 'seedance-2.5-720p-fixed',
    quota_type: 1,
    model_price: 8.8,
    billing_mode: undefined,
    billing_expr: undefined,
    billing_usage_schema: undefined,
    official_media_price: officialSecond(1.51),
    enable_groups: [VIDEO_GROUP],
  } as unknown as PricingModel
  renderBoard([fixed], VIDEO_GROUP)

  const row = screen.getByRole('row', { name: /seedance-2\.5-720p-fixed/ })
  expect(within(row).getByText('¥8.8')).toBeVisible()
  const official = within(row).getByText('Official ¥1.51 / second')
  expect(official).toBeVisible()
  expect(official).not.toHaveClass('line-through')
  expect(within(row).queryByText(/^Save/)).not.toBeInTheDocument()
})

it('words the per-request footnote for images and video tasks', () => {
  const fixed = {
    ...secondTemplate,
    model_name: 'seedance-2.0-mini-720p-fixed',
    quota_type: 1,
    model_price: 2.4,
    billing_mode: undefined,
    billing_expr: undefined,
    billing_usage_schema: undefined,
    enable_groups: [VIDEO_GROUP],
  } as unknown as PricingModel
  renderBoard([fixed], VIDEO_GROUP)

  expect(
    screen.getByText(
      'Billed per request: each image counts once, and each video task counts once.'
    )
  ).toBeVisible()
})

it('hides the group discount for a media group and keeps it for a token group', () => {
  const token: PricingModel = {
    id: 20,
    model_name: 'claude-opus-5-5',
    quota_type: 0,
    model_ratio: 2,
    completion_ratio: 5,
    enable_groups: ['Claude'],
  }
  const video = videoModel('seedance-2.5-480p', 0.48, officialSecond(0.67))
  render(
    <PriceBoard
      models={[token, video]}
      groupRatio={{ Claude: 1, [VIDEO_GROUP]: 1 }}
      usableGroup={{ Claude: '', [VIDEO_GROUP]: '' }}
      priceRate={1}
      usdExchangeRate={6.8}
      search=''
      onSearchChange={vi.fn()}
      sort='input'
      onSortChange={vi.fn()}
      onModelClick={vi.fn()}
    />
  )

  const picker = screen.getByRole('radiogroup')
  const claude = within(picker).getByRole('radio', { name: /Claude/ })
  const seedance = within(picker).getByRole('radio', { name: /Seedance/ })
  expect(claude).toHaveTextContent('1.5 of official price')
  expect(claude).toHaveTextContent('About 1.5 of official price')
  expect(seedance).not.toHaveTextContent('official price')
})

it('shows no group discount for a lone media group', () => {
  renderBoard(
    [videoModel('seedance-2.5-480p', 0.48, officialSecond(0.67))],
    VIDEO_GROUP
  )

  expect(screen.queryByText(/of official price/)).not.toBeInTheDocument()
})
