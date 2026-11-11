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
import type { ServiceStatusSnapshot } from './types'

export const SERVICE_STATUS_QUERY_KEY = ['service-status'] as const

/**
 * Read the status page's data. It is a static file the proxy serves beside
 * the console, not part of `/api`, so it is fetched directly and needs no
 * session.
 */
export async function getServiceStatus(): Promise<ServiceStatusSnapshot> {
  const response = await fetch(`/status/status.json?t=${Date.now()}`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = (await response.json()) as ServiceStatusSnapshot['data']
  if (data?.version !== 1) throw new Error('Unsupported status version')
  // The server's clock, not the reader's, decides whether the data is stale.
  const serverNow = Date.parse(response.headers.get('date') ?? '')
  return { data, serverNow: Number.isNaN(serverNow) ? Date.now() : serverNow }
}
