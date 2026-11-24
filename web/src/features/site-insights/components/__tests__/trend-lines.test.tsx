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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { TrendLines } from '../trend-lines'

const titles = ['Mon', 'Tue', 'Wed', 'Thu']

function renderLines(
  values: (number | null)[],
  extra: Partial<Parameters<typeof TrendLines>[0]> = {}
) {
  return render(
    <TrendLines
      ariaLabel='Failure rate by vendor'
      titles={titles}
      axis={titles}
      format={(value) => `${(value * 100).toFixed(1)}%`}
      lines={[
        { key: 'claude', label: 'Claude', color: 'red', values },
        {
          key: 'all',
          label: 'All models',
          color: 'gray',
          dashed: true,
          values: [0.01, 0.01, 0.01, 0.01],
        },
      ]}
      {...extra}
    />
  )
}

describe('TrendLines', () => {
  it('draws a segment between adjacent values and breaks the line at a gap', () => {
    const { container } = renderLines([0.02, null, 0.03, 0.04])
    // Claude: only 2→3 is joined (3 values, one gap); All: three segments.
    const segments = container.querySelectorAll('line[data-line="claude"]')
    expect(segments).toHaveLength(1)
    expect(container.querySelectorAll('line[data-line="all"]')).toHaveLength(3)
  })

  it('reads out every line at the position the arrow keys move to', async () => {
    renderLines([0.02, 0.03, null, 0.04])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    screen.getByRole('group', { name: 'Failure rate by vendor' }).focus()
    // The first arrow lands on the first position, the second on Tue.
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    const readout = screen.getByRole('status')
    expect(within(readout).getByText('Tue')).toBeInTheDocument()
    expect(within(readout).getByText('3.0%')).toBeInTheDocument()
    expect(within(readout).getByText('1.0%')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowRight}')
    // Claude has no value on Wed: a dash, not 0.
    expect(
      within(screen.getByRole('status')).getByText('—')
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lists each line in a legend with its summary', () => {
    renderLines([0.02, 0.03, 0.04, 0.05], {
      lines: [
        {
          key: 'claude',
          label: 'Claude',
          color: 'red',
          values: [0.02, 0.03, 0.04, 0.05],
          summary: '3.5%',
        },
      ],
    })
    const item = screen.getByText('Claude').closest('li')
    expect(item).toHaveTextContent('Claude3.5%')
  })

  it('shows the reference level and marks a partial day dashed', () => {
    const { container } = renderLines([0.02, 0.03, 0.04, 0.05], {
      reference: { value: 0.05, label: '5%' },
      partial: [true, false, false, false],
    })
    expect(container.querySelector('line[data-reference]')).toBeTruthy()
    const first = container.querySelector('line[data-line="claude"]')
    expect(first?.getAttribute('stroke-dasharray')).toBeTruthy()
  })
})
