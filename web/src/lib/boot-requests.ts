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
 * The API requests index.html sends before the bundle has loaded.
 *
 * The status, the setup check and the auth refresh used to start only once the
 * entry bundle had downloaded and run, one round trip after it. An inline
 * script in index.html sends them as the page starts parsing, and the code
 * that would make each request takes the response from here instead.
 *
 * Each response is taken once, by the page load's first caller. A boot request
 * that failed to reach the server (status 0) is not used, so the caller sends
 * its own request as before.
 */
export interface BootResponse {
  status: number
  data?: unknown
}

type BootRequestName = 'status' | 'setup' | 'refresh'

declare global {
  interface Window {
    __bootRequests?: Partial<Record<BootRequestName, Promise<BootResponse>>> & {
      /** GET responses by URL: the overview's and keys page's first data. */
      data?: Record<string, Promise<BootResponse>>
    }
  }
}

// A boot data response serves only the page load that sent it: once the page
// has been open this long, the data may be older than what a request returns.
export const BOOT_DATA_MAX_AGE_MS = 10_000

/** A URL with its query parameters in a fixed order, for comparison. */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url, 'http://boot.invalid')
  parsed.searchParams.sort()
  return parsed.pathname + parsed.search
}

/** The boot request's response if one was sent and not yet taken. */
export async function takeBootRequest(
  name: BootRequestName
): Promise<BootResponse | null> {
  if (typeof window === 'undefined') return null
  const requests = window.__bootRequests
  const pending = requests?.[name]
  if (!requests || !pending) return null
  delete requests[name]
  const response = await pending
  return response.status ? response : null
}

/**
 * The response index.html fetched for this GET, if it fetched one and nothing
 * has taken it. Once the boot refresh returns, index.html fetches the first
 * data of the page it loads (the overview's panels, the keys table) with that
 * access token, so the data arrives while the bundle downloads. Only a
 * successful response is used; otherwise the caller sends its own request.
 */
export async function takeBootData(url: string): Promise<BootResponse | null> {
  if (typeof window === 'undefined') return null
  const data = window.__bootRequests?.data
  if (!data) return null
  if (performance.now() > BOOT_DATA_MAX_AGE_MS) {
    delete window.__bootRequests?.data
    return null
  }
  const key = normalizeUrl(url)
  const match = Object.keys(data).find((sent) => normalizeUrl(sent) === key)
  if (!match) return null
  const pending = data[match]
  delete data[match]
  const response = await pending
  return response.status === 200 ? response : null
}
