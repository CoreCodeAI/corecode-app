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

import { alignPrevious } from '../analysis'
import {
  dailyPeaks,
  failureHours,
  peakTrend,
  type RejectionDiagnosis,
} from '../capacity-analysis'
import {
  HEADROOM_SHARE,
  HOUR_SAMPLE,
  SPIKE_FACTOR,
  useHourAxis,
  useInsightsFormat,
} from '../lib'
import type { CapacityHour, PoolProvider } from '../types'
import { TabLink } from './insight-kit'
import { BarSeries, Panel, type Tone } from './shared'

// A forecast further out than this is not a buying decision.
const FORECAST_MAX_DAYS = 365
// Spiking hours named in the failure panel's sentence.
const NAMED_SPIKES = 3

function peakTone(peak: number, slots: number): Tone | undefined {
  if (slots <= 0) return undefined
  if (peak > slots) return 'danger'
  if (peak >= slots * HEADROOM_SHARE) return 'warning'
  return undefined
}

/**
 * Each hour's peak concurrency against today's slots, with the previous
 * period's same hour in its readout. Hours near or past the slots are
 * coloured; the open hour is faded.
 */
export function HourlyPeakChart(props: {
  hourly: CapacityHour[]
  previous: CapacityHour[] | null | undefined
  span: number | undefined
  end: number
  slots: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const axis = useHourAxis()
  const before =
    props.span === undefined
      ? []
      : alignPrevious(props.hourly, props.previous, props.span)
  return (
    <BarSeries
      ariaLabel={t('Hourly peak concurrency')}
      series={[{ label: t('Peak concurrency') }]}
      reference={
        props.slots > 0
          ? { value: props.slots, label: t("Today's pool slots") }
          : undefined
      }
      points={axis.bars(props.hourly, props.end, (row, index) => {
        const previous = before[index]
        return {
          values: [row.peak_concurrency],
          tone: peakTone(row.peak_concurrency, props.slots),
          extra: [
            ...(previous
              ? [
                  {
                    label: t('Same hour, previous period'),
                    value: fmt.num(previous.peak_concurrency),
                  },
                ]
              : []),
            { label: t('Requests'), value: fmt.num(row.requests) },
          ],
        }
      })}
    />
  )
}

/**
 * Why the engine turned requests away and what to do: add accounts when
 * the peak was at the slots, look at the account pool when it was well
 * under them.
 */
export function RejectionDiagnosisNote(props: {
  diagnosis: RejectionDiagnosis | undefined
  slots: number
  vendor: 'all' | PoolProvider
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const diagnosis = props.diagnosis
  if (!diagnosis?.cause) return null
  const values = {
    time: fmt.time(diagnosis.worst.hour),
    count: fmt.num(diagnosis.worst.count),
    peak: fmt.num(diagnosis.worst.peak),
    slots: fmt.num(props.slots),
  }
  if (diagnosis.cause === 'saturation') {
    return (
      <p className='text-muted-foreground mb-3 text-xs'>
        {t(
          'The engine turned most away at {{time}} ({{count}}), with the peak at {{peak}} of {{slots}} slots: every account was busy. The pool is too small; add accounts.',
          values
        )}
      </p>
    )
  }
  const vendor = props.vendor === 'all' ? undefined : props.vendor
  return (
    <p className='text-muted-foreground mb-3 text-xs'>
      {t(
        'The engine turned most away at {{time}} ({{count}}) with the peak only {{peak}} of {{slots}} slots: too few accounts were schedulable then, from cooldowns or spent quota.',
        values
      )}{' '}
      <TabLink tab='pool' search={{ provider: vendor, vendor }}>
        {t('Check the account pool')}
      </TabLink>
    </p>
  )
}

/**
 * Each hour's failure rate beside the previous period's same hour. Hours
 * with too few requests have no rate; hours far above their usual rate are
 * flagged.
 */
export function FailureRatePanel(props: {
  hourly: CapacityHour[]
  previous: CapacityHour[] | null | undefined
  span: number | undefined
  end: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const axis = useHourAxis()
  const hours = failureHours(
    props.hourly,
    props.previous,
    props.span,
    props.end
  )
  const spikes = hours.filter((hour) => hour.spike)
  const rated = hours.some((hour) => hour.rate !== null)
  let description: string
  const [first] = spikes
  if (spikes.length === 1 && first.rate !== null && first.baseline !== null) {
    description = t(
      '{{time}} failed {{rate}} of its requests, against a usual {{baseline}}.',
      {
        time: fmt.time(first.hour),
        rate: fmt.pct(first.rate),
        baseline: fmt.pct(first.baseline),
      }
    )
  } else if (spikes.length > 1) {
    description = t(
      '{{count}} hours failed at least {{factor}}× their usual rate: {{times}}.',
      {
        count: fmt.num(spikes.length),
        factor: SPIKE_FACTOR,
        times: [...spikes]
          .sort((a, b) => b.errors - a.errors)
          .slice(0, NAMED_SPIKES)
          .map((hour) => fmt.time(hour.hour))
          .join(', '),
      }
    )
  } else if (rated) {
    description = t('No hour failed far above its usual rate.')
  } else {
    description = t('Too few requests in any hour to give it a rate.')
  }
  return (
    <Panel
      title={t('Hourly failure rate')}
      description={description}
      help={t(
        'Failed requests over requests, per hour. An hour under {{count}} requests has no rate. Usual is the previous period’s same hour, or the median hour when that has too few requests. Requests a per-user limit turned away never reach the logs and are not counted.',
        { count: HOUR_SAMPLE }
      )}
    >
      <BarSeries
        ariaLabel={t('Hourly failure rate')}
        series={[{ label: t('Failure rate'), format: fmt.pct }]}
        points={axis.bars(hours, props.end, (hour) => ({
          values: [hour.rate ?? 0],
          tone: hour.spike ? 'danger' : undefined,
          extra: [
            ...(hour.previousRate !== null
              ? [
                  {
                    label: t('Same hour, previous period'),
                    value: fmt.pct(hour.previousRate),
                  },
                ]
              : []),
            { label: t('Failed'), value: fmt.num(hour.errors) },
            {
              label: t('Requests'),
              value:
                hour.rate === null
                  ? t('{{count}}, too few for a rate', {
                      count: fmt.num(hour.requests),
                    })
                  : fmt.num(hour.requests),
            },
          ],
        }))}
      />
    </Panel>
  )
}

/**
 * Each whole day's peak concurrency and, while it rises, when it reaches
 * today's slots at that pace.
 */
export function PeakTrendPanel(props: {
  hourly: CapacityHour[]
  end: number
  slots: number
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const days = dailyPeaks(props.hourly, props.end)
  const trend = peakTrend(
    days.map((day) => day.peak),
    props.slots
  )
  const rate = trend ? fmt.num(Math.round(trend.slope * 10) / 10) : ''
  const slots = fmt.num(props.slots)
  let description: string
  if (!trend) {
    description = t('Too few whole days in this range to tell a trend.')
  } else if (trend.daysToFull === 0) {
    description = t("The daily peak has reached today's {{slots}} slots.", {
      slots,
    })
  } else if (
    trend.daysToFull !== undefined &&
    trend.daysToFull <= FORECAST_MAX_DAYS
  ) {
    description = t(
      "The daily peak is rising by {{rate}} a day; at that pace it reaches today's {{slots}} slots in about {{days}} days.",
      { rate, slots, days: fmt.num(trend.daysToFull) }
    )
  } else if (trend.daysToFull !== undefined) {
    description = t(
      "The daily peak is rising by {{rate}} a day, too slowly to reach today's {{slots}} slots within a year.",
      { rate, slots }
    )
  } else if (trend.slope > 0) {
    description = t('The daily peak is rising by {{rate}} a day.', { rate })
  } else {
    description = t('The daily peak is not rising.')
  }
  return (
    <Panel
      title={t('Daily peak concurrency')}
      description={description}
      help={t(
        'The highest hourly peak of each whole day, with a straight line fitted through them. Slots are the pool’s current value; adding or losing accounts moves the forecast.'
      )}
    >
      <BarSeries
        ariaLabel={t('Daily peak concurrency')}
        series={[{ label: t('Peak concurrency') }]}
        reference={
          props.slots > 0
            ? { value: props.slots, label: t("Today's pool slots") }
            : undefined
        }
        points={days.map((day) => ({
          key: day.day,
          title: fmt.day(day.day),
          values: [day.peak],
          tone: peakTone(day.peak, props.slots),
        }))}
      />
    </Panel>
  )
}
