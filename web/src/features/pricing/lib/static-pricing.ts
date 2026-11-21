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
// On corecode.live the price list is a static page: corecode-infra's Caddyfile
// answers a document load of `/pricing/` (and `/pricing/<lang>/`) itself, and
// sends an old `/pricing/<modelId>` to `/model/<modelId>/` or back to the list.
// Every console entry to model pricing is a client-side router navigation,
// which never reaches the proxy, so these routes hand a visitor to the static
// page with a full load, the way the home route does (features/home).
//
// A document that itself loaded under `/pricing` shows the host serves the
// console there (a dev server, a plain new-api, or the proxy rolled back), so
// there is no static page to hand to: the route renders the console's own
// price list instead. That check also keeps the hand-off from looping.
export function staticPricingServes(): boolean {
  const entry = performance.getEntriesByType('navigation')[0]
  if (!entry) return false
  const { pathname } = new URL(entry.name)
  return pathname !== '/pricing' && !pathname.startsWith('/pricing/')
}

// The static list's own query: ?search= pre-fills the search box and ?group=
// selects a group chip. Everything else the console list kept in its URL has
// no counterpart there.
const CARRIED = ['search', 'group'] as const

export function staticPricingTarget(search: string, modelId?: string): string {
  if (modelId) return `/pricing/${encodeURIComponent(modelId)}`
  const from = new URLSearchParams(search)
  const to = new URLSearchParams()
  for (const key of CARRIED) {
    const value = from.get(key)?.trim()
    if (value) to.set(key, value)
  }
  const query = to.toString()
  return query ? `/pricing/?${query}` : '/pricing/'
}
