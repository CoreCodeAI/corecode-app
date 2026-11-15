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
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ActivityInsights, APIKeyUsage, KeyInsights } from '../../types'
import { ActivityTab } from '../growth-tab'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

// new-api's charge is in yuan; at ¥8 a dollar, ¥20 is $2.50.
const activity: ActivityInsights = {
  active_users: 2,
  quota_usd: 30,
  usd_exchange_rate: 8,
  requests: 300,
  engine_cost: { configured: false, cost_usd: 0, requests: 0, daily: [] },
  daily: [],
  retention: [],
  top_users: [],
  top1_share: 0,
  top3_share: 0,
  top10_share: 0,
}

function key(overrides: Partial<APIKeyUsage>): APIKeyUsage {
  return {
    token_id: 7,
    token_name: 'alice-app',
    owner: { user_id: 3, username: 'alice' },
    requests: 250,
    failed_requests: 10,
    client_failures: 2,
    service_failure_rate: 0.032,
    quota_usd: 20,
    share: 0.6667,
    top_models: [
      { model: 'gpt-6', requests: 200, quota_usd: 15 },
      { model: 'claude-opus-5', requests: 50, quota_usd: 5 },
    ],
    ...overrides,
  }
}

function keys(overrides: Partial<KeyInsights> = {}): KeyInsights {
  return {
    requests: 300,
    failed_requests: 18,
    client_failures: 2,
    service_failure_rate: 0.0533,
    quota_usd: 30,
    active_keys: 2,
    keys: [
      key({}),
      key({
        token_id: 9,
        token_name: 'bob-bot',
        owner: { user_id: 4, username: 'bob' },
        requests: 40,
        failed_requests: 8,
        client_failures: 0,
        service_failure_rate: 0.2,
        quota_usd: 8,
        share: 0.2667,
        top_models: [{ model: 'gpt-6', requests: 40, quota_usd: 8 }],
      }),
      key({
        token_id: 0,
        token_name: '',
        owner: { user_id: 0, username: '' },
        requests: 10,
        failed_requests: 0,
        client_failures: 0,
        service_failure_rate: 0,
        quota_usd: 2,
        share: 0.0667,
        top_models: [{ model: 'gpt-6', requests: 10, quota_usd: 2 }],
      }),
    ],
    staff_requests: 0,
    staff_quota_usd: 0,
    staff_keys: [],
    stale_hours: 0,
    ...overrides,
  }
}

const ready = { status: 'success' as const }

describe('the API keys panel', () => {
  it('lists each key with its owner, requests, spend and top models', () => {
    render(
      <ActivityTab
        data={activity}
        keys={keys()}
        sources={{ view: ready, previous: ready, keys: ready }}
      />
    )
    const alice = screen.getByRole('row', { name: /alice-app/ })
    expect(within(alice).getByText('alice')).toBeInTheDocument()
    expect(within(alice).getByText('250')).toBeInTheDocument()
    expect(within(alice).getByText(/\$2\.50/)).toBeInTheDocument()
    expect(within(alice).getByText('66.7%')).toBeInTheDocument()
    expect(within(alice).getByText('gpt-6, claude-opus-5')).toBeInTheDocument()
    expect(
      within(screen.getByRole('row', { name: /No API key/ })).getByText('10')
    ).toBeInTheDocument()
  })

  it('fades a key with fewer than 100 requests and colours a high failure rate', () => {
    render(
      <ActivityTab
        data={activity}
        keys={keys()}
        sources={{ view: ready, previous: ready, keys: ready }}
      />
    )
    const bob = screen.getByRole('row', { name: /bob-bot/ })
    expect(bob).toHaveClass('text-muted-foreground')
    expect(within(bob).getByText('20%')).not.toHaveClass('text-destructive')
    const alice = screen.getByRole('row', { name: /alice-app/ })
    expect(alice).not.toHaveClass('text-muted-foreground')
    expect(within(alice).getByText('3.2%')).toHaveClass('text-amber-600')
  })

  it('names the largest key and its share in the description', () => {
    render(
      <ActivityTab
        data={activity}
        keys={keys()}
        sources={{ view: ready, previous: ready, keys: ready }}
      />
    )
    expect(
      screen.getByText(
        'alice-app is the largest key, with 66.7% of the consumption.'
      )
    ).toBeInTheDocument()
  })

  it('is left out, without a message, when the server does not send the view', () => {
    render(
      <ActivityTab
        data={activity}
        sources={{
          view: ready,
          previous: ready,
          keys: { status: 'error', error: 'Not Found' },
        }}
      />
    )
    expect(screen.queryByText('By API key')).not.toBeInTheDocument()
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument()
  })

  it('says so while hours are still counted by the earlier definition', () => {
    render(
      <ActivityTab
        data={activity}
        keys={keys({ stale_hours: 3 })}
        sources={{ view: ready, previous: ready, keys: ready }}
      />
    )
    expect(
      screen.getByText(/still counted by the earlier definition/)
    ).toBeInTheDocument()
  })
})
