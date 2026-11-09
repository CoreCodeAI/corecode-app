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
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { ModelDetailsApi } from '../components/model-details-api'
import {
  buildClaudeCodeSample,
  claudeCodeBaseUrl,
  isClaudeModelName,
} from '../lib/code-samples'
import type { PricingModel } from '../types'

function model(name: string): PricingModel {
  return {
    id: 1,
    model_name: name,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    supported_endpoint_types: ['anthropic'],
  }
}

const endpointMap = { anthropic: { path: '/v1/messages', method: 'POST' } }

async function renderApi(name: string) {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <ModelDetailsApi model={model(name)} endpointMap={endpointMap} />
    ),
  })
  const sink = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null })
  const router = createRouter({
    routeTree: root.addChildren([
      page,
      sink('/sign-up'),
      sink('/keys'),
      sink('/playground'),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByText('Code samples')
  return router
}

/** The call-to-action text sits in the anchor Button renders. */
function cta(text: string) {
  return screen.getByText(text).closest('a')
}

function signIn() {
  useAuthStore.setState((state) => ({
    auth: { ...state.auth, user: { id: 1, username: 'a', role: 1 } as never },
  }))
}

afterEach(() => {
  cleanup()
  useAuthStore.setState((state) => ({ auth: { ...state.auth, user: null } }))
  vi.restoreAllMocks()
})

it('builds a Claude Code setup on the bare origin, never /v1', () => {
  const sample = buildClaudeCodeSample(
    'https://corecode.live/v1/',
    'claude-opus-5-5'
  )

  expect(claudeCodeBaseUrl('https://corecode.live/')).toBe(
    'https://corecode.live'
  )
  expect(sample).toContain('"ANTHROPIC_BASE_URL": "https://corecode.live"')
  expect(sample).toContain('"ANTHROPIC_AUTH_TOKEN": "<CORECODE_API_KEY>"')
  expect(sample).toContain('claude --model claude-opus-5-5')
  expect(sample).not.toContain('/v1')
})

it('recognises Claude models by name', () => {
  expect(isClaudeModelName('claude-opus-5-5')).toBe(true)
  expect(isClaudeModelName('gpt-6')).toBe(false)
})

it('opens a Claude model on its Claude Code sample', async () => {
  await renderApi('claude-opus-5-5')

  expect(screen.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await waitFor(() =>
    expect(document.body.textContent).toContain(
      'claude --model claude-opus-5-5'
    )
  )
  expect(document.body.textContent).toContain('ANTHROPIC_AUTH_TOKEN')
})

it('offers no Claude Code sample for another vendor', async () => {
  await renderApi('gpt-6')

  expect(screen.queryByRole('tab', { name: 'Claude Code' })).toBeNull()
  await waitFor(() => expect(document.body.textContent).toContain('curl '))
})

it('uses one key name in every sample', async () => {
  await renderApi('claude-opus-5-5')
  const user = userEvent.setup()
  for (const tab of ['cURL', 'Python', 'TypeScript', 'JavaScript']) {
    await user.click(screen.getByRole('tab', { name: tab }))
    await waitFor(() =>
      expect(document.body.textContent).toContain('CORECODE_API_KEY')
    )
    expect(document.body.textContent).not.toContain('NEW_API_KEY')
    expect(document.body.textContent).not.toContain('YOUR_API_KEY')
  }
})

it('sends a visitor to sign up', async () => {
  await renderApi('claude-opus-5-5')

  expect(cta('Sign up to get started')).toHaveAttribute('href', '/sign-up')
  expect(screen.queryByText('Create an API key')).toBeNull()
})

it('sends a signed-in customer to create a key or try the model', async () => {
  signIn()
  await renderApi('claude-opus-5-5')

  expect(cta('Create an API key')).toHaveAttribute('href', '/keys')
  expect(cta('Try in the playground')).toHaveAttribute(
    'href',
    '/playground?model=claude-opus-5-5'
  )
  expect(screen.queryByText('Sign up to get started')).toBeNull()
})
