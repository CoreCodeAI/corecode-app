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
export type RivalStatus = 'pending' | 'ok' | 'unsupported' | 'error'

export type RivalSite = {
  id: number
  slug: string
  name: string
  site_url: string
  api_base: string
  api_base_locked: boolean
  source: 'apiranking' | 'manual'
  enabled: boolean
  status: RivalStatus | ''
  error: string
  system_name: string
  version: string
  /** CNY paid for $1 of credit; 0 when the site does not say. */
  top_up_price: number
  exchange_rate: number
  claude_models: number
  checked_at: number
  priced_at: number
  next_check_at: number
  directory_checked_at: number
  created_at: number
}

/** One site's price of one model in one group, CNY per million tokens. */
export type RivalPrice = {
  site_id: number
  model: string
  group: string
  raw_model: string
  model_ratio: number
  completion_ratio: number
  cache_ratio: number | null
  group_ratio: number
  input_cny: number | null
  output_cny: number | null
  cache_read_cny: number | null
  updated_at: number
}

export type RivalOfficialPrice = {
  model: string
  input_cny: number
  output_cny: number
}

export type RivalOwnPrice = {
  group: string
  group_ratio: number
  input_cny: number
  output_cny: number
  cache_read_cny: number | null
  cache_ratio: number | null
}

export type RivalCounts = {
  total: number
  ok: number
  unsupported: number
  error: number
  pending: number
  disabled: number
}

export type RivalBoard = {
  enabled: boolean
  proxy_set: boolean
  model: string
  models: RivalOfficialPrice[]
  exchange_rate: number
  top_up_price: number
  ours: RivalOwnPrice[] | null
  sites: (RivalSite & { prices: RivalPrice[] })[]
  counts: RivalCounts
  directory: { synced_at: number; sites: number; error: string }
}

export type RivalPriceChange = {
  id: number
  site_id: number
  model: string
  group: string
  kind: 'changed' | 'added' | 'removed'
  old_group_ratio: number
  new_group_ratio: number
  old_input_cny: number | null
  new_input_cny: number | null
  created_at: number
}
