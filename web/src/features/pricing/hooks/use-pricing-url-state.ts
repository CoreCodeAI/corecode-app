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
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DEFAULT_BOARD_SORT,
  parseBoardSort,
  type BoardSort,
} from '../lib/board-rows'
import {
  defaultPriceCurrency,
  parsePriceCurrency,
  readStoredPriceCurrency,
  storePriceCurrency,
  type PriceCurrency,
  type PriceRates,
} from '../lib/price-currency'

const route = getRouteApi('/pricing/')

/**
 * CoreCode fork: the pricing page's search text, sort key, currency and open
 * model live in the URL (`?search=&sort=&currency=&model=`), so a link
 * reproduces the view. A picked currency is also remembered for later visits;
 * without either, it follows the reader's language (`defaultPriceCurrency`).
 * A pick is always written to the URL, even when it equals the reader's own
 * default, because a link without `currency` opens in each reader's default and
 * would change the sharer's view. Opening
 * a model adds a history entry, so Back closes its drawer; a visitor who landed
 * on a link with `model` already set closes it without leaving the page.
 */
export function usePricingUrlState(rates: Pick<PriceRates, 'hkdPerCny'> = {}) {
  const { i18n } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const router = useRouter()
  const openedHere = useRef(false)
  const savedScrollY = useRef<number | null>(null)
  const prevModel = useRef<string | undefined>(search.model)

  useEffect(() => {
    const previous = prevModel.current
    const current = search.model
    prevModel.current = current

    if (typeof window === 'undefined') return

    const targetY = savedScrollY.current
    if (targetY === null) return

    if (previous && !current) {
      openedHere.current = false
      savedScrollY.current = null
      window.scrollTo(window.scrollX, targetY)
      const frame = window.requestAnimationFrame(() => {
        window.scrollTo(window.scrollX, targetY)
      })
      return () => window.cancelAnimationFrame(frame)
    }

    if (!previous && current && window.scrollY !== targetY) {
      window.scrollTo(window.scrollX, targetY)
    }
  }, [search.model])

  const setSearch = useCallback(
    (value: string) => {
      void navigate({
        search: (prev) => ({ ...prev, search: value || undefined }),
        replace: true,
        resetScroll: false,
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
        resetScroll: false,
      })
    },
    [navigate]
  )

  const setCurrency = useCallback(
    (value: PriceCurrency) => {
      storePriceCurrency(value)
      void navigate({
        search: (prev) => ({
          ...prev,
          currency: value,
        }),
        replace: true,
        resetScroll: false,
      })
    },
    [navigate]
  )

  const openModel = useCallback(
    (name: string) => {
      if (typeof window !== 'undefined' && savedScrollY.current === null) {
        savedScrollY.current = window.scrollY
      }
      openedHere.current = true
      void navigate({
        search: (prev) => ({ ...prev, model: name }),
        resetScroll: false,
      })
    },
    [navigate]
  )

  const closeModel = useCallback(() => {
    if (typeof window !== 'undefined' && savedScrollY.current === null) {
      savedScrollY.current = window.scrollY
    }
    if (openedHere.current) {
      openedHere.current = false
      router.history.back()
      return
    }
    void navigate({
      search: (prev) => ({ ...prev, model: undefined }),
      replace: true,
      resetScroll: false,
    })
  }, [navigate, router])

  return {
    search: search.search ?? '',
    sort: parseBoardSort(search.sort),
    currency:
      parsePriceCurrency(search.currency) ??
      readStoredPriceCurrency() ??
      defaultPriceCurrency(i18n.resolvedLanguage ?? i18n.language, rates),
    model: search.model ?? null,
    setSearch,
    setSort,
    setCurrency,
    openModel,
    closeModel,
  }
}
