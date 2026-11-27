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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { PersonaInsights } from '../../types'
import { PersonasTab } from '../personas-tab'

// Synthetic customers only: the names and remarks are examples.
const data: PersonaInsights = {
  window_days: 30,
  total_spend_usd: 900,
  whale_floor_usd: 500,
  sectors: [
    { sector: '科研', customers: 1, spend_usd: 600, share: 0.6667 },
    { sector: 'unidentified', customers: 1, spend_usd: 300, share: 0.3333 },
  ],
  customers: [
    {
      user_id: 1,
      username: 'lab-user',
      display_name: 'Lab',
      sector: '科研',
      detail: '生物信息',
      tags: ['大模型评测'],
      remark: '已签年付',
      spend_usd: 600,
      last_active: 0,
      persona_date: '11-03',
    },
    {
      user_id: 2,
      username: 'plain-user',
      display_name: 'Plain',
      sector: 'unidentified',
      detail: '',
      tags: ['批量'],
      remark: '',
      spend_usd: 300,
      last_active: 0,
      persona_date: '11-01',
    },
  ],
  whales: [
    { user_id: 4, username: 'big-user', spend_usd: 800, last_active: 0 },
  ],
}

describe('PersonasTab', () => {
  it('names each sector, including the unidentified customers', () => {
    render(<PersonasTab data={data} />)

    expect(
      screen.getAllByText('Academic research and student papers').length
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Unidentified').length).toBeGreaterThan(0)
    expect(screen.getByText('大模型评测')).toBeTruthy()
    expect(screen.getByText('已签年付')).toBeTruthy()
  })

  it('lists the large customers without a persona, and only them', () => {
    render(<PersonasTab data={data} />)

    expect(screen.getAllByText('big-user')).toHaveLength(1)
    expect(screen.getAllByText('lab-user')).toHaveLength(1)
  })

  it('says so before any customer has a persona', () => {
    render(
      <PersonasTab data={{ ...data, sectors: [], customers: [], whales: [] }} />
    )

    expect(
      screen.getAllByText('No customer has a persona block yet')
    ).toHaveLength(2)
    expect(
      screen.getByText('Every large customer has a persona block')
    ).toBeTruthy()
  })
})
