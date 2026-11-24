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
import { describe, expect, it } from 'vitest'

import { MiniBar, StackBar } from '../stack-bar'

describe('StackBar', () => {
  it('sizes each part by its share and lists the parts with figure and share', () => {
    render(
      <StackBar
        ariaLabel='Tasks'
        segments={[
          { key: 'ok', label: 'Succeeded', value: 75, className: 'bg-ok' },
          { key: 'bad', label: 'Failed', value: 25, className: 'bg-bad' },
          { key: 'none', label: 'Running', value: 0, className: 'bg-run' },
        ]}
      />
    )
    const bar = screen.getByRole('img', { name: 'Tasks' })
    const parts = bar.querySelectorAll('span')
    // A part with no value draws nothing.
    expect(parts).toHaveLength(2)
    expect((parts[0] as HTMLElement).style.width).toBe('75%')
    expect((parts[1] as HTMLElement).style.width).toBe('25%')
    const legend = screen.getByRole('list')
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2)
    expect(within(legend).getByText(/75 · 75%/)).toBeInTheDocument()
    expect(within(legend).queryByText('Running')).not.toBeInTheDocument()
  })

  it('leaves the legend out when bare and draws an empty track without a total', () => {
    render(
      <StackBar
        bare
        ariaLabel='Empty'
        segments={[{ key: 'a', label: 'A', value: 0 }]}
      />
    )
    expect(screen.getByRole('img', { name: 'Empty' }).children).toHaveLength(0)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('MiniBar', () => {
  it('reaches toward max and stops at it', () => {
    const { container, rerender } = render(<MiniBar value={0.05} max={0.1} />)
    const fill = () => container.querySelector('span > span') as HTMLElement
    expect(fill().style.width).toBe('50%')
    rerender(<MiniBar value={0.5} max={0.1} />)
    expect(fill().style.width).toBe('100%')
    rerender(<MiniBar value={0} max={0.1} />)
    expect(fill().style.width).toBe('0%')
    rerender(<MiniBar value={1} max={0} />)
    expect(fill().style.width).toBe('0%')
  })
})
