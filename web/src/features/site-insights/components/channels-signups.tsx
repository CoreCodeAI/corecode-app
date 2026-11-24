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

import { useInsightsFormat, type SourceState } from '../lib'
import type { ChannelInsights, ChannelRow } from '../types'
import { channelKey } from './channels-analysis'
import { RankBars } from './growth-charts'
import { BarSeries, Panel } from './shared'

/** Sources drawn as their own series in the daily chart; the rest fold into Other. */
const NAMED_SOURCES = 3

/** The name of a source, as the tables name it. */
function useSourceName() {
  const { t } = useTranslation()
  return (row: Pick<ChannelRow, 'segment' | 'channel'>) => {
    if (row.segment === 'invited') return t('Other invitations')
    if (row.segment === 'organic') return t('Organic')
    return row.channel.username || `#${row.channel.user_id}`
  }
}

/**
 * What each source brought, as three ranked bars side by side: the accounts
 * that signed up in the range, those of them that paid, and the money the
 * source's accounts paid in the range.
 */
export function ChannelBarsPanel(props: {
  rows: ChannelRow[]
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = useSourceName()
  const failed = props.source?.status === 'error' && props.rows.length === 0
  const item = (value: (row: ChannelRow) => number) =>
    props.rows.map((row) => ({
      key: channelKey(row),
      label: name(row),
      value: value(row),
    }))
  const empty = t('No data')
  return (
    <Panel
      title={t('What each source brought')}
      id='source-bars'
      error={failed ? t('Could not be read') : undefined}
      help={t(
        'Sign-ups and Paying accounts follow the accounts created in the range, up to now, as the sign-up table below does. Revenue is what every account the source ever brought paid in the range, as the return table below does. The largest eight sources are shown for each.'
      )}
    >
      {failed ? null : (
      <div className='grid gap-6 md:grid-cols-3'>
        <div className='grid content-start gap-2'>
          <h4 className='text-muted-foreground text-xs font-medium'>
            {t('Sign-ups')}
          </h4>
          <RankBars
            items={item((row) => row.registered)}
            format={fmt.num}
            empty={empty}
          />
        </div>
        <div className='grid content-start gap-2'>
          <h4 className='text-muted-foreground text-xs font-medium'>
            {t('Paying accounts')}
          </h4>
          <RankBars
            items={item((row) => row.paid)}
            format={fmt.num}
            barClass='bg-sky-500/70'
            empty={empty}
          />
        </div>
        <div className='grid content-start gap-2'>
          <h4 className='text-muted-foreground text-xs font-medium'>
            {t('Revenue')}
          </h4>
          <RankBars
            items={item((row) => row.revenue)}
            format={fmt.cny}
            barClass='bg-[var(--series-3)]/70'
            empty={empty}
          />
        </div>
      </div>
      )}
    </Panel>
  )
}

/**
 * Sign-ups of each day stacked by source: the three sources with the most
 * sign-ups in the range, the rest together in gray.
 */
export function ChannelDailyPanel(props: {
  data: ChannelInsights | undefined
  rows: ChannelRow[]
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const name = useSourceName()
  const days = props.data?.signups_by_day
  // A server that does not send the days leaves the panel out.
  if (!days) return null
  const totals = new Map<string, number>()
  for (const day of days) {
    for (const source of day.sources) {
      const key = `${source.segment}-${source.channel_id}`
      totals.set(key, (totals.get(key) ?? 0) + source.registered)
    }
  }
  const named = props.rows
    .filter((row) => (totals.get(channelKey(row)) ?? 0) > 0)
    .sort(
      (a, b) =>
        (totals.get(channelKey(b)) ?? 0) - (totals.get(channelKey(a)) ?? 0)
    )
    .slice(0, NAMED_SOURCES)
  const keys = named.map(channelKey)
  const folded = [...totals.values()].reduce((sum, n) => sum + n, 0)
  const hasOther = named.reduce(
    (sum, row) => sum + (totals.get(channelKey(row)) ?? 0),
    0
  ) < folded
  const series = [
    ...named.map((row) => ({ label: name(row) })),
    ...(hasOther ? [{ label: t('Other sources'), muted: true }] : []),
  ]
  return (
    <Panel
      title={t('Sign-ups by day and source')}
      id='signups-by-source'
      help={t(
        'Accounts created on each day of the range, by the source that brought them: a promotion channel, another invitation, or organic. The three sources with the most sign-ups have their own color; the rest are gray.'
      )}
    >
      {series.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          {t('No sign-ups in this range')}
        </p>
      ) : (
        <BarSeries
          ariaLabel={t('Sign-ups by day and source')}
          series={series}
          points={days.map((day) => {
            const counts = new Map(
              day.sources.map((source) => [
                `${source.segment}-${source.channel_id}`,
                source.registered,
              ])
            )
            const values = keys.map((key) => counts.get(key) ?? 0)
            const other =
              day.sources.reduce((sum, source) => sum + source.registered, 0) -
              values.reduce((sum, n) => sum + n, 0)
            return {
              key: day.day,
              title: fmt.day(day.day),
              values: hasOther ? [...values, other] : values,
            }
          })}
        />
      )}
    </Panel>
  )
}
