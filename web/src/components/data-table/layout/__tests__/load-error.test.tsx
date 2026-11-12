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
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { DataTablePage } from '../data-table-page'

type Row = { name: string }

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
]

function ListPage(props: {
  rows: Row[]
  isError?: boolean
  isLoading?: boolean
  onRetry?: () => void
  mobile?: React.ReactNode
}) {
  const table = useReactTable({
    data: props.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={props.isLoading}
      isError={props.isError}
      onRetry={props.onRetry}
      errorTitle='Failed to load widgets'
      emptyTitle='No Widgets Found'
      emptyAction={<button type='button'>Create your first widget</button>}
      mobile={props.mobile}
      showPagination={false}
    />
  )
}

function usePhoneWidth() {
  const matchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...matchMedia(query),
    matches: query.includes('max-width'),
  }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('shows an error with retry instead of the empty state when the first load fails', async () => {
  const onRetry = vi.fn()
  render(<ListPage rows={[]} isError onRetry={onRetry} />)

  expect(screen.getByText('Failed to load widgets')).toBeInTheDocument()
  expect(screen.queryByText('No Widgets Found')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Create your first widget' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('replaces a custom mobile list with the error state on a phone when the first load fails', () => {
  usePhoneWidth()
  render(
    <ListPage rows={[]} isError mobile={<p>No widgets on this phone</p>} />
  )

  expect(screen.getByText('Failed to load widgets')).toBeInTheDocument()
  expect(screen.queryByText('No widgets on this phone')).not.toBeInTheDocument()
})

it('keeps earlier rows and adds a one-line alert with retry when a later load fails', async () => {
  const onRetry = vi.fn()
  render(<ListPage rows={[{ name: 'alpha' }]} isError onRetry={onRetry} />)

  expect(screen.getByText('alpha')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Failed to load widgets')
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('keeps the empty state and its create action when the caller passes no error', () => {
  render(<ListPage rows={[]} />)

  expect(screen.getByText('No Widgets Found')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Create your first widget' })
  ).toBeInTheDocument()
  expect(screen.queryByText('Failed to load widgets')).not.toBeInTheDocument()
})

it('shows the loading skeleton rather than the error while a retry has no data yet', () => {
  render(<ListPage rows={[]} isError isLoading />)

  expect(screen.queryByText('Failed to load widgets')).not.toBeInTheDocument()
})
