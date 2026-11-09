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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { ApiKey } from '../../types'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { useAuthStore } = await import('@/stores/auth-store')
const { ApiKeysProvider, useApiKeys } = await import('../api-keys-provider')
const { ApiKeysMutateDrawer } = await import('../api-keys-mutate-drawer')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
}
type RenderedDrawer = {
  queryClient: InstanceType<typeof QueryClient>
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
let renderedDrawer: RenderedDrawer | null = null

function installApiFixtures(createdPayloads: Array<Record<string, unknown>>) {
  apiClient.get = async (url) => {
    switch (url) {
      case '/api/token/41':
        return {
          data: {
            success: true,
            data: { id: 41, name: 'laptop', key: 'abcd****wxyz', status: 1 },
          },
        }
      case '/api/status':
        return { data: { data: { default_use_auto_group: true } } }
      case '/api/user/models':
        return { data: { success: true, data: [] } }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: {
              auto: { desc: 'Automatic routing', ratio: 'auto' },
              default: { desc: 'Standard access', ratio: 1 },
              vip: { desc: 'Priority access', ratio: 2 },
            },
          },
        }
      case '/api/token/auto-groups':
        return {
          data: {
            success: true,
            data: { groups: ['vip', 'default'], max_count: 3 },
          },
        }
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
  }
  apiClient.post = async (url, data) => {
    expect(url).toBe('/api/token/')
    expect(data && typeof data === 'object').toBeTruthy()
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: { id: 41, name: 'laptop' } } }
  }
}

const ALL_GROUPS = {
  auto: { desc: 'Automatic routing', ratio: 'auto' },
  default: { desc: 'Standard access', ratio: 1 },
  vip: { desc: 'Priority access', ratio: 2 },
}

async function renderCreateDrawer(
  groups: Record<string, object> = ALL_GROUPS
): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(
    ['status'],
    { default_use_auto_group: true },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-models'],
    { success: true, data: [] },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-groups'],
    { success: true, data: groups },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['token-auto-groups'],
    {
      success: true,
      data: { groups: ['vip', 'default'], max_count: 3 },
    },
    { updatedAt: freshAt }
  )
  renderedDrawer = { queryClient }

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ApiKeysProvider>
          <ApiKeysMutateDrawer open onOpenChange={() => undefined} />
          <DialogProbe />
          <Toaster />
        </ApiKeysProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
  await waitFor(
    () => {
      const saveButton = findButton(/Create key|Save changes/, false)
      expect(saveButton).toBeEnabled()
    },
    { timeout: 1500 }
  )
}

function DialogProbe() {
  const keys = useApiKeys()
  return (
    <output data-testid='dialog-probe'>
      {keys.open ?? 'none'}:{keys.currentRow?.name ?? ''}
    </output>
  )
}

function findButton(text: string | RegExp, required: true): HTMLButtonElement
function findButton(
  text: string | RegExp,
  required: false
): HTMLButtonElement | null
function findButton(
  text: string | RegExp,
  required = true
): HTMLButtonElement | null {
  const button = screen
    .queryAllByRole<HTMLButtonElement>('button')
    .find((candidate) =>
      typeof text === 'string'
        ? candidate.textContent?.includes(text)
        : text.test(candidate.textContent ?? '')
    )
  if (required && !button) {
    throw new Error(`Expected button containing "${text}"`)
  }
  return button ?? null
}

function getControlByLabel(labelText: 'Name' | 'Quantity'): HTMLInputElement
function getControlByLabel(labelText: 'Group'): HTMLButtonElement
function getControlByLabel(labelText: 'Auto group order'): HTMLElement
function getControlByLabel(labelText: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText
  )
  if (!label) {
    throw new Error(`Expected label "${labelText}"`)
  }

  const control =
    label.control ??
    label
      .closest('[data-slot="form-item"]')
      ?.querySelector<HTMLElement>(
        '[data-slot="form-control"], input, textarea, button[role="combobox"], [role="group"]'
      )
  if (!control) {
    throw new Error(`Expected control for label "${labelText}"`)
  }
  return control
}

function changeInput(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } })
}

