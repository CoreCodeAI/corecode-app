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
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { hourBars, sortFindings, type Finding } from '../../analysis'
import { useHourAxis } from '../../lib'
import { Drivers, Findings, SampleNote, TabLink } from '../insight-kit'
import { BarSeries } from '../shared'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

const H = 3600

describe('findings', () => {
  const items: Finding[] = [
    { key: 'w-small', tone: 'warning', title: 'Small warning', impact: 5 },
    { key: 'good', tone: 'good', title: 'Good news' },
    { key: 'w-large', tone: 'warning', title: 'Large warning', impact: 50 },
    { key: 'note', tone: 'default', title: 'A note' },
    { key: 'd', tone: 'danger', title: 'Danger', tab: 'capacity' },
  ]

  it('orders by tone, then by impact', () => {
    expect(sortFindings(items).map((item) => item.key)).toEqual([
      'd',
      'w-large',
      'w-small',
      'note',
      'good',
    ])
  })

  it('keeps the given order within a tone when impact ties', () => {
    expect(
      sortFindings([
        { key: 'a', tone: 'warning', title: 'a' },
        { key: 'b', tone: 'danger', title: 'b' },
        { key: 'c', tone: 'warning', title: 'c' },
      ]).map((item) => item.key)
    ).toEqual(['b', 'a', 'c'])
  })

  it('renders each finding in order, with a button to its tab', () => {
    const onOpen = vi.fn()
    render(
      <Findings
        items={items}
        onOpen={onOpen}
        tabLabel={(tab) => `Tab ${tab}`}
      />
    )
    const titles = screen
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent)
    expect(titles).toEqual([
      'Danger',
      'Large warning',
      'Small warning',
      'A note',
      'Good news',
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Tab capacity →' }))
    expect(onOpen).toHaveBeenCalledWith('capacity')
  })

  it('links a finding with only an address to that page', () => {
    render(
      <Findings
        items={[
          { key: 'x', tone: 'warning', title: 'Elsewhere', href: '/channels' },
        ]}
      />
    )
    expect(screen.getByRole('button', { name: 'Open →' })).toHaveAttribute(
      'href',
      '/channels'
    )
  })

  it('says the empty sentence, or nothing, with no findings', () => {
    const { container, rerender } = render(<Findings items={[]} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<Findings items={[]} empty='All clear.' />)
    expect(screen.getByText('All clear.')).toBeInTheDocument()
  })
})

describe('drivers', () => {
  it('lists each part with its signed change and share', () => {
    render(
      <Drivers
        title='What drove it'
        rows={[
          {
            key: 'a',
            label: 'claude-opus',
            change: '+¥95',
            share: '79%',
            tone: 'good',
          },
          { key: 'b', label: 'Alipay', change: '−¥30' },
        ]}
      />
    )
    expect(screen.getByText('What drove it')).toBeInTheDocument()
    const terms = screen.getAllByRole('term').map((term) => term.textContent)
    expect(terms).toEqual(['claude-opus', 'Alipay'])
    const amounts = screen
      .getAllByRole('definition')
      .map((amount) => amount.textContent)
    expect(amounts).toEqual(['+¥95 · 79%', '−¥30'])
    expect(screen.getByText('+¥95')).toHaveClass('text-emerald-600')
  })

  it('says the empty sentence without rows', () => {
    render(<Drivers rows={[]} empty='Nothing moved.' />)
    expect(screen.getByText('Nothing moved.')).toBeInTheDocument()
  })
})

describe('hour bars', () => {
  it('titles each hour, labels the day starts, and fades the open hour', () => {
    const midnight = new Date(2026, 10, 11, 0, 0, 0).getTime() / 1000
    const rows = [
      { hour: midnight - H, requests: 4 },
      { hour: midnight, requests: 6 },
      { hour: midnight + H, requests: 2 },
    ]
    const { result } = renderHook(() => useHourAxis())
    const end = midnight + H + 600
    const points = hourBars(
      rows,
      end,
      (row) => ({
        values: [row.requests],
        tone: row.requests > 5 ? 'warning' : undefined,
      }),
      result.current
    )
    expect(points.map((point) => point.key)).toEqual(
      rows.map((row) => row.hour)
    )
    expect(points.map((point) => point.faded)).toEqual([false, false, true])
    expect(points.map((point) => Boolean(point.axis))).toEqual([
      false,
      true,
      false,
    ])
    expect(points[1].tone).toBe('warning')
    expect(points[0].title).toBe(result.current.title(rows[0].hour))
    expect(
      result.current.bars(rows, end, (row) => ({ values: [row.requests] }))
    ).toHaveLength(3)
  })

  it('reads out an open hour as in progress, faint', () => {
    render(
      <BarSeries
        ariaLabel='hourly'
        series={[{ label: 'Count' }]}
        points={[
          { key: 1, title: '10:00', values: [3] },
          { key: 2, title: '11:00', values: [1], faded: true },
        ]}
      />
    )
    const open = screen.getByLabelText(/^11:00 \(in progress\),/)
    expect(open.querySelector('.opacity-50')).not.toBeNull()
    const closed = screen.getByLabelText(/^10:00,/)
    expect(closed.querySelector('.opacity-50')).toBeNull()
  })

  it('recolors a flagged bar by its tone', () => {
    render(
      <BarSeries
        ariaLabel='hourly'
        series={[{ label: 'Count' }]}
        points={[
          { key: 1, title: 'a', values: [3], tone: 'danger' },
          { key: 2, title: 'b', values: [1] },
        ]}
      />
    )
    expect(
      screen.getByLabelText(/^a,/).querySelector('.bg-destructive')
    ).not.toBeNull()
    expect(
      screen.getByLabelText(/^b,/).querySelector('.bg-destructive')
    ).toBeNull()
  })

  it('draws a reference line, scales to it, and reads it out on each bar', async () => {
    const { container } = render(
      <BarSeries
        ariaLabel='peak'
        series={[{ label: 'Peak' }]}
        reference={{ value: 40, label: 'Pool slots' }}
        points={[
          { key: 1, title: 'a', values: [10] },
          { key: 2, title: 'b', values: [20] },
        ]}
      />
    )
    expect(screen.getByLabelText('a, Peak 10, Pool slots 40')).toBeVisible()
    // The top tick is the reference, not the tallest bar.
    expect(container).toHaveTextContent('40')
    fireEvent.pointerDown(screen.getByLabelText(/^b,/), {
      pointerType: 'touch',
    })
    const popup = await screen.findByText('b', {
      selector: '[data-slot=tooltip-content] p',
    })
    expect(popup.closest('[data-slot=tooltip-content]')).toHaveTextContent(
      'Pool slots40'
    )
  })
})

describe('links and notes', () => {
  it('renders a tab link and a sample note', () => {
    render(
      <>
        <TabLink tab='pool'>See the pool</TabLink>
        <SampleNote>Too few to tell.</SampleNote>
      </>
    )
    expect(screen.getByRole('link', { name: 'See the pool' })).toBeVisible()
    expect(screen.getByText('Too few to tell.')).toHaveClass(
      'text-muted-foreground'
    )
  })
})
