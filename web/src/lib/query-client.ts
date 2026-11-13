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
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { handleServerError } from './handle-server-error'
import {
  getServerErrorSources,
  getServerErrorStatus,
} from './server-error-message'

interface ErrorNotificationMeta extends Record<string, unknown> {
  /** Disable automatic notifications when a caller presents the failure itself. */
  errorToast?: boolean
}

const NETWORK_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ECONNABORTED',
  'ETIMEDOUT',
])

/** Retry only transport failures and server-side 5xx, at most twice. */
export const MAX_QUERY_RETRIES = 2

export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false
  const status = getServerErrorStatus(error)
  if (status !== undefined) return status >= 500 && status <= 599
  // No HTTP status: retry only when the request never got an answer.
  return getServerErrorSources(error).some(
    (source) =>
      typeof source.code === 'string' && NETWORK_ERROR_CODES.has(source.code)
  )
}

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: ErrorNotificationMeta
    mutationMeta: ErrorNotificationMeta
  }
}

export function createAppQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          !import.meta.env.DEV && shouldRetryQuery(failureCount, error),
        refetchOnWindowFocus: false,
        staleTime: 10 * 1000,
      },
    },
    mutationCache: new MutationCache({
      // A saved change goes out to every node; show its progress at once.
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ['node-sync'] })
      },
      onError: (error, _variables, _context, mutation) => {
        // A mutation-specific callback owns its fallback or inline error state.
        if (mutation.meta?.errorToast !== false && !mutation.options.onError) {
          handleServerError(error)
        }
      },
    }),
    queryCache: new QueryCache({
      // A failed query never navigates: route-level crashes reach the
      // errorComponent, and background polls must stay silent on the page.
      onError: (error, query) => {
        if (query.meta?.errorToast !== false) handleServerError(error)
      },
    }),
  })
  return client
}
