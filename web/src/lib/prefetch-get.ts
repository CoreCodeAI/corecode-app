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
import type { AxiosResponse } from 'axios'

import { BOOT_DATA_MAX_AGE_MS, normalizeUrl } from '@/lib/boot-requests'
import {
  api,
  getRequestKey,
  installPrefetchTaker,
  type ApiRequestConfig,
} from '@/lib/http-client'

// A prefetched response serves one request for the same URL that starts this
// soon after it was sent, as fresh as the queries' default staleTime.
const PREFETCH_MAX_AGE_MS = 10_000

type PrefetchedGet = {
  sentAt: number
  /** The response, or null when it failed: the page then sends its own. */
  response: Promise<AxiosResponse | null>
  /**
   * Set once a request took the response. The entry stays until it expires,
   * so the loader's second run, when the navigation itself loads the route,
   * does not send the request again.
   */
  taken: boolean
}

const prefetched = new Map<string, PrefetchedGet>()

const isFresh = (entry: PrefetchedGet | undefined) =>
  !!entry && performance.now() - entry.sentAt <= PREFETCH_MAX_AGE_MS

/** Whether index.html fetched this GET on this page load, unread so far. */
function hasBootData(url: string): boolean {
  const data = window.__bootRequests?.data
  if (!data || performance.now() > BOOT_DATA_MAX_AGE_MS) return false
  const key = normalizeUrl(url)
  return Object.keys(data).some((sent) => normalizeUrl(sent) === key)
}

function takePrefetched(
  key: string,
  send: () => Promise<AxiosResponse>
): Promise<AxiosResponse> | undefined {
  const entry = prefetched.get(key)
  if (!entry || entry.taken) return undefined
  if (!isFresh(entry)) {
    prefetched.delete(key)
    return undefined
  }
  entry.taken = true
  return entry.response.then((response) => response ?? send())
}

/**
 * Send a GET a page is about to make, so its response is on the way before
 * the page asks. Route loaders call this when the router preloads a route,
 * which it does while the pointer rests on a link to it. The page's own
 * api.get for the same URL and parameters, in the same session and within
 * ten seconds, takes this response instead of sending another request; its
 * other readers at the time share it as a request in flight. A failure is
 * not handed over: the page then sends its own request and reports its own
 * error.
 */
export function prefetchGet(url: string, config: ApiRequestConfig = {}): void {
  if (typeof window === 'undefined') return
  // On a page load index.html may have sent it already.
  if (hasBootData(api.getUri({ ...config, url }))) return
  const key = getRequestKey(url, config)
  if (isFresh(prefetched.get(key))) return
  installPrefetchTaker(takePrefetched)
  prefetched.set(key, {
    sentAt: performance.now(),
    taken: false,
    // api.request goes around api.get, which would take this entry itself.
    response: api
      .request({ ...config, url, method: 'get', skipErrorHandler: true })
      .then(
        (response) => (response.data?.success === false ? null : response),
        () => null
      ),
  })
}
