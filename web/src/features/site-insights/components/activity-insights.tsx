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
  busiestHour,
  customerMoves,
  hourSpan,
  type CustomerMove,
} from '../growth-analysis'
import {
  TONES,
  useChargeFormat,
  useHourAxis,
  useInsightsFormat,
  type InsightsRangeInfo,
} from '../lib'
import type { ActivityHour, ActivityInsights } from '../types'
import { SampleNote, TabLink } from './insight-kit'
import { BarSeries, Panel, SimpleTable, UserLabel } from './shared'

/** A customer's share of consumption this period fell by at least this much. */
const DROP_SHARE_OF_SPEND = 0.5

/** Active users by hour, each against the previous period's same hour. */
export function HourlyActivePanel(props: {
  rows: ActivityHour[]
  previous?: ActivityInsights
  range: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const hours = useHourAxis()
  const before = alignPrevious(
    props.rows,
    props.previous?.hourly,
    hourSpan(props.range)
  )
  const busiest = busiestHour(
    props.rows,
    props.range.end,
    (row) => row.active_users
  )
  return (
    <Panel
      title={t('Active users by hour')}
      description={
        busiest
          ? t('Busiest hour {{time}}: {{count}} active users.', {
              time: fmt.time(busiest.hour),
              count: fmt.num(busiest.active_users),
            })
          : undefined
      }
      help={t(
        'Users who sent a request in the hour. The readout lists the same hour of the previous period. The last hour is still filling.'
      )}
    >
      <BarSeries
        ariaLabel={t('Active users by hour')}
        series={[{ label: t('Active users') }]}
        points={hours.bars(props.rows, props.range.end, (row, index) => ({
          values: [row.active_users],
          extra: [
            { label: t('Requests'), value: fmt.num(row.requests) },
            ...(before[index]
              ? [
                  {
                    label: t('Same hour, previous period'),
                    value: fmt.num(before[index].active_users),
                  },
                ]
              : []),
          ],
        }))}
      />
    </Panel>
  )
}

/** Consumption by hour in dollars, with yuan and the previous period's same hour in the readout. */
export function HourlyConsumptionPanel(props: {
  data: ActivityInsights
  rows: ActivityHour[]
  previous?: ActivityInsights
  range: InsightsRangeInfo
  totals: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const hours = useHourAxis()
  const before = alignPrevious(
    props.rows,
    props.previous?.hourly,
    hourSpan(props.range)
  )
  const busiest = busiestHour(
    props.rows,
    props.range.end,
    (row) => row.quota_usd
  )
  return (
    <Panel
      title={t('Consumption by hour')}
      help={t(
        'What new-api charged in the hour, quota dollars that customers pay ¥1 each for, so yuan, shown in dollars at the site’s exchange rate. The readout lists the yuan and the same hour of the previous period. The last hour is still filling.'
      )}
      description={[
        props.totals,
        busiest
          ? t('Busiest hour {{time}}: {{amount}}.', {
              time: fmt.time(busiest.hour),
              amount: fmt.usd(charge.toUSD(busiest.quota_usd)),
            })
          : undefined,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <BarSeries
        ariaLabel={t('Consumption by hour')}
        series={[
          {
            label: t('new-api, US$'),
            format: fmt.usd,
            compact: fmt.usdCompact,
          },
        ]}
        points={hours.bars(props.rows, props.range.end, (row, index) => ({
          values: [charge.toUSD(row.quota_usd)],
          extra: [
            { label: t('new-api, ¥'), value: fmt.cny(row.quota_usd) },
            { label: t('Requests'), value: fmt.num(row.requests) },
            ...(before[index]
              ? [
                  {
                    label: t('Same hour, previous period'),
                    value: fmt.usd(charge.toUSD(before[index].quota_usd)),
                  },
                ]
              : []),
          ],
        }))}
      />
    </Panel>
  )
}

type MoverRow = CustomerMove & { requests?: number; share?: number }

/**
 * The top customers with each one's change against the previous period;
 * customers new to the list and those that left it or halved are marked.
 */
export function TopCustomersPanel(props: {
  data: ActivityInsights | undefined
  previous?: ActivityInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const data = props.data
  const previous = props.previous
  const moves = new Map(
    customerMoves(data?.top_users, previous?.top_users).map((move) => [
      move.user_id,
      move,
    ])
  )
  const rows: MoverRow[] | undefined = data
    ? [
        ...data.top_users.map((row) => ({
          ...(moves.get(row.user_id) as CustomerMove),
          requests: row.requests,
          share: row.share,
        })),
        ...(previous ? [...moves.values()].filter((move) => move.left) : []),
      ]
    : undefined
  const dropped = (row: MoverRow) =>
    row.left ||
    (row.previous > 0 && row.change <= -DROP_SHARE_OF_SPEND * row.previous)
  const entered = rows?.filter((row) => row.entered).length ?? 0
  const fell = rows?.filter(dropped).length ?? 0
  const signed = (yuan: number) => {
    const usd = fmt.usd(charge.toUSD(yuan))
    return yuan > 0 ? `+${usd}` : usd
  }
  return (
    <Panel
      title={t('Top customers by consumption')}
      description={
        previous && data && data.top_users.length > 0
          ? t(
              '{{entered}} new to the list and {{dropped}} that left it or halved, against the previous period.',
              { entered: fmt.num(entered), dropped: fmt.num(fell) }
            )
          : undefined
      }
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.user_id}
        faded={(row) => row.left}
        empty={t('No consumption in this range')}
        columns={[
          {
            key: 'user',
            label: t('User'),
            render: (row) => (
              <span className='inline-flex items-baseline gap-2'>
                <UserLabel user_id={row.user_id} username={row.username} />
                {previous && row.entered && (
                  <span className={`text-xs ${TONES.good}`}>{t('New')}</span>
                )}
                {previous && dropped(row) && (
                  <span className={`text-xs ${TONES.warning}`}>
                    {row.left ? t('Left the list') : t('Halved')}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'usd',
            label: t('Consumption'),
            align: 'right',
            render: (row) =>
              row.left ? '-' : charge.usd(charge.toUSD(row.current)),
          },
          ...(previous
            ? [
                {
                  key: 'change',
                  label: t('vs. previous period'),
                  hint: t(
                    'Against the previous period. The server lists 20 customers a period; one missing from a full list counts at its smallest figure, so the change shown is the least it can be.'
                  ),
                  align: 'right' as const,
                  render: (row: MoverRow) =>
                    row.left
                      ? t('was {{amount}}', {
                          amount: fmt.usd(charge.toUSD(row.previous)),
                        })
                      : signed(row.change),
                },
              ]
            : []),
          {
            key: 'share',
            label: t('Share'),
            align: 'right',
            render: (row) => (row.share == null ? '-' : fmt.pct(row.share)),
          },
          {
            key: 'req',
            label: t('Requests'),
            align: 'right',
            render: (row) =>
              row.requests == null ? '-' : fmt.num(row.requests),
          },
        ]}
      />
    </Panel>
  )
}

/** Said in place of the retention grid at a short range, which holds a cohort or two. */
export function RetentionNeedsRange() {
  const { t } = useTranslation()
  return (
    <div className='grid gap-1'>
      <SampleNote>
        {t(
          'A short range holds only a sign-up day or two, too few to read retention.'
        )}
      </SampleNote>
      <p className='text-xs'>
        <TabLink tab='activity' search={{ days: 30 }}>
          {t('See the last 30 days')}
        </TabLink>
      </p>
    </div>
  )
}
