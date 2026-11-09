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
import { AxiosError } from 'axios'
import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { AuthOperationError, authErrorMessage } from '@/lib/secure-verification'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { LegalConsent } from '../components/legal-consent'
import { MagicLinkForm } from '../sign-in/components/magic-link-form'
import { SignUp } from '../sign-up'

const resolveAuthentication = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAuthentication,
}))

function renderInRouter(
  component: () => React.JSX.Element,
  initialPath: string,
  status: Record<string, unknown> = {}
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
    history: createMemoryHistory({ initialEntries: [initialPath] }),
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

function SignInHarness() {
  return <MagicLinkForm redirectTo='/pricing' />
}

async function submitEmail(
  user: ReturnType<typeof userEvent.setup>,
  email = 'someone@example.com'
) {
  const emailInput = await screen.findByLabelText('Email')
  await user.clear(emailInput)
  await user.type(emailInput, email)
  await user.click(screen.getByRole('button', { name: /Send sign-in code/ }))
}

function axiosFailure(status: number, data: Record<string, unknown> = {}) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    { status, data, statusText: '', headers: {}, config: {} as never }
  )
}

beforeAll(() => {
  document.elementFromPoint ??= () => null
})

afterEach(() => {
  window.localStorage.removeItem('aff')
  cleanup()
  vi.restoreAllMocks()
  delete window.turnstile
  useAuthStore.getState().auth.reset('idle')
})

describe('resend cooldown follows the address', () => {
  it('lets a different address send at once and keeps the countdown for the same one', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, resend_after: 45 } } as never)
    renderInRouter(SignInHarness, '/')
    const user = userEvent.setup()
    await submitEmail(user)
    await user.click(
      await screen.findByRole('button', { name: /Use a different email/ })
    )

    // Same address: the countdown still holds the send.
    expect(
      await screen.findByRole('button', { name: /Resend code \(\d+s\)/ })
    ).toBeDisabled()

    const input = screen.getByLabelText('Email')
    await user.clear(input)
    await user.type(input, 'other@example.com')
    const send = screen.getByRole('button', { name: /Send sign-in code/ })
    expect(send).toBeEnabled()
    await user.click(send)

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post.mock.calls[1][1]).toMatchObject({ email: 'other@example.com' })
  })
})

describe('auth error text', () => {
  it('maps 429 and 5xx to translated source keys and keeps a localized server reason', () => {
    expect(AuthOperationError.from(axiosFailure(429)).message).toBe(
      'Too many attempts. Please wait a minute and try again.'
    )
    expect(AuthOperationError.from(axiosFailure(503)).message).toBe(
      'Please try again later.'
    )
    expect(
      AuthOperationError.from(
        axiosFailure(429, { message_key: 'Verification flow expired' })
      ).message
    ).toBe('Verification flow expired')
    expect(
      AuthOperationError.from(new AxiosError('Network Error', 'ERR_NETWORK'))
        .message
    ).toBe('Please try again later.')
  })

  it('renders the mapped text in the active language', async () => {
    await i18next.addResourceBundle(
      'zh',
      'translation',
      {
        'Too many attempts. Please wait a minute and try again.':
          '尝试次数过多，请等待一分钟后再试。',
      },
      true,
      true
    )
    await i18next.changeLanguage('zh')
    try {
      expect(authErrorMessage(axiosFailure(429))).toBe(
        '尝试次数过多，请等待一分钟后再试。'
      )
    } finally {
      await i18next.changeLanguage('en')
    }
  })

  it('shows a rate-limited code check as a translated message, not the Axios text', async () => {
    vi.spyOn(api, 'post').mockImplementation(((url: string) =>
      url === '/api/magic_link/send'
        ? Promise.resolve({ data: { success: true, resend_after: 45 } })
        : Promise.reject(axiosFailure(429))) as never)
    renderInRouter(SignInHarness, '/')
    const user = userEvent.setup()
    await submitEmail(user)
    await user.type(await screen.findByLabelText('Sign-in code'), '000000')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Please wait a minute and try again.'
    )
  })
})

