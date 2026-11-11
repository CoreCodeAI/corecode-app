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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import type { ApiKey } from '../../types'
import { ClientSetupGuide } from '../client-setup-guide'

let client: QueryClient

const key = (fields: Partial<ApiKey>): ApiKey =>
  ({
    id: 7,
    name: 'laptop',
    key: 'abcd**********wxyz',
    status: 1,
    ...fields,
  }) as ApiKey

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'CoreCode',
    server_address: 'https://corecode.live/v1',
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: ['claude-opus-5-5'] },
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderGuide(keys: ApiKey[]) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <ClientSetupGuide keys={keys} />,
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('ClientSetupGuide', () => {
  it('shows the root base URL and a masked key, never the stored secret', async () => {
    await renderGuide([key({})])

    const snippet = await screen.findByLabelText('Configuration snippet')
    expect(snippet).toHaveTextContent(
      '"ANTHROPIC_BASE_URL": "https://corecode.live"'
    )
    expect(snippet).toHaveTextContent('sk-abcd…wxyz')
    expect(snippet).not.toHaveTextContent('/v1')
  })

  it('copies the snippet with the full key fetched for the selected key', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { key: 'full-secret-value' } },
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await renderGuide([key({})])

    await user.click(screen.getByRole('tab', { name: 'macOS / Linux' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/api/token/7/key')
    expect(writeText.mock.calls[0][0]).toBe(
      [
        'export ANTHROPIC_BASE_URL=https://corecode.live',
        'export ANTHROPIC_AUTH_TOKEN=sk-full-secret-value',
        'claude',
      ].join('\n')
    )
  })

  it('starts the clipboard write during the click, before the full key arrives', async () => {
    const user = userEvent.setup()
    let answerKeyRequest: (value: unknown) => void = () => {}
    vi.spyOn(api, 'post').mockReturnValue(
      new Promise((resolve) => {
        answerKeyRequest = resolve
      })
    )
    class ClipboardItemStub {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)
    const write = vi.fn(async (items: ClipboardItemStub[]) => {
      await items[0].items['text/plain']
    })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write, writeText },
    })
    await renderGuide([key({})])

    await user.click(screen.getByRole('tab', { name: 'macOS / Linux' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(write).toHaveBeenCalledTimes(1)
    answerKeyRequest({
      data: { success: true, data: { key: 'full-secret-value' } },
    })
    const blob = await write.mock.calls[0][0][0].items['text/plain']
    expect(await blob.text()).toContain(
      'export ANTHROPIC_AUTH_TOKEN=sk-full-secret-value'
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('does not copy anything when the full key cannot be fetched', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: false, message: 'denied' },
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await renderGuide([key({})])

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled()
    )
    expect(writeText).not.toHaveBeenCalled()
  })

  it('offers to create a key instead of copying the placeholder when no key is enabled', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await renderGuide([key({ status: 2 })])

    expect(await screen.findByText('Create with custom settings')).toBeVisible()
    expect(
      screen.getByText('Create with custom settings').closest('a')
    ).toHaveAttribute('href', '/keys')
    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      'sk-your-key'
    )
    expect(
      screen.queryByRole('button', { name: 'Copy' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Import to CC Switch' })
    ).not.toBeInTheDocument()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('creates a key inline, fills it into the snippet, and copies the real key', async () => {
    const user = userEvent.setup()
    const created = key({
      id: 99,
      name: 'claude-code',
      key: 'newk**********wxyz',
    })
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      if (url === '/api/user/self/groups') {
        return {
          data: {
            success: true,
            data: { default: { desc: 'Default', ratio: 1 } },
          },
        }
      }
      if (url === '/api/token/auto-groups') {
        return { data: { success: true, data: { groups: [], max_count: 3 } } }
      }
      if (url === '/api/token/99') {
        return { data: { success: true, data: created } }
      }
      return { data: { success: true, data: ['claude-opus-5-5'] } }
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
      if (url === '/api/token/') {
        return {
          data: { success: true, data: { id: 99, name: 'claude-code' } },
        }
      }
      return { data: { success: true, data: { key: 'real-new-secret' } } }
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    await renderGuide([])

    await user.click(
      await screen.findByRole('button', { name: 'Create API Key' })
    )

    const snippet = await screen.findByLabelText('Configuration snippet')
    await waitFor(() => expect(snippet).toHaveTextContent('sk-newk…wxyz'))
    expect(post).toHaveBeenCalledWith(
      '/api/token/',
      expect.objectContaining({
        name: 'claude-code',
        unlimited_quota: true,
        expired_time: -1,
        group: '',
      })
    )

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('sk-real-new-secret')
    expect(writeText.mock.calls[0][0]).not.toContain('sk-your-key')
  })

  it('says the snippet shows a masked key and Copy copies the full one', async () => {
    await renderGuide([key({})])

    expect(
      await screen.findByText(
        'The key is masked here. The Copy button copies the full key.'
      )
    ).toBeVisible()
  })

  it('opens CC Switch through an anchor, not a new tab, and hints at installing it', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { key: 'full-secret-value' } },
    })
    const open = vi.spyOn(window, 'open')
    const clicked: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this.href)
    })
    await renderGuide([key({})])

    await user.click(screen.getByRole('tab', { name: 'CC Switch' }))
    await user.click(
      screen.getByRole('button', { name: 'Import to CC Switch' })
    )

    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0]).toMatch(/^ccswitch:\/\//)
    expect(open).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Nothing happened? Install CC Switch first, or copy the config instead.'
      )
    ).toBeVisible()
  })

  it('lets the customer pick among several enabled keys', async () => {
    const user = userEvent.setup()
    await renderGuide([
      key({ id: 1, name: 'laptop', key: 'aaaa**********1111' }),
      key({ id: 2, name: 'ci', key: 'bbbb**********2222' }),
    ])

    await user.click(await screen.findByRole('combobox', { name: 'API key' }))
    await user.click(await screen.findByRole('option', { name: 'ci' }))

    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      'sk-bbbb…2222'
    )
  })

  it('offers only Claude Code for a Claude Code only group', async () => {
    mockGroupAndModels({ claude_code_only: true }, ['claude-opus-5-5'])
    await renderGuide([key({ group: 'cc' })])

    expect(
      await screen.findByRole('tab', { name: 'settings.json' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('tablist', { name: 'Client' })
    ).not.toBeInTheDocument()
  })

  it('offers Codex for a GPT group and shows its config.toml', async () => {
    const user = userEvent.setup()
    mockGroupAndModels({ claude_code_only: false }, ['gpt-6.1-sol'])
    await renderGuide([key({ group: 'cc' })])

    expect(await screen.findByRole('tab', { name: 'Codex' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.click(screen.getByRole('tab', { name: 'config.toml' }))
    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      'base_url = "https://corecode.live/v1"'
    )
    expect(screen.getByText('codex exec "Reply with ok"')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Magpie' }))
    expect(screen.getByLabelText('Configuration snippet')).toHaveTextContent(
      'magpie codex corecode/gpt-6.1-sol'
    )
    expect(
      screen.getByRole('button', { name: 'Add to Magpie' })
    ).toBeInTheDocument()
  })
})

function mockGroupAndModels(
  group: { claude_code_only: boolean },
  models: string[]
) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/user/self/groups') {
      return {
        data: { success: true, data: { cc: { desc: '', ratio: 1, ...group } } },
      }
    }
    return { data: { success: true, data: models } }
  })
}
