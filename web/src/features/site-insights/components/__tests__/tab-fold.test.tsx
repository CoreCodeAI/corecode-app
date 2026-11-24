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
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { attentionCounts, RED_SHOWN } from '../../attention'
import type { Finding } from '../insight-kit'
import { AttentionPanel, AttentionSummary, FoldedBreakdown } from '../tab-fold'

function finding(key: string, tone: Finding['tone']): Finding {
  return { key, tone, title: `Finding ${key}` }
}

const items: Finding[] = [
  finding('a', 'danger'),
  finding('b', 'warning'),
  finding('c', 'danger'),
  finding('d', 'danger'),
  finding('e', 'danger'),
  finding('f', 'warning'),
]

describe('attention', () => {
  it('counts the red and yellow findings', () => {
    expect(attentionCounts(items)).toEqual({ total: 6, red: 4, yellow: 2 })
    expect(attentionCounts([])).toEqual({ total: 0, red: 0, yellow: 0 })
  })

  it('summarizes the findings in one line and opens the list on its button', async () => {
    const onShow = vi.fn()
    render(<AttentionSummary items={items} targetId='target' onShow={onShow} />)
    expect(screen.getByText('Needs attention: 6')).toBeInTheDocument()
    expect(screen.getByText('4 red')).toBeInTheDocument()
    expect(screen.getByText('2 yellow')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /See the list/ }))
    expect(onShow).toHaveBeenCalledOnce()
  })

  it('says nothing when there is nothing to attend to', () => {
    const { container } = render(
      <AttentionSummary items={[]} targetId='target' onShow={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  function Harness(props: { items: Finding[] }) {
    const [open, setOpen] = useState(false)
    return (
      <AttentionPanel
        id='target'
        items={props.items}
        open={open}
        onOpenChange={setOpen}
      />
    )
  }

  it('lists only the first red findings until asked for all, then every one', async () => {
    render(<Harness items={items} />)
    expect(screen.getAllByText(/^Finding /)).toHaveLength(RED_SHOWN)
    expect(screen.queryByText('Finding b')).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Show all 6' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getAllByText(/^Finding /)).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.getAllByText(/^Finding /)).toHaveLength(RED_SHOWN)
  })

  it('says none is red when only yellow ones remain, and still offers them', () => {
    render(
      <Harness items={[finding('x', 'warning'), finding('y', 'warning')]} />
    )
    expect(
      screen.getByText('Nothing here is red; 2 are worth a look.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Show all 2' })
    ).toBeInTheDocument()
  })
})

describe('FoldedBreakdown', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      name: `row-${index + 1}`,
      count: 100 - index * 10,
    }))

  it('shows a short list whole, with no fold', () => {
    render(<FoldedBreakdown items={rows(6)} empty='none' restLabel='Rest' />)
    expect(screen.getByText('row-6')).toBeInTheDocument()
    expect(screen.queryByText('Rest')).not.toBeInTheDocument()
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
  })

  it('sums the rows past the first five into one, and keeps every row behind the fold', () => {
    const { container } = render(
      <FoldedBreakdown items={rows(9)} empty='none' restLabel='Rest' />
    )
    // Rows 6..9 are 50+40+30+20.
    expect(screen.getByText('Rest')).toBeInTheDocument()
    const details = container.querySelector('details') as HTMLElement
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('row-9')).toBeInTheDocument()
    expect(within(details).queryByText('Rest')).not.toBeInTheDocument()
    expect(screen.getByText('Show all 9')).toBeInTheDocument()
  })

  it('shows the empty sentence when there is nothing', () => {
    render(
      <FoldedBreakdown items={[]} empty='Nothing failed' restLabel='Rest' />
    )
    expect(screen.getByText('Nothing failed')).toBeInTheDocument()
  })
})
