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
import { render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import type { UsageLog } from '../../data/schema'
import { buildCostCheck } from '../../lib/cost-check'
import type { LogOtherData } from '../../types'
import { BillSummaryCard } from '../dialogs/bill-summary-card'

function request(fields: Partial<UsageLog>): UsageLog {
  return {
    id: 1,
    type: 2,
    model_name: 'claude-opus-5-5',
    quota: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    ...fields,
  } as UsageLog
}

const base: LogOtherData = {
  claude: true,
  model_ratio: 2,
  group_ratio: 1,
  completion_ratio: 5,
  cache_ratio: 0.1,
  cache_creation_ratio: 2,
  cache_creation_ratio_1h: 2,
  cache_creation_ratio_5m: 1.25,
}

function renderCard(
  log: UsageLog,
  other: LogOtherData,
  zeroOutput?: Parameters<typeof BillSummaryCard>[0]['zeroOutput']
) {
  const check = buildCostCheck(log, other)
  if (!check) throw new Error('fixture has no cost check')
  return render(
    <BillSummaryCard check={check} other={other} zeroOutput={zeroOutput} />
  )
}

describe('BillSummaryCard', () => {
  test('explains each part of a cached request and the 5-minute header', () => {
    const other = {
      ...base,
      cache_tokens: 80_000,
      cache_creation_tokens: 5000,
      cache_creation_tokens_1h: 5000,
    }
    renderCard(
      request({ prompt_tokens: 100, completion_tokens: 200, quota: 1 }),
      other
    )

    expect(screen.getByText('Why this price')).toBeVisible()
    expect(
      screen.getByText(
        /80K tokens hit the cache, billed at about 10% of the input price/
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        /5K tokens newly written to the cache \(1-hour cache\), billed at about 2× the input price/
      )
    ).toBeVisible()
    expect(screen.getByText(/200 output tokens/)).toBeVisible()
    expect(screen.getByText('X-CoreCode-Cache-TTL: 5m')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      '/docs/cache/#ttl'
    )
  })

  test('does not offer the 5-minute header to a request that already writes 5-minute caches', () => {
    renderCard(
      request({ prompt_tokens: 100, completion_tokens: 10, quota: 1 }),
      { ...base, cache_creation_tokens: 400, cache_creation_tokens_5m: 400 }
    )

    expect(screen.getByText(/\(5-minute cache\)/)).toBeVisible()
    expect(
      screen.queryByText('X-CoreCode-Cache-TTL: 5m')
    ).not.toBeInTheDocument()
  })

  test('says why there is no output fee, without a docs link, for the general case', () => {
    renderCard(request({ prompt_tokens: 100, quota: 1 }), base, {
      kind: 'general',
    })

    expect(screen.getByText(/no output means no output fee/)).toBeVisible()
    expect(screen.getByText('No output, so no output fee')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  test('names the refusal category and links the error docs', () => {
    renderCard(request({ prompt_tokens: 100, quota: 1 }), base, {
      kind: 'refusal',
      category: 'cybersecurity',
    })

    const message = screen.getByText(/Refused by Anthropic's safety policy/)
    expect(message).toHaveTextContent('category: cybersecurity')
    expect(message).toHaveTextContent(
      'still charges for the input and cache writes'
    )
    expect(
      within(message).getByRole('link', { name: 'Learn more' })
    ).toHaveAttribute('href', '/docs/errors/')
  })

  test('refuses without a category when the gateway recorded none', () => {
    renderCard(request({ prompt_tokens: 100, quota: 1 }), base, {
      kind: 'refusal',
      category: null,
    })

    expect(
      screen.getByText(/Refused by Anthropic's safety policy/)
    ).not.toHaveTextContent('category')
  })
})
