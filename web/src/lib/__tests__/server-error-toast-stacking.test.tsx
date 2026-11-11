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
import { act, cleanup, render, screen } from '@testing-library/react'
import { Toaster, toast } from 'sonner'
import { afterEach, expect, it } from 'vitest'

import { handleServerError } from '@/lib/handle-server-error'

afterEach(() => {
  act(() => {
    toast.dismiss()
  })
  cleanup()
})

it('shows one toast when independent requests fail with the same message', async () => {
  render(<Toaster />)
  act(() => {
    handleServerError(new Error('Network Error'))
    handleServerError(new Error('Network Error'))
    handleServerError(new Error('Network Error'))
  })
  await screen.findByText('Network Error')
  expect(screen.getAllByText('Network Error')).toHaveLength(1)
})

it('keeps one toast per message when different failures arrive together', async () => {
  render(<Toaster />)
  act(() => {
    handleServerError(new Error('Network Error'))
    handleServerError(new Error('Request failed with status code 502'))
  })
  await screen.findByText('Network Error')
  expect(
    screen.getByText('Request failed with status code 502')
  ).toBeInTheDocument()
})
