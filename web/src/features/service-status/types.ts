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
/** The public status page's data, `/status/status.json`, written by the relay's monitor. */

/** A period's state: the success rate decides it, `none` when nothing was requested. */
export type BucketState = 'ok' | 'degraded' | 'outage' | 'none'

/** The site as a whole. */
export type OverallStatus = 'operational' | 'degraded' | 'outage'

export interface StatusBucket {
  /** Start of the period, in Unix seconds. */
  t: number
  requests: number
  success_rate: number | null
  p50_ms: number | null
  state: BucketState
}

export interface GroupBucket {
  t: number
  state: BucketState
  success_rate: number | null
  p50_ms: number | null
  cache_hit_rate?: number | null
}

export interface StatusGroup {
  name: string
  ratio: number | null
  /** The group's busiest model over the last day. */
  model: string | null
  state: BucketState
  success_rate: number | null
  p50_ms: number | null
  /** `ttft` for streaming groups, `total` for image and video groups. */
  latency: 'ttft' | 'total' | null
  cache_hit_rate: number | null
  /** One per hour over the last 24 hours. */
  buckets: GroupBucket[]
}

export interface StatusStripData {
  bucket_s: number
  buckets: StatusBucket[]
}

/** A component's state on a vendor's status page (Atlassian Statuspage). */
export type OfficialComponentStatus =
  | 'operational'
  | 'under_maintenance'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'

/**
 * A vendor's own status page, reduced by the monitor to the components our
 * API reaches. It never changes our own `status`.
 */
export interface OfficialStatus {
  vendor: 'anthropic' | 'openai'
  /** Shown as is: Anthropic, OpenAI. */
  name: string
  /** The vendor's status page. */
  url: string
  state: 'ok' | 'maintenance' | 'degraded' | 'outage'
  /** The page's own overall description, in English. */
  description: string
  components: { name: string; status: OfficialComponentStatus }[]
  /** Open incidents touching those components, newest first. */
  incidents: {
    name: string
    impact: string
    status: string
    started_at: number | null
    url: string
  }[]
}

export interface ServiceStatusData {
  version: number
  /** Unix seconds. */
  generated_at: number
  status: OverallStatus
  maintenance: boolean
  current: {
    window_s: number
    requests: number
    success_rate: number | null
    p50_ms: number | null
  }
  day: StatusStripData
  week: StatusStripData
  groups?: StatusGroup[] | null
  /** Missing before the monitor read the vendors' pages; a vendor it could not read is left out. */
  official?: OfficialStatus[]
}

/** The data with the server's clock at the time it was read. */
export interface ServiceStatusSnapshot {
  data: ServiceStatusData
  /** Milliseconds, from the response's Date header. */
  serverNow: number
}
