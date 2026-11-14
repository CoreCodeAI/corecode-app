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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { ServiceStatus } from '..'
import type { ServiceStatusData } from '../types'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to: string; children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

vi.mock('@/components/layout', () => ({
  SectionPageLayout: Object.assign(
    (props: { children: ReactNode }) => <div>{props.children}</div>,
    {
      Title: (props: { children: ReactNode }) => <h1>{props.children}</h1>,
      Actions: (props: { children: ReactNode }) => <div>{props.children}</div>,
      Content: (props: { children: ReactNode }) => <div>{props.children}</div>,
    }
  ),
}))

const NOW = Date.UTC(2026, 10, 11, 8) / 1000

function statusData(
  overrides: Partial<ServiceStatusData> = {}
): ServiceStatusData {
  const hours = Array.from(
    { length: 24 },
    (_, index) => NOW - (24 - index) * 3600
  )
  return {
    version: 1,
    generated_at: NOW - 60,
    status: 'operational',
    maintenance: false,
    current: {
      window_s: 600,
      requests: 486,
      success_rate: 0.9979,
      p50_ms: 963,
    },
    day: {
      bucket_s: 3600,
      buckets: hours.map((t) => ({
        t,
        requests: 100,
        success_rate: 1,
        p50_ms: 1200,
        state: 'ok',
      })),
    },
    week: { bucket_s: 21600, buckets: [] },
    groups: [
      {
        name: 'Claude 满血（仅限CC）',
        ratio: 1.9,
        model: 'claude-opus-5-5',
        state: 'ok',
        success_rate: 0.9995,
        p50_ms: 1359,
        latency: 'ttft',
        cache_hit_rate: 0.9693,
        buckets: hours.map((t, index) =>
          index === 23
            ? { t, state: 'none', success_rate: null, p50_ms: null }
            : {
                t,
                state: 'ok',
                success_rate: 0.98,
                p50_ms: 1500,
                cache_hit_rate: 0.97,
              }
        ),
      },
    ],
    ...overrides,
  }
}

function respond(data: unknown, serverNow = NOW, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(data), {
          status,
          headers: { date: new Date(serverNow * 1000).toUTCString() },
        })
    )
  )
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ServiceStatus />
    </QueryClientProvider>
  )
}

beforeEach(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('reads the status page data and shows the overall state and each group', async () => {
  respond(statusData())
  renderPage()
  expect(await screen.findByText('All systems operational')).toBeTruthy()
  expect(screen.getByText('Claude 满血（仅限CC）')).toBeTruthy()
  expect(screen.getByText('claude-opus-5-5')).toBeTruthy()
  // The busiest model names the vendor.
  expect(screen.getByText('Anthropic')).toBeTruthy()
  expect(
    screen.getByRole('link', { name: 'Create API Key' }).getAttribute('href')
  ).toBe('/keys')
  expect(screen.getByText('99.79%')).toBeTruthy()
  const fetchMock = vi.mocked(fetch)
  expect(String(fetchMock.mock.calls[0][0])).toMatch(
    /^\/status\/status\.json\?t=/
  )
})

it('says an update is rolling out during maintenance', async () => {
  respond(statusData({ maintenance: true }))
  renderPage()
  expect(
    await screen.findByText(
      'An update is rolling out; a few requests may need a retry.'
    )
  ).toBeTruthy()
})

it('shows the status as unknown once the data is older than 10 minutes by the server clock', async () => {
  respond(statusData(), NOW + 15 * 60)
  renderPage()
  expect(await screen.findByText('Status unknown')).toBeTruthy()
  expect(screen.queryByText('All systems operational')).toBeNull()
  // The history still shows.
  expect(screen.getByText('Claude 满血（仅限CC）')).toBeTruthy()
})

it('shows the status as unknown when the data cannot be read', async () => {
  respond({}, NOW, 502)
  renderPage()
  expect(await screen.findByText('Status unknown')).toBeTruthy()
  expect(
    screen.getByText(
      'Monitoring data cannot be read right now, so the current status cannot be confirmed. Refresh later to retry.'
    )
  ).toBeTruthy()
})

it('reads out the hour under the pointer, and the last active hour otherwise', async () => {
  respond(statusData())
  renderPage()
  const strip = await screen.findByRole('img', {
    name: 'Claude 满血（仅限CC）: success rate each hour over the last 24 hours',
  })
  expect(strip.parentElement?.textContent).toMatch(/Last requests/)
  vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 240,
  } as DOMRect)
  // x = 5 lands in the first hour; x = 239 in the last, which had no requests.
  fireEvent.pointerMove(strip, { clientX: 5, pointerType: 'mouse' })
  await waitFor(() =>
    expect(strip.parentElement?.textContent).toMatch(/Success rate 98\.0%/)
  )
  fireEvent.pointerMove(strip, { clientX: 239, pointerType: 'mouse' })
  await waitFor(() =>
    expect(strip.parentElement?.textContent).toMatch(/No requests/)
  )
})

