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
/**
 * CoreCode fork: one source of truth for the signed-in user's live account
 * figures. The auth store only learns the user at sign-in, so the balance in
 * the sidebar and on the overview went stale after a top-up, a redemption or
 * a day of spending. Every read of `/api/user/self` goes through here and is
 * merged into the store, so those views follow the server.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'

export const SELF_QUERY_KEY = ['user', 'self'] as const
const SELF_REFETCH_INTERVAL_MS = 60 * 1000
const SELF_STALE_MS = 30 * 1000

/** Merge a fresh `/api/user/self` payload into the store's user. */
export function mergeSelfIntoStore(fresh: Partial<AuthUser>) {
  const { user, setUser } = useAuthStore.getState().auth
  // A payload for another account, or after a sign-out, must not resurrect it.
  if (!user || (fresh.id !== undefined && fresh.id !== user.id)) return
  setUser({ ...user, ...fresh })
}

export async function fetchSelf(): Promise<AuthUser> {
  const response = requireServerSuccess(await getSelf())
  const data = response.data as AuthUser
  mergeSelfIntoStore(data)
  return data
}

function pollWhileVisible() {
  return document.visibilityState === 'visible'
    ? SELF_REFETCH_INTERVAL_MS
    : false
}

/**
 * The live user. Refetches on window focus and every minute while the tab is
 * visible; each result lands in the auth store.
 */
export function useSelf() {
  const signedIn = useAuthStore((state) => state.auth.user !== null)
  return useQuery({
    queryKey: SELF_QUERY_KEY,
    queryFn: fetchSelf,
    enabled: signedIn,
    staleTime: SELF_STALE_MS,
    refetchOnWindowFocus: true,
    refetchInterval: pollWhileVisible,
    // A background poll that fails must not toast; the next one retries.
    meta: { errorToast: false },
  })
}

/**
 * Re-read the user now, after an action that moved the balance. Resolves to
 * the fresh user, or null when the request failed.
 */
export function useRefreshSelf() {
  const queryClient = useQueryClient()
  return useCallback(async (): Promise<AuthUser | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: SELF_QUERY_KEY,
        queryFn: fetchSelf,
        staleTime: 0,
      })
    } catch {
      return null
    }
  }, [queryClient])
}
