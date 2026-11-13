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
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import type { UserApiKey } from '../../types'
import { UserApiKeysDialog } from '../dialogs/user-api-keys-dialog'

function key(id: number, name: string, group: string, status = 1): UserApiKey {
  return {
    id,
    name,
    key: `ab${id}*********yz`,
    status,
    group,
    created_time: 1_700_000_000,
    accessed_time: 0,
    expired_time: -1,
    remain_quota: 0,
    unlimited_quota: true,
    used_quota: 0,
  }
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <UserApiKeysDialog
        open
        onOpenChange={() => {}}
        user={{ id: 42, username: 'alice' }}
      />
    </QueryClientProvider>
  )
}

// jsdom has no Web Animations API; Base UI's scroll area calls it.
const getAnimationsDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterAll(() => {
  if (getAnimationsDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      getAnimationsDescriptor
    )
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("lists the user's keys with their total and per-group counts", async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          key(3, 'codex', 'gpt'),
          key(2, 'laptop', ''),
          key(1, 'server', 'gpt', 2),
        ],
        total: 3,
      },
    },
  })
  renderDialog()

  expect(await screen.findByText('3 API keys in total')).toBeTruthy()
  expect(get).toHaveBeenCalledWith('/api/admin/users/42/tokens', {
    params: { p: 1, page_size: 100 },
  })
  expect(screen.getByText('×2')).toBeTruthy()
  expect(screen.getByText('×1')).toBeTruthy()
  const rows = screen.getAllByRole('row').slice(1)
  expect(
    rows.map((row) => within(row).getAllByRole('cell')[0].textContent)
  ).toEqual(['codex', 'laptop', 'server'])
  expect(within(rows[0]).getByText('sk-ab3*********yz')).toBeTruthy()
  expect(within(rows[2]).getByText('Disabled')).toBeTruthy()
})

it('says so when the user has no keys', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: null, total: 0 } },
  })
  renderDialog()

  expect(await screen.findByText('This user has no API keys')).toBeTruthy()
})
