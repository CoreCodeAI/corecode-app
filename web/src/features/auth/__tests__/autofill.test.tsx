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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { ForgotPasswordForm } from '../forgot-password/components/forgot-password-form'
import { UserAuthForm } from '../sign-in/components/user-auth-form'
import { SignUpForm } from '../sign-up/components/sign-up-form'

async function renderForm(
  component: () => React.JSX.Element,
  status: Record<string, unknown> = {}
) {
  const root = createRootRoute({ component: Outlet })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, status)
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await router.load()
}

beforeAll(() => {
  document.elementFromPoint ??= () => null
})

afterEach(() => {
  cleanup()
})

it('marks the sign-in fields as the saved username and current password for password managers', async () => {
  await renderForm(() => <UserAuthForm />)

  expect(await screen.findByLabelText('Username or Email')).toHaveAttribute(
    'autocomplete',
    'username'
  )
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'autocomplete',
    'current-password'
  )
})

it('marks the sign-up fields so browsers offer a new password and fill the emailed code', async () => {
  await renderForm(() => <SignUpForm />, { email_verification: true })

  expect(await screen.findByLabelText('Username')).toHaveAttribute(
    'autocomplete',
    'username'
  )
  expect(screen.getByLabelText('Password')).toHaveAttribute(
    'autocomplete',
    'new-password'
  )
  expect(screen.getByLabelText('Confirm password')).toHaveAttribute(
    'autocomplete',
    'new-password'
  )
  expect(
    screen.getByLabelText('Email (required for verification)')
  ).toHaveAttribute('autocomplete', 'email')
  const code = screen.getByRole('textbox', { name: 'Verification code' })
  expect(code).toHaveAttribute('autocomplete', 'one-time-code')
  // The emailed code is hexadecimal, so a numeric keyboard would hide letters.
  expect(code).not.toHaveAttribute('inputmode')
  expect(code).toHaveAttribute('autocapitalize', 'none')
})

it('offers the email keyboard and saved address on the forgot-password form without native validation', async () => {
  await renderForm(() => <ForgotPasswordForm />)

  const email = await screen.findByLabelText('Email')
  expect(email).toHaveAttribute('autocomplete', 'email')
  expect(email).toHaveAttribute('inputmode', 'email')
  expect(email).not.toHaveAttribute('type', 'email')
})
