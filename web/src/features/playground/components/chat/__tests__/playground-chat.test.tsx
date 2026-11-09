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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { MESSAGE_STATUS } from '../../../constants'
import type { Message } from '../../../types'
import { PlaygroundChat } from '../playground-chat'

function userMessage(index: number): Message {
  return {
    key: `user-${index}`,
    from: 'user',
    versions: [{ id: `v${index}`, content: `question number ${index}` }],
  }
}

function errorMessage(content: string, errorCode?: string): Message {
  return {
    key: 'error-1',
    from: 'assistant',
    status: MESSAGE_STATUS.ERROR,
    errorCode,
    versions: [{ id: 'e1', content }],
  }
}

async function renderChat(messages: Message[]) {
  const root = createRootRoute()
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <TooltipProvider>
        <PlaygroundChat
          messages={messages}
          onRegenerateMessage={vi.fn()}
          onEditMessage={vi.fn()}
          onDeleteMessage={vi.fn()}
        />
      </TooltipProvider>
    ),
  })
  const wallet = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([page, wallet]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('log')
}

afterEach(cleanup)

it('keeps only the latest 24 messages and offers the earlier ones', async () => {
  await renderChat(Array.from({ length: 30 }, (_, index) => userMessage(index)))

  expect(screen.queryByText('question number 5')).not.toBeInTheDocument()
  expect(screen.getByText('question number 6')).toBeVisible()

  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Show 6 earlier messages' }))

  expect(screen.getByText('question number 0')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /earlier messages/ })
  ).not.toBeInTheDocument()
})

it('has no earlier-messages control for a short conversation', async () => {
  await renderChat(Array.from({ length: 24 }, (_, index) => userMessage(index)))

  expect(
    screen.queryByRole('button', { name: /earlier messages/ })
  ).not.toBeInTheDocument()
})

it('turns an insufficient-balance error into a top-up prompt without Retry', async () => {
  const raw = '用户额度不足, 剩余额度: ＄0.000000'
  await renderChat([
    userMessage(1),
    errorMessage(raw, 'insufficient_user_quota'),
  ])

  const alert = screen.getByRole('alert')
  expect(within(alert).getByText('Insufficient balance')).toBeVisible()
  expect(screen.queryByText(raw)).not.toBeInTheDocument()
  expect(within(alert).getByText('Go to top up').closest('a')).toHaveAttribute(
    'href',
    '/wallet'
  )
  expect(
    screen.queryByRole('button', { name: 'Retry' })
  ).not.toBeInTheDocument()
  // Editing the prompt and deleting the failed reply remain, beside the user message's own.
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
  expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2)
})

it('keeps the raw alert and Retry for any other error', async () => {
  await renderChat([
    userMessage(1),
    errorMessage('upstream timed out', 'bad_response_status_code'),
  ])

  expect(screen.getByText('upstream timed out')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible()
  expect(screen.queryByText('Go to top up')).not.toBeInTheDocument()
})
