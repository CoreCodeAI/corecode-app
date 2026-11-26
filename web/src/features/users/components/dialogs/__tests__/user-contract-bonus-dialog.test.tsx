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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  contractBonusRateToPercent,
  parseContractBonusPercent,
} from '../../../lib/contract-bonus'
import { UserContractBonusDialog } from '../user-contract-bonus-dialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('reads a percent with at most two decimals, from 0 to 100', () => {
  expect(parseContractBonusPercent('10')).toBe(10)
  expect(parseContractBonusPercent(' 7.25 ')).toBe(7.25)
  expect(parseContractBonusPercent('0')).toBe(0)
  expect(parseContractBonusPercent('100')).toBe(100)
  for (const text of ['', '-1', '101', '1.234', 'abc', '10%']) {
    expect(parseContractBonusPercent(text)).toBeNull()
  }
  expect(contractBonusRateToPercent(0.07)).toBe('7')
  expect(contractBonusRateToPercent(0.0725)).toBe('7.25')
})

it('shows the current rate and saves a new one as a fraction', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { user_id: 3163, rate: 0.1 } },
  })
  const put = vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: true, data: { user_id: 3163, rate: 0.3 } },
  })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UserContractBonusDialog
        open
        onOpenChange={onOpenChange}
        user={{ id: 3163, username: 'pathpal' }}
      />
    </QueryClientProvider>
  )

  const input = await screen.findByLabelText('Bonus rate (%)')
  expect(input).toHaveValue('10')
  await userEvent.clear(input)
  await userEvent.type(input, '101')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await userEvent.clear(input)
  await userEvent.type(input, '30')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(put).toHaveBeenCalledWith('/api/user/3163/contract-bonus', {
    rate: 0.3,
  })
})
