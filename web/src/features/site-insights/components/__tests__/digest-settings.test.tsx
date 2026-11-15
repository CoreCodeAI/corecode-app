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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getDigestSettings,
  saveDigestSettings,
  sendTestDigest,
} from '../../api'
import { DigestSettings } from '../digest-settings'

vi.mock('../../api', () => ({
  getDigestSettings: vi.fn(),
  saveDigestSettings: vi.fn(),
  sendTestDigest: vi.fn(),
}))

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <DigestSettings />
    </QueryClientProvider>
  )
  return userEvent.setup()
}

describe('the daily digest settings on the overview', () => {
  beforeEach(() => {
    vi.mocked(getDigestSettings).mockReset()
    vi.mocked(saveDigestSettings).mockReset().mockResolvedValue()
    vi.mocked(sendTestDigest).mockReset().mockResolvedValue()
  })

  it('reads the settings only when opened, and saves only what changed', async () => {
    vi.mocked(getDigestSettings).mockResolvedValue({
      enabled: false,
      hour: '9',
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    })
    const user = open()
    expect(getDigestSettings).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'Daily Feishu digest' })
    )
    const hour = await screen.findByLabelText(
      'Send hour, 0 to 23, Beijing time'
    )
    // Nothing changed yet: nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('switch'))
    await user.clear(hour)
    await user.type(hour, '8')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saveDigestSettings).toHaveBeenCalledWith({
        hour: '8',
        enabled: true,
      })
    )
  })

  it('refuses an hour that is not 0 to 23', async () => {
    vi.mocked(getDigestSettings).mockResolvedValue({
      enabled: true,
      hour: '9',
      webhook: '',
    })
    const user = open()
    await user.click(
      screen.getByRole('button', { name: 'Daily Feishu digest' })
    )
    const hour = await screen.findByLabelText(
      'Send hour, 0 to 23, Beijing time'
    )
    await user.clear(hour)
    await user.type(hour, '24')
    expect(screen.getByText('Enter a whole number')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(saveDigestSettings).not.toHaveBeenCalled()
  })

  it('sends a test only to a webhook already saved, and a typed secret is saved', async () => {
    vi.mocked(getDigestSettings).mockResolvedValue({
      enabled: true,
      hour: '9',
      webhook: '',
    })
    const user = open()
    await user.click(
      screen.getByRole('button', { name: 'Daily Feishu digest' })
    )
    expect(
      await screen.findByRole('button', { name: 'Send test message' })
    ).toBeDisabled()
    await user.type(
      screen.getByLabelText('Feishu bot webhook'),
      'https://open.feishu.cn/open-apis/bot/v2/hook/x'
    )
    await user.type(screen.getByLabelText('Feishu signing secret'), 's3')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saveDigestSettings).toHaveBeenCalledWith({
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/x',
        secret: 's3',
      })
    )
    expect(sendTestDigest).not.toHaveBeenCalled()
  })

  it('says so when the settings cannot be read', async () => {
    vi.mocked(getDigestSettings).mockRejectedValue(new Error('no access'))
    const user = open()
    await user.click(
      screen.getByRole('button', { name: 'Daily Feishu digest' })
    )
    expect(await screen.findByText('no access')).toBeInTheDocument()
  })
})
