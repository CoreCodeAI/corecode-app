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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { usageLogSchema } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'

const log = usageLogSchema.parse({
  id: 1,
  user_id: 2,
  created_at: 1788840000,
  type: 2,
  content: '',
  model_name: 'claude-opus-5-5',
  quota: 1000,
  use_time: 1.5,
  prompt_tokens: 12345,
  completion_tokens: 800,
  other: JSON.stringify({
    cache_tokens: 300,
    cache_creation_tokens: 2000,
    model_ratio: 1,
  }),
})

function TokenColumn() {
  const columns = useCommonLogsColumns(false, false)
  const table = useReactTable({
    data: [log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const header = table
    .getFlatHeaders()
    .find((item) => item.column.id === 'prompt_tokens')
  const cell = table
    .getRowModel()
    .rows[0].getVisibleCells()
    .find((item) => item.column.id === 'prompt_tokens')
  return (
    <TooltipProvider>
      <div role='columnheader'>
        {header &&
          flexRender(header.column.columnDef.header, header.getContext())}
      </div>
      <div data-testid='cell'>
        {cell && flexRender(cell.column.columnDef.cell, cell.getContext())}
      </div>
    </TooltipProvider>
  )
}

it('labels cache read and cache write, and groups the figures in the locale', () => {
  render(<TokenColumn />)
  expect(screen.getByText('Cache read 300')).toBeVisible()
  expect(screen.getByText('Cache write 2,000')).toBeVisible()
  expect(screen.getByText(/12,345/)).toBeVisible()
})

it('keeps the cache line readable instead of faint', () => {
  render(<TokenColumn />)
  const line = screen.getByText('Cache read 300').parentElement
  expect(line).toHaveClass('text-muted-foreground', 'text-xs')
  expect(line?.className).not.toContain('/60')
})

it('explains the token column in its header', async () => {
  render(<TokenColumn />)
  await userEvent.setup().hover(screen.getByText('Tokens'))
  expect(
    await screen.findAllByText('Input / output · cache read · cache write')
  ).not.toHaveLength(0)
})
