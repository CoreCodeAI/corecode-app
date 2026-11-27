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

import { BillingExplainer } from '../components/billing-explainer'
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

async function open() {
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'How billing works' }))
}

it('shows a markup when recharging at the exchange rate', async () => {
  render(
    <BillingExplainer models={[sonnet]} priceRate={7.3} usdExchangeRate={7.3} />
  )
  await open()

  expect(screen.getByText('7.3 ÷ 7.3')).toBeVisible()
  expect(screen.getByText('× 1.5')).toBeVisible()
  expect(screen.getByText('$3/M')).toBeVisible()
  expect(screen.getByText('1.5× official price')).toBeVisible()
})

it('shows the discount a cheaper recharge earns', async () => {
  render(
    <BillingExplainer
      models={[{ ...sonnet, group_ratio: { default: 2.5 } }]}
      priceRate={1}
      usdExchangeRate={6.9}
    />
  )
  await open()

  expect(screen.getByText('≈ 0.145')).toBeVisible()
  expect(screen.getByText('3.6 of official price')).toBeVisible()
})

it('explains a CNY-listed model as undoing the dollar conversion, not a surcharge', async () => {
  const deepseek: PricingModel = {
    ...sonnet,
    model_name: 'deepseek-v4.1-flash',
    completion_ratio: 4,
    cache_ratio: 0.02,
    enable_groups: ['DeepSeek'],
    group_ratio: { DeepSeek: 0.6 },
    official_price_markup: 6.8,
  }
  render(
    <BillingExplainer models={[deepseek]} priceRate={1} usdExchangeRate={6.8} />
  )
  await open()

  expect(screen.getByText('Official CNY price')).toBeVisible()
  expect(screen.getByText('× 6.8')).toBeVisible()
  expect(
    screen.getByText(
      "This model's official price is the vendor's own CNY list price, so this step undoes the dollar conversion."
    )
  ).toBeVisible()
  expect(screen.queryByText('Model markup')).toBeNull()
  expect(screen.getByText('6 of official price')).toBeVisible()
})

it('keeps the surcharge explanation for a marked-up model', async () => {
  render(
    <BillingExplainer
      models={[{ ...sonnet, official_price_markup: 1.5 }]}
      priceRate={1}
      usdExchangeRate={6.8}
    />
  )
  await open()

  expect(screen.getByText('Model markup')).toBeVisible()
  expect(
    screen.getByText(
      'This model costs more to serve, so it is priced at 1.5× the official price before the group discount.'
    )
  ).toBeVisible()
})
