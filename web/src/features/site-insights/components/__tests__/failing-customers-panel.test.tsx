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
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { FailingUser } from '../../types'
import { FailingCustomersPanel } from '../failing-customers-panel'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

const alice: FailingUser = {
  user_id: 3,
  username: 'alice',
  requests: 40,
  service_failures: 12,
  service_failure_rate: 0.3,
  top_model: 'gpt-6',
  top_model_failures: 9,
}

describe('customers with the most service failures', () => {
  it('is left out on a server that does not send the field', () => {
    render(
      <FailingCustomersPanel users={undefined} source={{ status: 'success' }} />
    )
    expect(
      screen.queryByText('Customers with the most service failures')
    ).toBeNull()
  })

  it('names each customer with their failures, failing model and a link to their logs', () => {
    render(
      <FailingCustomersPanel users={[alice]} source={{ status: 'success' }} />
    )
    expect(
      screen.getByText(
        'alice met the most service failures: 12 of their 40 requests.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('gpt-6')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Logs' })).toBeInTheDocument()
  })

  it('shows the tab’s stale note while stored hours are still on an earlier definition', () => {
    render(
      <FailingCustomersPanel
        users={[alice]}
        source={{ status: 'success' }}
        staleHours={2}
      />
    )
    expect(
      screen.getByText(/still counted by the earlier definition/)
    ).toBeInTheDocument()
  })

  it('says no customer failed, rather than naming one, when the list is empty', () => {
    render(<FailingCustomersPanel users={[]} source={{ status: 'success' }} />)
    expect(
      screen.getByText('No customer had a service failure in this range')
    ).toBeInTheDocument()
  })
})
