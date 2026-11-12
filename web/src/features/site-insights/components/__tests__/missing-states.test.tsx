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
import { render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  countsRequestsOnce,
  sourceState,
  tableState,
  useErrorCategoryLabel,
  useVendorName,
  vendorColor,
} from '../../lib'
import { StaleNote } from '../insight-kit'
import { Breakdown, MetricGrid, Panel, SimpleTable, UserLabel } from '../shared'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

describe('a missing figure', () => {
  it('shows a muted dash with no change, tone or trend', () => {
    render(
      <MetricGrid
        items={[
          {
            label: 'Revenue',
            value: '¥0.00',
            missing: true,
            tone: 'danger',
            featured: true,
            delta: { current: 0, previous: 3200, better: 'up' },
            trend: [
              { title: 'a', value: 1 },
              { title: 'b', value: 2 },
            ],
          },
        ]}
      />
    )
    const dash = screen.getByText('-')
    expect(dash).toHaveClass('text-muted-foreground')
    expect(screen.queryByText('¥0.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('keeps a present figure as before, with its full text as a title', () => {
    render(
      <MetricGrid
        items={[
          {
            label: 'Revenue',
            value: '¥1,234,567.89',
            delta: { current: 2, previous: 1, better: 'up' },
          },
        ]}
      />
    )
    expect(screen.getByText('¥1,234,567.89')).toHaveAttribute(
      'title',
      '¥1,234,567.89'
    )
    expect(screen.getByText(/×2/)).toBeInTheDocument()
  })
})

describe('a list with no rows', () => {
  const columns = [{ key: 'id', label: 'ID', render: (row: number) => row }]

  it('says loading, failed or empty by its state', () => {
    const { rerender } = render(
      <SimpleTable<number>
        columns={columns}
        rows={undefined}
        rowKey={(row) => row}
        empty='No customer owes money'
        state='loading'
      />
    )
    expect(screen.getByRole('status', { name: 'Loading...' })).toBeVisible()
    expect(screen.queryByText('No customer owes money')).not.toBeInTheDocument()

    rerender(
      <SimpleTable<number>
        columns={columns}
        rows={undefined}
        rowKey={(row) => row}
        empty='No customer owes money'
        state='error'
      />
    )
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    expect(screen.queryByText('No customer owes money')).not.toBeInTheDocument()

    rerender(
      <SimpleTable<number>
        columns={columns}
        rows={[]}
        rowKey={(row) => row}
        empty='No customer owes money'
      />
    )
    expect(screen.getByText('No customer owes money')).toBeInTheDocument()
  })

  it('shows rows it has whatever the state', () => {
    render(
      <SimpleTable<number>
        columns={columns}
        rows={[7]}
        rowKey={(row) => row}
        empty='none'
        state='error'
      />
    )
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('Could not be read')).not.toBeInTheDocument()
  })

  it('applies to a breakdown', () => {
    const { rerender } = render(
      <Breakdown items={undefined} empty='No failed requests' state='error' />
    )
    expect(screen.getByText('Could not be read')).toBeInTheDocument()
    rerender(<Breakdown items={null} empty='No failed requests' />)
    expect(screen.getByText('No failed requests')).toBeInTheDocument()
  })
})

describe('tableState', () => {
  it('reads loading and failed only while there are no rows', () => {
    expect(tableState({ status: 'pending' }, undefined)).toBe('loading')
    expect(tableState({ status: 'error', error: 'x' }, undefined)).toBe('error')
    expect(tableState({ status: 'error' }, [])).toBeUndefined()
    expect(tableState({ status: 'success' }, undefined)).toBeUndefined()
    expect(tableState(undefined, undefined)).toBeUndefined()
  })
})

describe('sourceState', () => {
  it('keeps the error message of a failed query', () => {
    expect(
      sourceState({ status: 'error', error: new Error('timed out') })
    ).toEqual({ status: 'error', error: 'timed out' })
    expect(sourceState({ status: 'pending', error: null })).toEqual({
      status: 'pending',
    })
  })
})

it('shows a panel error where its description goes', () => {
  render(
    <Panel title='Referrals' description='12 inviters' error='read failed'>
      body
    </Panel>
  )
  expect(screen.getByText('read failed')).toHaveClass('text-destructive')
  expect(screen.queryByText('12 inviters')).not.toBeInTheDocument()
})

it('cuts a long user name short and keeps the id', () => {
  render(<UserLabel user_id={42} username='averyveryverylongname' />)
  expect(screen.getByText('averyveryverylongname')).toHaveAttribute(
    'title',
    'averyveryverylongname'
  )
  expect(screen.getByText('averyveryverylongname')).toHaveClass('truncate')
  expect(screen.getByText('#42')).toBeInTheDocument()
})

describe('StaleNote', () => {
  it('renders nothing without stale hours', () => {
    const { container, rerender } = render(
      <StaleNote staleHours={0} rangeHours={24} />
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<StaleNote staleHours={undefined} rangeHours={24} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says how much of the range is being rebuilt', () => {
    const { rerender } = render(<StaleNote staleHours={6} rangeHours={24} />)
    expect(
      screen.getByText(
        '6 of the range’s 24 hours are still counted by the earlier definition and are being rebuilt; their figures may change.'
      )
    ).toBeInTheDocument()
    rerender(<StaleNote staleHours={24} rangeHours={24} />)
    expect(
      screen.getByText(/This range is still counted by the earlier definition/)
    ).toBeInTheDocument()
  })
})

describe('round 2 names', () => {
  it('labels the new error categories and the media vendor', () => {
    const category = renderHook(() => useErrorCategoryLabel()).result.current
    expect(category('engine_limit')).toBe('Engine concurrency or rate cap')
    expect(category('engine_budget')).toBe('Engine account budget')
    expect(category('upstream_auth')).toBe('Upstream refused the key')
    expect(category('no_channel')).toBe('No channel for the model')
    expect(category('something_new')).toBe('something_new')
    const vendor = renderHook(() => useVendorName()).result.current
    expect(vendor('media')).toBe('Image and video')
    expect(vendorColor('media')).not.toBe(vendorColor('other'))
    expect(vendorColor('claude')).toBe('var(--series-1)')
  })

  it('tells a view that counts requests once by its stale_hours', () => {
    expect(countsRequestsOnce({ stale_hours: 0 })).toBe(true)
    expect(countsRequestsOnce({})).toBe(false)
    expect(countsRequestsOnce(undefined)).toBe(false)
  })
})
