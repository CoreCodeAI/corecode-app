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

import { PROVIDER_LABELS, useChargeFormat, useInsightsFormat } from '../lib'
import type {
  EngineHorizon,
  EngineRunway,
  PoolProvider,
  PoolUsage,
} from '../types'
import {
  BarSeries,
  MetricGrid,
  Panel,
  SimpleTable,
  type BarPoint,
  type Tone,
} from './shared'

/**
 * Whether the Claude pool keeps up, in one sentence, and how many Max 5x
 * accounts would make it: enough to keep up with demand week after week,
 * and enough to last the next 7 days. Beside it, the next 5 and 24 hours'
 * demand against what the pool has left.
 */
export function CapacityVerdict(props: {
  runway: EngineRunway
  five: EngineHorizon | null
  usage: PoolUsage | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const { runway, five } = props
  const addition = runway.addition
  const forecast = props.usage?.forecast
  const short = runway.week_load >= 1 || runway.week_hours != null
  const tight =
    !short &&
    (runway.week_load >= 0.85 ||
      (runway.headroom_scale != null && runway.headroom_scale < 1.2))
  let tone: Tone = 'good'
  let lead = t('Enough capacity.')
  if (short) {
    tone = 'danger'
    lead = t('Not enough capacity.')
  } else if (tight) {
    tone = 'warning'
    lead = t('Capacity is tight.')
  }

  let advice: string
  if (!addition) {
    // The supply panel below gives the shortfall in dollars.
    advice = t('No measured Max 5x account in the pool to size additions with.')
  } else if (addition.for_load > 0) {
    advice = t(
      'To keep up with demand now, add {{count}} × Max 5x; each brings about {{week}} a week.',
      { count: addition.for_load, week: fmt.usdWhole(addition.week_usd) }
    )
    if (addition.for_trend > addition.for_load) {
      advice = [
        advice,
        t('If use keeps growing, {{count}} × Max 5x by the end of the week.', {
          count: addition.for_trend,
        }),
      ].join(' ')
    }
  } else if (addition.for_week != null && addition.for_week > 0) {
    advice = t(
      'Weekly supply keeps up, but the quota runs out before the next resets: {{count}} more × Max 5x cover the next 7 days.',
      { count: addition.for_week }
    )
  } else if (addition.for_trend > 0) {
    advice = t(
      'No account needed now; if use keeps growing, {{count}} × Max 5x by the end of the week.',
      { count: addition.for_trend }
    )
  } else {
    advice = t(
      'No account needed: supply keeps up with demand and lasts the next 7 days.'
    )
  }

  const toAdd = addition
    ? Math.max(addition.for_load, addition.for_week ?? addition.for_load)
    : null
  const nextFive = forecast?.next_5h_usd
  const fiveLeft = five?.remaining_usd
  let fiveTone: Tone = 'default'
  if (nextFive != null && fiveLeft != null) {
    if (nextFive > fiveLeft) fiveTone = 'danger'
    else if (nextFive > fiveLeft * 0.8) fiveTone = 'warning'
  }
  const low = forecast?.next_24h_low_usd
  const high = forecast?.next_24h_high_usd

  return (
    <Panel
      title={t('Is capacity enough?')}
      description={[lead, advice].join(' ')}
      help={t(
        'Demand and the forecasts are gpt-load spend at official prices, the unit the pool’s quota is in. An added Max 5x account is sized by the median measured Max 5x account in the pool, up to its group’s 7-day budget line, and starts a full week now. Keeping up means a weekly load of 100% or less; the 7-day figure also covers the quota running out before resets.'
      )}
    >
      <MetricGrid
        items={[
          {
            label: t('Max 5x to add'),
            help: t(
              'The more of two counts: accounts for a weekly load of 100% at today’s demand, and accounts for no gap in the next 7 days.'
            ),
            value: toAdd == null ? '-' : fmt.num(toAdd),
            tone: toAdd ? tone : 'default',
            hint: addition
              ? t(
                  'Keep up {{load}} · 7 days {{week}} · with growth {{trend}}',
                  {
                    load: addition.for_load,
                    week:
                      addition.for_week == null
                        ? t('over {{count}}', { count: 30 })
                        : addition.for_week,
                    trend: addition.for_trend,
                  }
                )
              : undefined,
          },
          {
            label: t('Next 5 hours'),
            help: t(
              'Forecast gpt-load spend over the next 5 hours, against what the accounts’ 5-hour windows have left below their budget line now. Windows reset within the 5 hours, so this comparison is cautious.'
            ),
            value: nextFive == null ? '-' : `≈ ${fmt.usdWhole(nextFive)}`,
            tone: fiveTone,
            hint:
              fiveLeft == null
                ? undefined
                : t('5-hour windows have {{amount}} left', {
                    amount: fmt.usdWhole(fiveLeft),
                  }),
          },
          {
            label: t('Next 24 hours'),
            help: t(
              'Forecast gpt-load spend over the next 24 hours: the last 24 hours’ spend moved through the day by the last week’s hourly use. The range spans the 10th to 90th percentile of how past forecasts compared with the use that followed.'
            ),
            value:
              forecast == null
                ? '-'
                : `≈ ${fmt.usdWhole(forecast.next_24h_usd)}`,
            hint:
              low != null && high != null
                ? t('Range {{low}} – {{high}}', {
                    low: fmt.usdWhole(low),
                    high: fmt.usdWhole(high),
                  })
                : undefined,
          },
        ]}
      />
    </Panel>
  )
}

type UsageRow = {
  key: string
  label: string
  quota: number
  usd: number | null
  hours: number
  forecast: boolean
}

/**
 * One provider's use over the last hour to the last week, and forecast
 * over the next 5 and 24 hours: new-api's charge in dollars and yuan,
 * that charge converted to gpt-load spend at the last week's rate, and
 * gpt-load's own spend. Below, the last 48 hours, hour by hour.
 */
export function PoolUsagePanel(props: {
  provider: PoolProvider
  usage: PoolUsage | undefined
  error?: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.usage)
  const usage = props.usage
  const name = PROVIDER_LABELS[props.provider]
  const engineReady =
    !!usage?.engine_configured && !usage.engine_error && usage.channels.length
  const rate = usage?.official_per_quota ?? 0
  const quota = (yuan: number) => charge.usd(charge.toUSD(yuan))
  const windowLabel = (hours: number) => {
    if (hours === 1) return t('Last hour')
    if (hours === 168) return t('Last 7 days')
    return t('Last {{count}} hours', { count: hours })
  }

  const rows: UsageRow[] = (usage?.windows ?? []).map((window) => ({
    key: `w${window.hours}`,
    label: windowLabel(window.hours),
    quota: window.quota,
    usd: engineReady ? window.engine_usd : null,
    hours: window.hours,
    forecast: false,
  }))
  if (usage) {
    rows.push(
      {
        key: 'f5',
        label: t('Next 5 hours (forecast)'),
        quota: usage.forecast.next_5h_quota,
        usd: engineReady ? usage.forecast.next_5h_usd : null,
        hours: 5,
        forecast: true,
      },
      {
        key: 'f24',
        label: t('Next 24 hours (forecast)'),
        quota: usage.forecast.next_24h_quota,
        usd: engineReady ? usage.forecast.next_24h_usd : null,
        hours: 24,
        forecast: true,
      }
    )
  }
  const unpriced = usage?.windows.at(-1)?.engine_unpriced ?? 0

  const points: BarPoint[] = (usage?.hourly ?? []).map((hour) => {
    const date = new Date(hour.hour * 1000)
    return {
      key: hour.hour,
      title: fmt.time(hour.hour),
      axis: date.getHours() === 0 ? fmt.day(hour.hour) : undefined,
      values: [hour.engine_usd],
      extra: [{ label: t('new-api charge'), value: quota(hour.quota) }],
    }
  })

  let description: string
  if (props.error) {
    description = props.error
  } else if (!usage) {
    description = t('Loading')
  } else if (rate > 0) {
    description = t(
      'Over the last 7 days, each ¥1 new-api charged for {{provider}} cost gpt-load {{rate}} at official prices ({{multiple}} per new-api dollar).',
      {
        provider: name,
        rate: fmt.usdFine(rate),
        multiple: fmt.multiple(rate * charge.rate),
      }
    )
  } else {
    description = t(
      'No conversion from new-api’s charge to gpt-load spend: one side has no {{provider}} use over the last 7 days.',
      { provider: name }
    )
  }

  return (
    <Panel
      title={t('{{provider}} usage', { provider: name })}
      description={description}
      help={t(
        'new-api’s charge is what it deducted for the provider’s models, root included, as on the funds view: quota dollars that customers pay ¥1 each for, so yuan, shown in dollars at the site’s exchange rate with the yuan in brackets. Converted is that charge times the last week’s gpt-load spend per yuan. gpt-load is what its channels for the provider spent at official prices, the unit the pool’s quota is in. new-api records use by the hour, up to 5 minutes late, so its windows share each hour’s use evenly; gpt-load’s are exact. Measured over converted near 1× means the conversion holds.'
      )}
    >
      <div className='grid gap-4'>
        {usage && !usage.engine_configured && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Set EngineControlURL and EngineControlKey to read the pool from corecode-engine.'
            )}
          </p>
        )}
        {usage?.engine_error && (
          <p className='text-destructive text-xs'>{usage.engine_error}</p>
        )}
        <SimpleTable<UsageRow>
          rows={rows}
          rowKey={(row) => row.key}
          empty={t('No use recorded')}
          faded={(row) => row.forecast}
          // gpt-load's figures first: they are in the pool's unit, and on
          // a phone the table scrolls sideways past the rest.
          columns={[
            {
              key: 'window',
              label: t('Window'),
              render: (row) => row.label,
            },
            {
              key: 'engine',
              label: t('gpt-load spend'),
              align: 'right',
              render: (row) => (row.usd == null ? '-' : fmt.usd(row.usd)),
            },
            {
              key: 'rate',
              label: t('Per hour'),
              hint: t('gpt-load spend per hour over the window.'),
              align: 'right',
              render: (row) =>
                row.usd == null ? '-' : fmt.usd(row.usd / row.hours),
            },
            {
              key: 'quota',
              label: t('new-api charge'),
              align: 'right',
              render: (row) => quota(row.quota),
            },
            {
              key: 'converted',
              label: t('Converted to gpt-load'),
              hint: t(
                'new-api’s charge times the last 7 days’ gpt-load spend per yuan.'
              ),
              align: 'right',
              render: (row) => (rate > 0 ? fmt.usd(row.quota * rate) : '-'),
            },
            {
              key: 'check',
              label: t('Measured ÷ converted'),
              align: 'right',
              render: (row) =>
                row.forecast || row.usd == null || rate <= 0 || row.quota <= 0
                  ? '-'
                  : fmt.multiple(row.usd / (row.quota * rate)),
            },
          ]}
        />
        {unpriced > 0 && (
          <p className='text-muted-foreground text-xs'>
            {t(
              '{{count}} requests over the last 7 days had no gpt-load price and are not in its spend.',
              { count: unpriced }
            )}
          </p>
        )}
        {points.length > 0 && engineReady && (
          <BarSeries
            ariaLabel={t('{{provider}} gpt-load spend by hour, last 48 hours', {
              provider: name,
            })}
            points={points}
            series={[
              {
                label: t('gpt-load spend'),
                format: fmt.usd,
                compact: fmt.usdCompact,
              },
            ]}
          />
        )}
      </div>
    </Panel>
  )
}
