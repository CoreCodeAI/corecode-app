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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { TTFTPoint, TTFTSeries } from '../../types'
import { TTFTTrendPanel } from '../ttft-trend-panel'

const DAY = 86400
const day = (offset: number) => 1761408000 + offset * DAY
const range = { start: day(0), end: day(3), days: 3, hourly: false }

function point(
  offset: number,
  requests: number,
  p50: number,
  p95: number
): TTFTPoint {
  return { start: day(offset), requests, ttft_p50_ms: p50, ttft_p95_ms: p95 }
}

describe('first-token delay trend', () => {
  it('is left out on a server that does not send the series', () => {
    render(
      <TTFTTrendPanel
        series={undefined}
        source={{ status: 'success' }}
        range={range}
      />
    )
    expect(screen.queryByText('First-token delay trend')).toBeNull()
  })

  it('draws a line per vendor with enough streamed requests and leaves the others out', () => {
    const series: TTFTSeries[] = [
      {
        vendor: 'GPT',
        daily: [point(0, 150, 900, 2000), point(1, 150, 900, 18000)],
      },
      { vendor: 'Other', daily: [point(0, 20, 300, 800)] },
    ]
    render(
      <TTFTTrendPanel
        series={series}
        source={{ status: 'success' }}
        range={range}
      />
    )
    expect(screen.getByText('GPT')).toBeInTheDocument()
    expect(screen.queryByText('Other')).toBeNull()
    expect(screen.getByText(/GPT moved most/)).toBeInTheDocument()
  })

  it('switches the drawn percentile between p95 and p50', async () => {
    const user = userEvent.setup()
    const series: TTFTSeries[] = [
      {
        vendor: 'GPT',
        daily: [point(0, 150, 900, 2000), point(1, 150, 900, 2100)],
      },
    ]
    render(
      <TTFTTrendPanel
        series={series}
        source={{ status: 'success' }}
        range={range}
      />
    )
    expect(screen.getByText('GPT').closest('li')).toHaveTextContent('2,100')
    await user.click(screen.getByRole('button', { name: 'p50' }))
    expect(screen.getByText('GPT').closest('li')).toHaveTextContent('900')
  })
})