it('filters the group cards by platform', async () => {
  const [base] = statusData().groups ?? []
  respond(
    statusData({
      groups: [
        base,
        { ...base, name: 'GPT', model: 'gpt-6.1-sol' },
        { ...base, name: 'GPT 福利', model: 'gpt-6.1-sol' },
      ],
    })
  )
  renderPage()
  const filter = await screen.findByRole('group', { name: 'Platform' })
  expect(filter.textContent).toContain('All platforms3')
  expect(filter.textContent).toContain('OpenAI2')
  expect(filter.textContent).toContain('Anthropic1')

  fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }))
  await waitFor(() =>
    expect(screen.queryByText('Claude 满血（仅限CC）')).toBeNull()
  )
  expect(screen.getByText('GPT 福利')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /^All platforms/ }))
  expect(await screen.findByText('Claude 满血（仅限CC）')).toBeTruthy()
})

it('shows no platform filter when every group has one vendor', async () => {
  respond(statusData())
  renderPage()
  await screen.findByText('Claude 满血（仅限CC）')
  expect(screen.queryByRole('group', { name: 'Platform' })).toBeNull()
})

const OFFICIAL: ServiceStatusData['official'] = [
  {
    vendor: 'anthropic',
    name: 'Anthropic',
    url: 'https://status.claude.com',
    state: 'outage',
    description: 'Partial System Outage',
    components: [
      { name: 'Claude API', status: 'partial_outage' },
      { name: 'Claude Code', status: 'operational' },
    ],
    incidents: [
      {
        name: 'Elevated errors on the Claude API',
        impact: 'major',
        status: 'investigating',
        started_at: NOW - 600,
        url: 'https://stspg.io/x',
      },
    ],
  },
  {
    vendor: 'openai',
    name: 'OpenAI',
    url: 'https://status.openai.com',
    state: 'ok',
    description: 'All Systems Operational',
    components: [{ name: 'Codex API', status: 'operational' }],
    incidents: [],
  },
]

it('names an upstream outage as the vendor’s, beside our own state', async () => {
  respond(statusData({ official: OFFICIAL }))
  renderPage()
  // Our own state is unchanged by the vendor's.
  expect(await screen.findByText('All systems operational')).toBeTruthy()
  const banner = screen.getByText(
    'Anthropic official status is abnormal (not a CoreCode issue):'
  ).parentElement?.parentElement
  expect(banner?.textContent).toContain(
    'Claude API Partial outage · Elevated errors on the Claude API'
  )
  expect(banner?.querySelector('a')?.getAttribute('href')).toBe(
    'https://stspg.io/x'
  )
  expect(
    screen.queryByText(
      'OpenAI official status is abnormal (not a CoreCode issue):'
    )
  ).toBeNull()
  const panel = screen.getByRole('region', { name: 'Official upstream status' })
  expect(panel.textContent).toContain('Codex API')
  expect(panel.textContent).toContain('Outage')
})

it('hides another vendor’s outage banner while filtering by platform', async () => {
  const [base] = statusData().groups ?? []
  respond(
    statusData({
      official: OFFICIAL,
      groups: [base, { ...base, name: 'GPT', model: 'gpt-6.1-sol' }],
    })
  )
  renderPage()
  const banner = 'Anthropic official status is abnormal (not a CoreCode issue):'
  expect(await screen.findByText(banner)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^OpenAI/ }))
  await waitFor(() => expect(screen.queryByText(banner)).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: /^Anthropic/ }))
  expect(await screen.findByText(banner)).toBeTruthy()
})

it('shows no vendor status while every vendor is normal', async () => {
  respond(
    statusData({
      official: OFFICIAL?.map((entry) => ({
        ...entry,
        state: 'ok' as const,
        components: entry.components.map((component) => ({
          ...component,
          status: 'operational' as const,
        })),
        incidents: [],
      })),
    })
  )
  renderPage()
  expect(await screen.findByText('All systems operational')).toBeTruthy()
  expect(
    screen.queryByRole('region', { name: 'Official upstream status' })
  ).toBeNull()
})

it('shows no vendor status from stale or older data', async () => {
  respond(statusData({ official: OFFICIAL }), NOW + 15 * 60)
  renderPage()
  expect(await screen.findByText('Status unknown')).toBeTruthy()
  expect(
    screen.queryByRole('region', { name: 'Official upstream status' })
  ).toBeNull()
  cleanup()
  respond(statusData())
  renderPage()
  expect(await screen.findByText('All systems operational')).toBeTruthy()
  expect(
    screen.queryByRole('region', { name: 'Official upstream status' })
  ).toBeNull()
})
