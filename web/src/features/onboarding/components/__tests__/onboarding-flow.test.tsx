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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import {
  dismissOnboarding,
  onboardingDismissKey,
  CLAUDE_CODE_GROUP,
  EXTERNAL_GROUP,
} from '../../lib/onboarding'
import OnboardingLauncher from '../onboarding-launcher'
import { OnboardingWaitStep, ONBOARDING_POLL_MS } from '../onboarding-wait-step'
import { OnboardingWizard } from '../onboarding-wizard'

const GROUPS = {
  [CLAUDE_CODE_GROUP]: { desc: '', ratio: 0.5, claude_code_only: true },
  [EXTERNAL_GROUP]: { desc: '', ratio: 1 },
}

type Mock = {
  keys: unknown[]
  groups: unknown
  wallet: number
  requestCount: number
}

let mock: Mock
let client: QueryClient

const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } })

function route(url: string) {
  if (url.startsWith('/api/token/?')) return ok({ items: mock.keys })
  if (url === '/api/token/9') {
    return ok({
      id: 9,
      name: 'Default key',
      key: 'newk**********wxyz',
      status: 1,
      expired_time: -1,
      unlimited_quota: true,
      remain_quota: 0,
      group: '',
    })
  }
  if (url === '/api/user/self/groups') return ok(mock.groups)
  if (url.startsWith('/api/user/models')) return ok(['claude-opus-5-5'])
  if (url === '/api/user/self') {
    return ok({
      id: 5,
      quota: mock.wallet,
      request_count: mock.requestCount,
      used_quota: 0,
    })
  }
  if (url === '/api/subscription/self') {
    return ok({ subscriptions: [], all_subscriptions: [] })
  }
  if (url === '/api/subscription/plans') return ok([])
  return ok(null)
}

beforeEach(() => {
  mock = { keys: [], groups: GROUPS, wallet: 500000, requestCount: 0 }
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'CoreCode',
    server_address: 'https://corecode.live',
  })
  useAuthStore.setState((state) => ({
    auth: {
      ...state.auth,
      user: {
        id: 5,
        quota: mock.wallet,
        request_count: 0,
        used_quota: 0,
      } as never,
    },
  }))
  vi.spyOn(api, 'get').mockImplementation((url: string) => route(url))
  vi.spyOn(api, 'post').mockImplementation((url: string) => {
    if (url === '/api/token/') return ok({ id: 9, name: 'Default key' })
    if (url.endsWith('/key')) return ok({ key: 'full-secret-value' })
    return ok(null)
  })
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function renderWithProviders(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

const createCalls = () =>
  vi.mocked(api.post).mock.calls.filter(([url]) => url === '/api/token/')

async function pickClient(name: string) {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: new RegExp(name) })
  )
  return user
}

describe('OnboardingWizard key step', () => {
  it('creates a key in the Claude Code only group when the account has none', async () => {
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    await pickClient('^Claude Code')

    await screen.findByLabelText('Configuration snippet')
    expect(createCalls()).toHaveLength(1)
    expect(createCalls()[0][1]).toMatchObject({
      name: 'Default key',
      group: CLAUDE_CODE_GROUP,
    })
    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      '"ANTHROPIC_BASE_URL": "https://corecode.live"'
    )
  })

  it('creates the key in the external group for an OpenAI-compatible client', async () => {
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    await pickClient('^OpenAI-compatible')

    await screen.findByLabelText('Configuration snippet')
    expect(createCalls()[0][1]).toMatchObject({ group: EXTERNAL_GROUP })
  })

  it('falls back to the default group and says so when the account cannot use the group', async () => {
    mock.groups = { default: { desc: '', ratio: 1 } }
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    await pickClient('^Claude Code')

    await screen.findByLabelText('Configuration snippet')
    expect(createCalls()[0][1]).toMatchObject({ group: '' })
    expect(
      screen.getByText(/cannot use the group made for this client/)
    ).toBeInTheDocument()
  })

  it('reuses an existing key instead of creating one', async () => {
    mock.keys = [
      {
        id: 3,
        name: 'laptop',
        key: 'abcd**********wxyz',
        status: 1,
        expired_time: -1,
        unlimited_quota: true,
        remain_quota: 0,
        group: CLAUDE_CODE_GROUP,
      },
    ]
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    await pickClient('^Claude Code')

    expect(await screen.findByText('laptop')).toBeInTheDocument()
    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      'sk-abcd…wxyz'
    )
    expect(createCalls()).toHaveLength(0)
  })

  it('shows the add-credits call to action before step 3 when the account is empty', async () => {
    mock.wallet = 0
    useAuthStore.setState((state) => ({
      auth: { ...state.auth, user: { ...state.auth.user, quota: 0 } as never },
    }))
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    await pickClient('^Claude Code')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'insufficient quota'
    )
    expect(screen.getByRole('button', { name: /Add credits/ })).toHaveAttribute(
      'href',
      '/wallet'
    )
  })

  it('copies the agent prompt with the full key', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    mock.keys = [
      {
        id: 3,
        name: 'laptop',
        key: 'abcd**********wxyz',
        status: 1,
        expired_time: -1,
        unlimited_quota: true,
        remain_quota: 0,
        group: EXTERNAL_GROUP,
      },
    ]
    await renderWithProviders(<OnboardingWizard onClose={() => {}} />)
    const user = await pickClient('^Let my AI agent')
    await screen.findByLabelText('Configuration snippet')
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain(
      'https://corecode.live/setup.md'
    )
    expect(writeText.mock.calls[0][0]).toContain('sk-full-secret-value')
  })
})

describe('OnboardingWaitStep', () => {
  it('turns green when the request count goes from 0 to above 0', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await renderWithProviders(
      <OnboardingWaitStep client='claude-code' baselineRequests={0} />
    )
    expect(
      await screen.findByText('Waiting for your first request…')
    ).toBeInTheDocument()
    expect(screen.queryByText('First request received ✓')).toBeNull()

    mock.requestCount = 1
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ONBOARDING_POLL_MS + 100)
    })
    expect(
      await screen.findByText('First request received ✓')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /See pricing/ })).toHaveAttribute(
      'href',
      '/pricing'
    )
  })

  it('stops polling after it is unmounted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const view = await renderWithProviders(
      <OnboardingWaitStep client='claude-code' baselineRequests={0} />
    )
    await screen.findByText('Waiting for your first request…')
    view.unmount()
    const before = vi.mocked(api.get).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ONBOARDING_POLL_MS * 3)
    })
    expect(vi.mocked(api.get).mock.calls.length).toBe(before)
  })
})

describe('OnboardingLauncher', () => {
  it('opens the wizard once for an account with no request', async () => {
    await renderWithProviders(<OnboardingLauncher />)

    expect(await screen.findByText('Choose your client')).toBeInTheDocument()
    expect(window.localStorage.getItem(onboardingDismissKey(5))).not.toBeNull()
  })

  it('does not reopen by itself once dismissed, but keeps the reopen card', async () => {
    dismissOnboarding(5)
    await renderWithProviders(<OnboardingLauncher />)

    expect(
      await screen.findByRole('button', { name: /Set up a client/ })
    ).toBeInTheDocument()
    expect(screen.queryByText('Choose your client')).toBeNull()
  })
})
