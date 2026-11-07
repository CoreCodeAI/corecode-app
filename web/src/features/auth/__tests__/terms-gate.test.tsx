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
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { TermsConsentPrompt } from '../components/terms-consent-prompt'
import { SignUp } from '../sign-up'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}))

const VERSION = '2026-11-07'
const STORAGE_KEY = 'corecode_terms_consent'

function renderInRouter(
  component: () => React.JSX.Element,
  status: Record<string, unknown>
) {
  const root = createRootRoute({ component: Outlet })
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/', component }),
    createRoute({
      getParentRoute: () => root,
      path: '/sign-in',
      component: () => <div>Sign-in page</div>,
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

const gatedStatus = {
  terms_version: VERSION,
  user_agreement_enabled: true,
  privacy_policy_enabled: true,
  magic_link_enabled: true,
  magic_link_register_enabled: true,
}

function storeConsent(version: string) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version, accepted_at: '2026-11-07T00:00:00.000Z' })
  )
}

function signInAs(termsVersion?: string) {
  useAuthStore.getState().auth.setUser({
    id: 7,
    username: 'customer',
    role: 1,
    terms_version: termsVersion,
  })
}

// input-otp probes for password-manager badges with elementFromPoint, which
// jsdom does not implement.
beforeAll(() => {
  document.elementFromPoint ??= () => null
})

afterEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
  cleanup()
  vi.restoreAllMocks()
  toastError.mockReset()
  useAuthStore.getState().auth.reset('idle')
})

describe('TermsGate', () => {
  it('keeps the forms disabled until the visitor agrees', async () => {
    renderInRouter(SignUp, gatedStatus)
    const user = userEvent.setup()

    expect(
      await screen.findByRole('dialog', { name: /Terms update notice/ })
    ).toBeInTheDocument()
    expect(screen.getByText(VERSION)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Acceptable use policy/ })
    ).toHaveAttribute('href', '/user-agreement#aup')
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Send sign-in code/, hidden: true })
    ).toBeDisabled()
    // The dialog replaces the pre-checked consent box.
    expect(screen.queryByText(/I have read and agree to the/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Agree and continue' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('Email')).toBeEnabled()
    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    ).toMatchObject({ version: VERSION })
  })

  it('explains a refusal and reopens the terms on request', async () => {
    renderInRouter(SignUp, gatedStatus)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Decline' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toastError).toHaveBeenCalledWith(
      'You cannot sign up or use quick sign-in until you agree to the latest terms.'
    )
    expect(screen.getByLabelText('Email')).toBeDisabled()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'View terms' }))
    expect(
      await screen.findByRole('dialog', { name: /Terms update notice/ })
    ).toBeInTheDocument()
  })

  it('skips the dialog for a visitor who agreed to this version', async () => {
    storeConsent(VERSION)
    renderInRouter(SignUp, gatedStatus)

    expect(await screen.findByLabelText('Email')).toBeEnabled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks again when the terms changed since the visitor agreed', async () => {
    storeConsent('2026-11-04')
    renderInRouter(SignUp, gatedStatus)

    expect(
      await screen.findByRole('dialog', { name: /Terms update notice/ })
    ).toBeInTheDocument()
  })

  it('leaves the forms as they were when no terms version is set', async () => {
    renderInRouter(SignUp, { ...gatedStatus, terms_version: '' })

    expect(await screen.findByLabelText('Email')).toBeEnabled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/I have read and agree to the/)).toBeInTheDocument()
  })
})

describe('TermsConsentPrompt', () => {
  it('records an agreement given before sign-in without asking again', async () => {
    storeConsent(VERSION)
    signInAs('')
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { terms_version: VERSION } },
    } as never)

    renderInRouter(TermsConsentPrompt, { terms_version: VERSION })

    await waitFor(() =>
      expect(useAuthStore.getState().auth.user?.terms_version).toBe(VERSION)
    )
    expect(post).toHaveBeenCalledWith(
      '/api/user/terms/consent',
      { version: VERSION },
      { skipErrorHandler: true }
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks a signed-in customer without a record and cannot be dismissed', async () => {
    signInAs('2026-11-04')
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { terms_version: VERSION } },
    } as never)

    renderInRouter(TermsConsentPrompt, { terms_version: VERSION })
    const user = userEvent.setup()

    const dialog = await screen.findByRole('dialog', {
      name: /Terms update notice/,
    })
    expect(post).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agree and continue' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(post).toHaveBeenCalledWith(
      '/api/user/terms/consent',
      { version: VERSION },
      { skipErrorHandler: true }
    )
    expect(useAuthStore.getState().auth.user?.terms_version).toBe(VERSION)
  })

  it('signs the customer out on refusal', async () => {
    signInAs('')
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true } } as never)

    renderInRouter(TermsConsentPrompt, { terms_version: VERSION })
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Decline' }))

    expect(await screen.findByText('Sign-in page')).toBeInTheDocument()
    expect(post.mock.calls[0][0]).toBe('/api/user/auth/logout')
    expect(
      post.mock.calls.some((call) => call[0] === '/api/user/terms/consent')
    ).toBe(false)
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('stays quiet against a server that sends no terms version', async () => {
    signInAs(undefined)
    const post = vi.spyOn(api, 'post')

    renderInRouter(TermsConsentPrompt, {})

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(post).not.toHaveBeenCalled()
  })
})
