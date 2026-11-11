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
  MIN_TASKS,
  SMALL_SAMPLE,
  failureTone,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import type { UpstreamInsights } from '../types'
import {
  CLEAR_RATE,
  INCIDENT_RATE,
  attemptsOf,
  channelTasks,
  finishedTasks,
  idleDisabled,
  rescuedFrom,
  shortBills,
  staleCosts,
  topRescuer,
  unrescuedOf,
  upstreamIncidents,
  upstreamTotals,
} from '../upstream'
import { join, worse, type TabVerdict } from './shared'

/**
 * The upstream tab's answer. Among channels with SMALL_SAMPLE attempts, the
 * one whose failures customers saw most leads, with its move against the
 * previous period and who rescued it; with none past 2%, an all-clear. An
 * incident window, a stale upstream bill and a loss follow.
 */
export function useUpstreamVerdict(
  data: UpstreamInsights | undefined,
  previous: UpstreamInsights | undefined,
  range?: InsightsRangeInfo
): TabVerdict | undefined {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (!data) return undefined
  const names = new Map(data.channels.map((row) => [row.id, row.name]))
  const name = (id: number) => names.get(id) ?? `#${id}`
  const rescued = rescuedFrom(data.rescues)
  const totals = upstreamTotals(data)
  const candidates = data.channels.filter(
    (row) => attemptsOf(row) >= SMALL_SAMPLE
  )
  const stale = staleCosts(data, range?.end)
  const incidents = upstreamIncidents(data.hourly, data.rescues, range)
  let tone: Tone = 'default'
  const parts: (string | false | null | undefined)[] = []

  if (candidates.length === 0) {
    parts.push(t('No channel served enough requests to compare.'))
  } else {
    const failing = candidates
      .filter((row) => row.failure_rate > CLEAR_RATE)
      .map((row) => ({ row, unrescued: unrescuedOf(row, rescued) }))
      .sort((a, b) => b.unrescued - a.unrescued || b.row.errors - a.row.errors)
    if (failing.length === 0) {
      tone = 'good'
      const before = previous ? upstreamTotals(previous) : undefined
      const points =
        before && before.attempts >= SMALL_SAMPLE
          ? (totals.failureRate - before.failureRate) * 100
          : null
      parts.push(
        points !== null && Math.abs(points) >= 0.1
          ? t('Failure rate {{rate}} ({{sign}}{{points}} points).', {
              rate: fmt.pct(totals.failureRate),
              sign: points > 0 ? '+' : '−',
              points: fmt.num(Math.round(Math.abs(points) * 10) / 10),
            })
          : t('Failure rate {{rate}}.', { rate: fmt.pct(totals.failureRate) }),
        t(
          'All clear: every channel with at least {{count}} attempts fails under 2%.',
          { count: fmt.num(SMALL_SAMPLE) }
        )
      )
    } else {
      const worst = failing[0]
      tone = failureTone(worst.row.failure_rate)
      const before = previous?.channels.find((row) => row.id === worst.row.id)
      const values = {
        name: worst.row.name,
        rate: fmt.pct(worst.row.failure_rate),
      }
      const points =
        before && attemptsOf(before) >= SMALL_SAMPLE
          ? (worst.row.failure_rate - before.failure_rate) * 100
          : null
      const amount = fmt.num(Math.round(Math.abs(points ?? 0) * 10) / 10)
      let lead = t('{{name}} fails {{rate}} of its attempts.', values)
      if (previous && !before) {
        lead = t(
          '{{name}} fails {{rate}} of its attempts; it had no traffic in the previous period.',
          values
        )
      } else if (points !== null && points >= 0.1) {
        lead = t(
          '{{name}} fails {{rate}} of its attempts, up {{points}} points on the previous period.',
          { ...values, points: amount }
        )
      } else if (points !== null && points <= -0.1) {
        lead = t(
          '{{name}} fails {{rate}} of its attempts, down {{points}} points on the previous period.',
          { ...values, points: amount }
        )
      }
      parts.push(lead)
      if (worst.unrescued > 0) {
        parts.push(
          t(
            '{{count}} of its failed attempts were not served by another channel.',
            { count: fmt.num(worst.unrescued) }
          )
        )
      }
      const rescue = topRescuer(data.rescues, worst.row.id) ?? data.rescues[0]
      if (rescue) {
        parts.push(
          t(
            '{{count}} requests that failed on {{from}} were served by {{to}}.',
            {
              count: rescue.count,
              from: name(rescue.from),
              to: name(rescue.to),
            }
          )
        )
      }
      if (failing.length > 1) {
        parts.push(
          t('Also failing past 2%: {{names}}.', {
            names: failing
              .slice(1)
              .map((item) => item.row.name)
              .join(', '),
          })
        )
      }
    }
  }

  const incident = incidents[0]
  if (incident) {
    tone = worse(tone, 'danger')
    const values = {
      name: name(incident.channel_id),
      rate: fmt.pct(incident.rate),
      attempts: fmt.num(incident.attempts),
      start: fmt.time(incident.start),
      end: fmt.time(incident.end),
    }
    parts.push(
      incident.ongoing
        ? t(
            '{{name}} has failed {{rate}} of {{attempts}} attempts since {{start}}, and still does.',
            values
          )
        : t(
            '{{name}} failed {{rate}} of {{attempts}} attempts from {{start}} to {{end}}.',
            values
          )
    )
  }

  const tasks = channelTasks(data).filter(
    (item) =>
      finishedTasks(item.tasks) >= MIN_TASKS &&
      item.tasks.failure_rate > INCIDENT_RATE
  )
  const failingTasks = tasks.sort((a, b) => b.tasks.failed - a.tasks.failed)[0]
  if (failingTasks) {
    tone = worse(tone, failureTone(failingTasks.tasks.failure_rate))
    parts.push(
      t('{{name}} failed {{rate}} of its {{count}} finished tasks.', {
        name: failingTasks.channel.name,
        rate: fmt.pct(failingTasks.tasks.failure_rate),
        count: fmt.num(finishedTasks(failingTasks.tasks)),
      })
    )
  }

  const disabled = idleDisabled(data)
  if (disabled.length > 0) {
    tone = worse(tone, 'warning')
    const first = disabled[0]
    const values = {
      name: first.name,
      time: first.status_time ? fmt.time(first.status_time) : '',
      reason: first.status_reason?.trim() ?? '',
      count: disabled.length - 1,
    }
    let line = t(
      '{{name}} was disabled automatically and served nothing in this range.',
      values
    )
    if (values.time && values.reason) {
      line = t(
        '{{name}} was disabled automatically {{time}} and served nothing in this range: {{reason}}.',
        values
      )
    } else if (values.time) {
      line = t(
        '{{name}} was disabled automatically {{time}} and served nothing in this range.',
        values
      )
    }
    parts.push(line)
    if (disabled.length > 1) {
      parts.push(
        t('{{count}} more channels are disabled automatically.', values)
      )
    }
  }

  const short = shortBills(data)
  if (stale.length > 0) {
    tone = worse(tone, 'warning')
    const known = stale.every((item) => item.revenue !== null)
    const values = {
      name: stale.map((item) => item.channel.name).join(', '),
      time: fmt.time(
        Math.min(...stale.map((item) => item.channel.latest_cost_at))
      ),
      revenue: fmt.usd(
        stale.reduce((sum, item) => sum + (item.revenue ?? 0), 0)
      ),
    }
    parts.push(
      known
        ? t(
            'The upstream bill of {{name}} was last read {{time}}; {{revenue}} of revenue since has no cost yet, so the margin is overstated.',
            values
          )
        : t(
            'The upstream bill of {{name}} was last read {{time}}; later revenue has no cost yet, so the margin may be overstated.',
            values
          )
    )
  } else if (totals.cost > 0) {
    if (totals.margin < 0) tone = worse(tone, 'warning')
    const rate = fmt.pct(totals.marginRate)
    if (short.length > 0) {
      tone = worse(tone, 'warning')
      parts.push(
        t(
          'Gross margin on channels with a known cost: {{rate}}, overstated: the bill of {{names}} is read from some keys only.',
          { rate, names: short.map((row) => row.name).join(', ') }
        )
      )
    } else {
      parts.push(
        t('Gross margin on channels with a known cost: {{rate}}.', { rate })
      )
    }
  }
  return { tone, text: join(...parts) }
}
