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
import { useTranslation } from 'react-i18next'

import type { Tone } from '../components/shared'
import {
  failureTone,
  SMALL_SAMPLE,
  useInsightsFormat,
  useVendorName,
} from '../lib'
import {
  failingTaskModels,
  failingWindow,
  failsAboveSite,
  failureDrivers,
  failureShift,
  hourFlags,
  mixShift,
  rankByExcess,
  siteFailureRate,
  siteTtftP95,
} from '../quality-analysis'
import type { QualityInsights } from '../types'
import { join, worse, type TabVerdict } from './shared'

export function useQualityVerdict(
  data: QualityInsights | undefined,
  previous: QualityInsights | undefined,
  options?: {
    /** The model filter, so drivers count the models the headline does. */
    selected?: string[]
    /** The range's end in unix seconds; its last hour is taken as open without it. */
    end?: number
  }
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  if (!data) return undefined
  const selected = options?.selected ?? []
  const siteRate = siteFailureRate(data)
  const vendors = (data.vendors ?? []).filter(
    (vendor) => vendor.ttft_p50_ms > 0
  )
  const claude = vendors.find((vendor) => vendor.vendor === 'claude')
  const failing = rankByExcess(data.models, siteRate).filter(
    (row) =>
      failsAboveSite(row, siteRate) && failureTone(row.error_rate) !== 'default'
  )
  // A vendor failing beyond chance above the site, past 2%, is named.
  const failingVendors = (data.vendors ?? []).filter(
    (vendor) =>
      vendor.vendor !== 'other' &&
      failsAboveSite(vendor, siteRate) &&
      failureTone(vendor.error_rate) !== 'default'
  )
  const judged = data.requests >= SMALL_SAMPLE
  const failure = judged ? failureTone(data.error_rate) : 'default'
  let tone: Tone = failure === 'default' && judged ? 'good' : failure
  if (failingVendors.length > 0) tone = worse(tone, 'warning')
  if (claude && claude.ttft_p95_ms > 10000) tone = worse(tone, 'warning')

  const rate = fmt.pct(data.error_rate)
  const signed = (points: number) =>
    `${points > 0 ? '+' : '−'}${fmt.num(Math.round(Math.abs(points) * 10) / 10)}`
  const shift = failureShift(data, previous)
  let headline = t('Failure rate {{rate}}.', { rate })
  if (!judged) {
    headline = t(
      'Failure rate {{rate}} over {{count}} requests, too few to judge.',
      { rate, count: fmt.num(data.requests) }
    )
  } else if (shift.kind === 'small') {
    headline = t('Failure rate {{rate}}; too few requests before to compare.', {
      rate,
    })
  } else if (shift.kind === 'flat' && Math.abs(shift.points) >= 0.1) {
    headline = t('Failure rate {{rate}}, no clear change from before.', {
      rate,
    })
  } else if (shift.kind === 'moved' && Math.abs(shift.points) >= 0.1) {
    headline = t('Failure rate {{rate}} ({{sign}}{{points}} points).', {
      rate,
      sign: shift.points > 0 ? '+' : '−',
      points: fmt.num(Math.round(Math.abs(shift.points) * 10) / 10),
    })
  }

  let driver: string | null = null
  if (shift.kind === 'moved' && Math.abs(shift.points) >= 0.1) {
    const { drivers } = failureDrivers(data.models, previous?.models, selected)
    const [first, second] = drivers
    if (first && second) {
      driver = t(
        'Mostly {{first}} ({{a}} points) and {{second}} ({{b}} points).',
        {
          first: first.key,
          a: signed(first.change * 100),
          second: second.key,
          b: signed(second.change * 100),
        }
      )
    } else if (first) {
      driver = t('Mostly {{model}} ({{change}} points).', {
        model: first.key,
        change: signed(first.change * 100),
      })
    }
  }

  const p95 = siteTtftP95(data, previous, selected)
  const mix = p95
    ? mixShift(p95.now, p95.before, data.vendors, previous?.vendors)
    : null

  const failingTasks = failingTaskModels(data.tasks)
  if (failingTasks.length > 0) tone = worse(tone, 'warning')
  const tasks =
    failingTasks.length > 0
      ? t('{{model}} tasks fail {{rate}} after submission.', {
          model: failingTasks[0].model,
          rate: fmt.pct(failingTasks[0].failure_rate),
        })
      : null
  const noChannel = data.refusals?.no_channel ?? 0
  const refused =
    noChannel > 0
      ? t('{{count}} requests found no channel.', {
          count: fmt.num(noChannel),
        })
      : null

  const hourly = data.hourly ?? []
  const end = options?.end ?? (hourly.at(-1)?.hour ?? 0) + 1
  const window = failingWindow(hourFlags(hourly, previous?.hourly, end))
  if (window) tone = worse(tone, 'warning')
  let hours: string | null = null
  if (window && window.from.hour === window.to.hour) {
    hours = t('Failures peaked at {{time}}: {{rate}} of {{count}} requests.', {
      time: fmt.time(window.worst.hour),
      rate: fmt.pct(window.worst.error_rate),
      count: fmt.num(window.worst.requests),
    })
  } else if (window) {
    hours = t(
      'Failures ran high from {{from}} to {{to}}, peaking at {{rate}}.',
      {
        from: fmt.time(window.from.hour),
        to: fmt.clock(window.to.hour + 3600),
        rate: fmt.pct(window.worst.error_rate),
      }
    )
  }

  return {
    tone,
    text: join(
      headline,
      driver,
      hours,
      ...failingVendors.map((vendor) =>
        t('{{vendor}} fails {{rate}} of requests.', {
          vendor: vendorName(vendor.vendor),
          rate: fmt.pct(vendor.error_rate),
        })
      ),
      claude &&
        t('Claude first token {{p50}} at p50, {{p95}} at p95.', {
          p50: fmt.measuredMs(claude.ttft_p50_ms),
          p95: fmt.measuredMs(claude.ttft_p95_ms),
        }),
      mix &&
        t(
          'First-token p95 went from {{before}} to {{now}} with the mix: {{vendor}} from {{from}} to {{to}} of requests, while each vendor’s own p95 held.',
          {
            before: fmt.measuredMs(mix.p95Before),
            now: fmt.measuredMs(mix.p95Now),
            vendor: vendorName(mix.vendor),
            from: fmt.pct(mix.before),
            to: fmt.pct(mix.now),
          }
        ),
      failing.length > 0 &&
        t('Failing most: {{model}} at {{rate}}.', {
          model: failing[0].model,
          rate: fmt.pct(failing[0].error_rate),
        }),
      tasks,
      refused
    ),
  }
}
