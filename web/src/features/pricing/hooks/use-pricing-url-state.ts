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
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useRef } from 'react'

import {
  DEFAULT_BOARD_SORT,
  parseBoardSort,
  type BoardSort,
} from '../lib/board-rows'

const route = getRouteApi('/pricing/')

/**
 * CoreCode fork: the pricing page's search text, sort key and open model live
 * in the URL (`?search=&sort=&model=`), so a link reproduces the view. Opening
 * a model adds a history entry, so Back closes its drawer; a visitor who landed
 * on a link with `model` already set closes it without leaving the page.
 */
export function usePricingUrlState() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const router = useRouter()
  const openedHere = useRef(false)

  const setSearch = useCallback(
    (value: string) => {
      void navigate({
        search: (prev) => ({ ...prev, search: value || undefined }),
        replace: true,
      })
    },
    [navigate]
  )

  const setSort = useCallback(
    (value: BoardSort) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          sort: value === DEFAULT_BOARD_SORT ? undefined : value,
        }),
        replace: true,
      })
    },
    [navigate]
  )

  const openModel = useCallback(
    (name: string) => {
      openedHere.current = true
      void navigate({ search: (prev) => ({ ...prev, model: name }) })
    },
    [navigate]
  )

  const closeModel = useCallback(() => {
    if (openedHere.current) {
      openedHere.current = false
      router.history.back()
      return
    }
    void navigate({
      search: (prev) => ({ ...prev, model: undefined }),
      replace: true,
    })
  }, [navigate, router])

  return {
    search: search.search ?? '',
    sort: parseBoardSort(search.sort),
    model: search.model ?? null,
    setSearch,
    setSort,
    openModel,
    closeModel,
  }
}
