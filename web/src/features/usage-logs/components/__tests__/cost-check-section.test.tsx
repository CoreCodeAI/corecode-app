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
import { afterEach, describe, expect, it } from 'vitest'

import type { CostCheck } from '../../lib/cost-check'
import { CostCheckSection } from '../dialogs/cost-check-section'

afterEach(cleanup)

const check = (fields: Partial<CostCheck>): CostCheck => ({
  lines: [
    { kind: 'input', tokens: 1758, unitPriceUSD: 6, subtotal: 5274 },
    { kind: 'output', tokens: 2545, unitPriceUSD: 30, subtotal: 38175 },
  ],
  groupRatio: 1.5,
  expected: 43449,
  actual: 43449,
  status: 'match',
  ...fields,
})

describe('CostCheckSection', () => {
  it('lists each priced line with its token count', () => {
    render(<CostCheckSection check={check({})} />)

    const rows = screen.getAllByRole('row')
    expect(rows.map((row) => row.querySelector('th')?.textContent)).toEqual([
      'Item',
      'Input',
      'Output',
      'Expected at listed prices',
      'Charged',
    ])
    expect(screen.getByRole('row', { name: /Input/ })).toHaveTextContent(
      '1,758'
    )
  })

  it('confirms a charge that matches and shows the price as base × group ratio', () => {
    render(<CostCheckSection check={check({})} />)

    expect(screen.getByText('Matches the listed prices')).toBeInTheDocument()
    expect(
      screen.getByText('Price = base price × group ratio (1.5×)')
    ).toBeInTheDocument()
    // The paid unit price and the base price it comes from share one cell.
    const input = screen.getByRole('row', { name: /Input/ })
    expect(input).toHaveTextContent('$6')
    expect(input).toHaveTextContent('$4 × 1.5')
  })

  it('leaves out the ratio formula when the group ratio is 1', () => {
    render(<CostCheckSection check={check({ groupRatio: 1 })} />)

    expect(screen.queryByText(/^Price = base price/)).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Input/ })).not.toHaveTextContent(
      '×'
    )
  })

  it('shows an empty output as 0 tokens at $0', () => {
    render(
      <CostCheckSection
        check={check({
          lines: [
            { kind: 'input', tokens: 1758, unitPriceUSD: 6, subtotal: 5274 },
            { kind: 'output', tokens: 0, unitPriceUSD: 30, subtotal: 0 },
          ],
          expected: 5274,
          actual: 5274,
        })}
      />
    )

    const output = screen.getByRole('row', { name: /Output/ })
    expect(output).toHaveTextContent('0')
    expect(output.querySelectorAll('td')[2]).toHaveTextContent('$0')
  })

  it('explains a charge that the lines do not add up to', () => {
    render(
      <CostCheckSection check={check({ actual: 46449, status: 'adjusted' })} />
    )

    expect(screen.getByText(/^Differs by/)).toBeInTheDocument()
    expect(
      screen.queryByText('Matches the listed prices')
    ).not.toBeInTheDocument()
  })
})