beforeEach(() => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'customer', role: 1 })
})

afterEach(() => {
  useAuthStore.getState().auth.setUser(null)
  apiClient.get = originalGet
  apiClient.post = originalPost
  localStorage.clear()
  if (renderedDrawer) {
    renderedDrawer.queryClient.clear()
    renderedDrawer = null
  }
})

describe('API keys mutate drawer Auto group integration', () => {
  test('shows the fixed Auto order and sends an empty override for every batch-created key', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderCreateDrawer()

    const groupTrigger = getControlByLabel('Group')
    expect(groupTrigger.textContent?.includes('auto')).toBe(true)
    const order = document.querySelector(
      'ol[aria-labelledby="auto-group-order-label"]'
    )
    expect(
      [...(order?.querySelectorAll('li') ?? [])].map((item) => item.textContent)
    ).toEqual(['vip', 'default'])
    expect(order?.querySelector('button')).toBe(null)

    useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 10 })
    await waitFor(() => expect(getControlByLabel('Quantity')).toBeTruthy())
    changeInput(getControlByLabel('Name'), 'batch')
    changeInput(getControlByLabel('Quantity'), '2')
    fireEvent.click(findButton('Create key', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(2))

    expect(createdPayloads.length).toBe(2)
    expect(createdPayloads[0]?.name).toBe('batch')
    for (const payload of createdPayloads) {
      expect(payload.group).toBe('auto')
      expect(payload.auto_groups).toEqual([])
      expect(payload.cross_group_retry).toBe(true)
    }
  })

  test('starts a new key on the first Auto group when Auto is the default but not offered', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderCreateDrawer({
      default: ALL_GROUPS.default,
      vip: ALL_GROUPS.vip,
    })

    changeInput(getControlByLabel('Name'), 'laptop')
    fireEvent.click(findButton('Create key', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.group).toBe('vip')
  })
})

describe('API key create drawer for customers and admins', () => {
  test('hides the batch quantity from a customer and labels the button Create key', async () => {
    installApiFixtures([])
    await renderCreateDrawer()

    expect(screen.queryByText('Quantity')).not.toBeInTheDocument()
    expect(findButton('Create key', true)).toBeEnabled()
    expect(findButton('Save changes', false)).toBeNull()
  })

  test('reports how many keys a batch created when a later one fails', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    apiClient.post = async (_url, data) => {
      createdPayloads.push(data as Record<string, unknown>)
      if (createdPayloads.length === 2) {
        return { data: { success: false, message: 'quota' } }
      }
      return { data: { success: true, data: { id: 41, name: 'x' } } }
    }
    await renderCreateDrawer()
    useAuthStore.getState().auth.setUser({ id: 1, username: 'root', role: 10 })
    await waitFor(() => expect(getControlByLabel('Quantity')).toBeTruthy())
    changeInput(getControlByLabel('Name'), 'batch')
    changeInput(getControlByLabel('Quantity'), '3')
    fireEvent.click(findButton('Create key', true))

    expect(
      await screen.findByText('Created 1 of 3 API keys. The rest failed.')
    ).toBeInTheDocument()
    expect(createdPayloads).toHaveLength(2)
  })
})

