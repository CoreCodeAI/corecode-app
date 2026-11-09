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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import z from 'zod'

import { PriceBoard } from '../../components/price-board'
import type { PricingModel } from '../../types'
import { usePricingUrlState } from '../use-pricing-url-state'

const GROUP = 'Claude 满血'

function claude(id: number, name: string, input: number): PricingModel {
  return {
    id,
    model_name: name,
    quota_type: 0,
    model_ratio: input / 2,
    completion_ratio: 5,
    enable_groups: [GROUP],
  }
}

const models = [
  claude(1, 'claude-opus-5-5', 10),
  claude(2, 'claude-sonnet-5', 6),
]

function Page() {
  const url = usePricingUrlState()
  return (
    <>
      <PriceBoard
        models={models}
        groupRatio={{ [GROUP]: 1 }}
        usableGroup={{ [GROUP]: '' }}
        priceRate={1}
        usdExchangeRate={6.8}
        search={url.search}
        onSearchChange={url.setSearch}
        sort={url.sort}
        onSortChange={url.setSort}
        onModelClick={url.openModel}
      />
      {url.model && (
        <div role='dialog' aria-label='Model details'>
          {url.model}
          <button type='button' onClick={url.closeModel}>
            Close details
          </button>
        </div>
      )}
    </>
  )
}

async function renderAt(entry: string) {
  const root = createRootRoute()
  const pricing = createRoute({
    getParentRoute: () => root,
    path: '/pricing/',
    component: Page,
    validateSearch: z.object({
      search: z.string().optional(),
      sort: z.string().optional(),
      model: z.string().optional(),
    }),
  })
  const router = createRouter({
    routeTree: root.addChildren([pricing]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('searchbox', { name: 'Search models' })
  return router
}

function search(router: Awaited<ReturnType<typeof renderAt>>) {
  return router.state.location.search as Record<string, unknown>
}

afterEach(cleanup)

it('starts from the search text and sort in a shared link', async () => {
  await renderAt('/pricing/?search=opus&sort=output')

  expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveValue(
    'opus'
  )
  expect(
    screen.getAllByRole('button', { name: 'claude-opus-5-5' })
  ).not.toHaveLength(0)
  expect(
    screen.queryByRole('button', { name: 'claude-sonnet-5' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveTextContent(
    'Output price: low to high'
  )
})

it('writes the search text to the URL as the customer types', async () => {
  const router = await renderAt('/pricing/')
  await userEvent
    .setup()
    .type(screen.getByRole('searchbox', { name: 'Search models' }), 'son')

  await waitFor(() => expect(search(router).search).toBe('son'))
})

it('writes a non-default sort to the URL and drops the default one', async () => {
  const router = await renderAt('/pricing/')
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Sort' }))
  await user.click(
    await screen.findByRole('option', { name: 'Biggest savings first' })
  )
  await waitFor(() => expect(search(router).sort).toBe('savings'))

  await user.click(screen.getByRole('combobox', { name: 'Sort' }))
  await user.click(
    await screen.findByRole('option', { name: 'Input price: low to high' })
  )
  await waitFor(() => expect(search(router).sort).toBeUndefined())
})

it('opens a model into the URL, and Back closes it', async () => {
  const router = await renderAt('/pricing/')
  const user = userEvent.setup()
  await user.click(
    screen.getAllByRole('button', { name: 'claude-opus-5-5' })[0]
  )

  await waitFor(() => expect(search(router).model).toBe('claude-opus-5-5'))
  expect(screen.getByRole('dialog', { name: 'Model details' })).toBeVisible()

  router.history.back()
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Model details' })
    ).not.toBeInTheDocument()
  )
  expect(search(router).model).toBeUndefined()
})

it('opens the model of a shared link, and closing it stays on the page', async () => {
  const router = await renderAt('/pricing/?model=claude-sonnet-5')
  expect(
    screen.getByRole('dialog', { name: 'Model details' })
  ).toHaveTextContent('claude-sonnet-5')

  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Close details' }))
  await waitFor(() => expect(search(router).model).toBeUndefined())
  expect(router.state.location.pathname).toBe('/pricing')
})