describe('legal consent conjunction', () => {
  it('translates the word joining the two documents', async () => {
    await i18next.addResourceBundle(
      'zh',
      'translation',
      { and: '和', 'User Agreement': '用户协议', 'Privacy Policy': '隐私政策' },
      true,
      true
    )
    await i18next.changeLanguage('zh')
    try {
      const { container } = render(
        <LegalConsent
          status={
            {
              user_agreement_enabled: true,
              privacy_policy_enabled: true,
            } as never
          }
          checked
          onCheckedChange={() => undefined}
        />
      )
      expect(container.textContent).toContain('用户协议 和 隐私政策')
      expect(container.textContent).not.toContain(' and the ')
    } finally {
      await i18next.changeLanguage('en')
    }
  })
})

describe('sign-up redirect', () => {
  it('carries redirect into the sign-in link and the emailed link request', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, resend_after: 45 } } as never)
    renderInRouter(SignUp, '/?redirect=%2Fpricing', {
      magic_link_enabled: true,
      magic_link_register_enabled: true,
    })

    const link = await screen.findByRole('link', { name: 'Sign in' })
    expect(link.getAttribute('href')).toContain('redirect=%2Fpricing')

    await submitEmail(userEvent.setup())
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][1]).toMatchObject({ redirect: '/pricing' })
  })
})

describe('sign-up route guard', () => {
  it('sends an already authenticated visitor on to the safe redirect', async () => {
    resolveAuthentication.mockImplementation(() => {
      useAuthStore.getState().auth.setUser({ id: 1, username: 'u', role: 1 })
      return Promise.resolve()
    })
    const { Route } = await import('@/routes/(auth)/sign-up')
    const beforeLoad = Route.options.beforeLoad as (ctx: {
      search: { redirect?: string }
    }) => Promise<void>

    const thrown = await beforeLoad({ search: { redirect: '/pricing' } }).catch(
      (error: unknown) => error
    )

    expect(resolveAuthentication).toHaveBeenCalled()
    expect(thrown).toMatchObject({ options: { href: '/pricing' } })
  })
})

describe('code step behaviour', () => {
  it('refocuses the code field after a wrong code', async () => {
    vi.spyOn(api, 'post').mockImplementation(((url: string) =>
      Promise.resolve({
        data:
          url === '/api/magic_link/send'
            ? { success: true, resend_after: 45 }
            : { success: false },
      })) as never)
    renderInRouter(SignInHarness, '/')
    const user = userEvent.setup()
    await submitEmail(user)
    const input = await screen.findByLabelText('Sign-in code')
    await user.type(input, '000000')

    await screen.findByRole('alert')
    await waitFor(() => expect(input).toHaveFocus())
  })

  it('keeps Resend disabled as "Verifying…" until the human check has a token', async () => {
    let calls = 0
    let solveResend!: () => void
    window.turnstile = {
      render: vi.fn((_el: HTMLElement, options: Record<string, unknown>) => {
        calls += 1
        const callback = options.callback as (token: string) => void
        if (calls === 1) callback('token-1')
        else solveResend = () => callback('token-2')
      }),
    }
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, resend_after: 0 },
    } as never)
    renderInRouter(SignInHarness, '/', {
      turnstile_check: true,
      turnstile_site_key: 'site',
    })
    await submitEmail(userEvent.setup())

    const pending = await screen.findByRole('button', { name: 'Verifying…' })
    expect(pending).toBeDisabled()
    solveResend()
    expect(
      await screen.findByRole('button', { name: 'Resend code' })
    ).toBeEnabled()
  })
})

describe('consent hint beside OAuth buttons', () => {
  it('explains the disabled buttons while the terms are unchecked', async () => {
    renderInRouter(() => <MagicLinkForm showOAuthProviders />, '/', {
      github_oauth: true,
      user_agreement_enabled: true,
      privacy_policy_enabled: true,
    })
    const user = userEvent.setup()
    expect(
      screen.queryByText('Agree to the terms below to continue.')
    ).toBeNull()
    await user.click(await screen.findByRole('checkbox'))

    expect(
      screen.getByText('Agree to the terms below to continue.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Continue with GitHub/ })
    ).toBeDisabled()
  })
})
