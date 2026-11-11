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
import type { StatusVariant } from '@/components/status-badge'

import type { BucketState } from '../types'

/** The monitor rewrites the data every 2 minutes; older than this, it has stopped. */
export const STALE_AFTER_S = 600

/** Matches the public status page: 100% only when it rounds there. */
export function formatRate(
  rate: number | null | undefined,
  locale: Intl.LocalesArgument
): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return '—'
  if (rate >= 0.9995) return '100%'
  return Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: rate >= 0.99 ? 2 : 1,
    maximumFractionDigits: rate >= 0.99 ? 2 : 1,
  }).format(rate)
}

/** A latency in milliseconds, or seconds from one second up. */
export function formatLatency(
  ms: number | null | undefined,
  locale: Intl.LocalesArgument
): string {
  if (!ms) return '—'
  if (ms < 1000) {
    return Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: 'short',
    }).format(ms)
  }
  const digits = ms >= 10000 ? 0 : 2
  return Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ms / 1000)
}

/** The tone a success rate reads in: above 95% is good, below 50% bad. */
export function rateTone(
  rate: number | null | undefined
): 'good' | 'warn' | 'bad' | 'none' {
  if (rate === null || rate === undefined) return 'none'
  if (rate >= 0.95) return 'good'
  if (rate >= 0.5) return 'warn'
  return 'bad'
}

export const BUCKET_CLASS: Record<BucketState, string> = {
  ok: 'bg-success',
  degraded: 'bg-warning',
  outage: 'bg-destructive',
  none: 'bg-muted-foreground/20',
}

export const STATE_VARIANT: Record<BucketState, StatusVariant> = {
  ok: 'success',
  degraded: 'warning',
  outage: 'danger',
  none: 'neutral',
}

export const RATE_TONE_CLASS = {
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
  none: 'text-muted-foreground',
} as const

/** `HH:mm`, with the date in front when asked. */
export function formatClock(
  seconds: number,
  locale: Intl.LocalesArgument,
  withDate = false
): string {
  return Intl.DateTimeFormat(locale, {
    ...(withDate ? { month: 'numeric', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(seconds * 1000)
}

/** A bucket's period, `14:00–15:00`. */
export function formatPeriod(
  start: number,
  length: number,
  locale: Intl.LocalesArgument,
  withDate = false
): string {
  return `${formatClock(start, locale, withDate)}–${formatClock(start + length, locale)}`
}

/** Success rate over a strip, weighted by each period's requests. */
export function stripSummary(
  buckets: { requests: number; success_rate: number | null }[]
): { requests: number; rate: number | null } {
  let requests = 0
  let succeeded = 0
  for (const bucket of buckets) {
    requests += bucket.requests
    succeeded += Math.round((bucket.success_rate ?? 0) * bucket.requests)
  }
  return { requests, rate: requests ? succeeded / requests : null }
}