describe('API key expiry across editing sessions', () => {
  test.each(['close', 'save'] as const)(
    'keeps an uncached key non-expiring after %s of a key with an expiry',
    async (finish) => {
      installApiFixtures([])
      const first: ApiKey = {
        id: 1,
        name: 'expiring',
        key: '',
        status: 1,
        remain_quota: 0,
        used_quota: 0,
        unlimited_quota: true,
        expired_time: 2000000000,
        created_time: 1,
        accessed_time: 0,
        group: 'default',
        auto_groups: [],
        cross_group_retry: false,
        model_limits_enabled: false,
        model_limits: '',
        allow_ips: '',
        allow_user_quota_query: true,
      }
      const second = { ...first, id: 2, name: 'non-expiring', expired_time: -1 }
      let resolveDetail!: (value: { data: unknown }) => void
      const detail = new Promise<{ data: unknown }>((resolve) => {
        resolveDetail = resolve
      })
      const getFixture = apiClient.get
      const get = vi.spyOn(apiClient, 'get').mockImplementation((url) => {
        if (url === '/api/token/1') {
          return Promise.resolve({ data: { success: true, data: first } })
        }
        if (url === '/api/token/2') return detail
        return getFixture(url)
      })
      const put = vi
        .spyOn(api, 'put')
        .mockResolvedValue({ data: { success: true } })
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      renderedDrawer = { queryClient }
      const close = vi.fn()
      const tree = (currentRow: ApiKey, open: boolean) => (
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <ApiKeysProvider>
              <ApiKeysMutateDrawer
                open={open}
                currentRow={currentRow}
                onOpenChange={close}
              />
            </ApiKeysProvider>
          </I18nextProvider>
        </QueryClientProvider>
      )
      const view = render(tree(first, true))
      await waitFor(() =>
        expect(findButton('Save changes', true)).toBeEnabled()
      )
      await waitFor(() => expect(screen.getByLabelText('Time')).toBeEnabled())

      if (finish === 'save') {
        fireEvent.click(findButton('Save changes', true))
        await waitFor(() => expect(put).toHaveBeenCalled())
        expect(put.mock.calls[0][1]).toMatchObject({
          id: 1,
          expired_time: 2000000000,
        })
      } else {
        fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
      }
      await waitFor(() => expect(close.mock.calls[0]?.[0]).toBe(false))
      view.rerender(tree(first, false))
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      view.rerender(tree(second, true))
      await waitFor(() => expect(get).toHaveBeenCalledWith('/api/token/2'))
      expect(findButton('Save changes', true)).toBeDisabled()
      await act(async () =>
        resolveDetail({ data: { success: true, data: second } })
      )
      await waitFor(() =>
        expect(findButton('Save changes', true)).toBeEnabled()
      )
      expect(
        screen.getByRole('button', { name: 'Never expires' })
      ).toBeVisible()
      expect(screen.getByLabelText('Time')).toBeDisabled()
      fireEvent.click(findButton('Save changes', true))
      await waitFor(() =>
        expect(put).toHaveBeenLastCalledWith(
          '/api/token/',
          expect.objectContaining({ id: 2, expired_time: -1 })
        )
      )
    }
  )

  test.each(['Never', 'Clear'])(
    'submits a non-expiring key when its date is cleared with %s',
    async (action) => {
      const payloads: Array<Record<string, unknown>> = []
      installApiFixtures(payloads)
      await renderCreateDrawer()
      changeInput(getControlByLabel('Name'), 'no-expiry')
      fireEvent.click(screen.getByRole('button', { name: '1 Month' }))
      expect(screen.getByLabelText('Time')).toBeEnabled()
      fireEvent.click(screen.getByRole('button', { name: action }))
      expect(
        screen.getByRole('button', { name: 'Never expires' })
      ).toBeVisible()
      expect(screen.getByLabelText('Time')).toBeDisabled()
      fireEvent.click(findButton('Create key', true))
      await waitFor(() => expect(payloads).toHaveLength(1))
      expect(payloads[0]?.expired_time).toBe(-1)
    }
  )
})

describe('API keys mutate drawer user quota query switch', () => {
  test('sends false for a new key after the switch, which starts on, is turned off', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderCreateDrawer()

    fireEvent.click(findButton('Advanced Settings', true))
    const quotaQuerySwitch = await screen.findByRole('switch', {
      name: 'Allow querying user quota',
    })
    expect(quotaQuerySwitch).toBeChecked()
    fireEvent.click(quotaQuerySwitch)
    expect(quotaQuerySwitch).not.toBeChecked()

    changeInput(getControlByLabel('Name'), 'no-user-quota')
    fireEvent.click(findButton('Create key', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.allow_user_quota_query).toBe(false)
  })

  test('opens the setup guide for a single new key', async () => {
    installApiFixtures([])
    await renderCreateDrawer()

    changeInput(getControlByLabel('Name'), 'laptop')
    fireEvent.click(findButton('Create key', true))

    await waitFor(() =>
      expect(screen.getByTestId('dialog-probe')).toHaveTextContent(
        'setup:laptop'
      )
    )
  })
})
