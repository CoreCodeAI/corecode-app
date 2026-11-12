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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { Contribution } from '../analysis'
import { segmentChanges, signupBurst } from '../growth-analysis'
import {
  MIN_COHORT,
  useChargeFormat,
  useInsightsFormat,
  useSignupMethodLabel,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import type { GrowthInsights, PayerActivity, PaymentTiming } from '../types'
import { signupDrivers } from '../verdicts/growth'
import { Drivers, Findings, type DriverRow, type Finding } from './insight-kit'
import { BarSeries, Panel, SimpleTable, UserLabel } from './shared'

const LINK = 'text-primary font-medium hover:underline'

/**
 * Which sign-up methods and referral segments moved sign-ups against the
 * previous period, and, at a short range, an hour that held a burst.
 */
export function SignupDriversPanel(props: {
  data: GrowthInsights | undefined
  previous?: GrowthInsights
  /** Why the previous period is missing, said in place of the changes. */
  previousError?: string
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const previousError = previous ? undefined : props.previousError
  const burst = props.range?.hourly ? signupBurst(data?.hourly) : null
  if (!data || (!previous && !burst && !previousError)) return null
  const rows = (parts: Contribution[]): DriverRow[] =>
    parts.map((part) => ({
      key: part.key,
      label: label(part.key),
      change:
        part.change > 0 ? `+${fmt.num(part.change)}` : fmt.num(part.change),
      share: `${fmt.num(part.previous)} → ${fmt.num(part.current)}`,
      tone: part.change > 0 ? 'good' : 'warning',
    }))
  const drivers = signupDrivers(data, previous)
  const findings: Finding[] = burst
    ? [
        {
          key: 'burst',
          tone: 'warning',
          title: t(
            '{{count}} sign-ups, {{share}} of the range, came in the hour from {{time}}.',
            {
              count: fmt.num(burst.registered),
              share: fmt.pct(burst.share),
              time: fmt.time(burst.hour),
            }
          ),
          detail: t(
            'A promotion post or a sign-up farm. Check shared addresses and alias emails on the risk tab.'
          ),
          tab: 'risk',
          impact: burst.registered,
        },
      ]
    : []
  let description: string | undefined
  if (drivers.length > 0) {
    description = t('{{segments}} explain most of the change.', {
      segments: drivers.map((part) => label(part.key)).join(t(', ')),
    })
  }
  return (
    <Panel
      title={t('What moved sign-ups')}
      description={description}
      error={previousError}
      help={t(
        'Each segment’s sign-ups against the same segment in the previous period. Sign-up counts are fair to compare at any range; activation and payment are not, since a newer cohort has had less time.'
      )}
    >
      <div className='grid gap-4'>
        <Findings items={findings} onOpen={props.onOpen} />
        {previous && (
          <div className='grid gap-4 sm:grid-cols-2'>
            <Drivers
              title={t('By sign-up method')}
              rows={rows(segmentChanges(data.by_source, previous.by_source))}
              empty={t('No change by sign-up method.')}
            />
            <Drivers
              title={t('By referral')}
              rows={rows(segmentChanges(data.by_invite, previous.by_invite))}
              empty={t('No change by referral.')}
            />
          </div>
        )}
      </div>
    </Panel>
  )
}

/**
 * How long the range's paying sign-ups took to pay for the first time: the
 * median, the shares within a day and a week, and a bar per span of days.
 * Under MIN_COHORT payers it gives the count only, since a share of a few
 * people reads as a trend.
 */
export function PaymentTimingPanel(props: {
  timing: PaymentTiming | null | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const timing = props.timing
  if (!timing) return null
  const small = timing.payers < MIN_COHORT
  const share = (count: number) =>
    timing.payers > 0 ? fmt.pct(count / timing.payers) : '-'
  return (
    <Panel
      title={t('Time to first payment')}
      help={t(
        'For the sign-ups in the range who have paid: the time from sign-up to their first paid order, by whole days. The median is over payers only; sign-ups who have not paid yet are not in it.'
      )}
      description={
        small
          ? t('{{count}} payers, too few to give a median or shares.', {
              count: fmt.num(timing.payers),
            })
          : t(
              'Median {{hours}} hours from sign-up to first payment; {{day}} within a day, {{week}} within a week.',
              {
                hours: fmt.num(timing.median_hours),
                day: share(timing.same_day),
                week: fmt.pct(timing.within_week),
              }
            )
      }
    >
      {!small && (
        <BarSeries
          ariaLabel={t('Time to first payment')}
          series={[{ label: t('Payers') }]}
          points={[
            {
              key: 'same',
              title: t('Same day'),
              values: [timing.same_day],
              extra: [{ label: t('Share'), value: share(timing.same_day) }],
            },
            {
              key: 'days-1-3',
              title: t('Days 1 to 3'),
              values: [timing.days_1_3],
              extra: [{ label: t('Share'), value: share(timing.days_1_3) }],
            },
            {
              key: 'days-4-7',
              title: t('Days 4 to 7'),
              values: [timing.days_4_7],
              extra: [{ label: t('Share'), value: share(timing.days_4_7) }],
            },
            {
              key: 'later',
              title: t('Later'),
              values: [timing.later],
              extra: [{ label: t('Share'), value: share(timing.later) }],
            },
          ]}
        />
      )}
    </Panel>
  )
}

/**
 * The payers who used quota before the range's last two weeks and none in
 * them: their count, the share of recent payers they are, and the largest of
 * them, each linked to its account in Users.
 */
export function PayerActivityPanel(props: {
  activity: PayerActivity | null | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(undefined)
  const activity = props.activity
  if (!activity) return null
  const recent = activity.active + activity.lapsed
  const small = recent < MIN_COHORT
  return (
    <Panel
      title={t('Payers gone quiet')}
      help={t(
        'Payers who paid before the range ends and used quota in the 14 days before its last 14, but none in those last 14 days. Staff are left out. Ranked by the quota they used before going quiet.'
      )}
      description={
        small
          ? t(
              '{{count}} payers have gone quiet; too few recent payers to give a share.',
              { count: fmt.num(activity.lapsed) }
            )
          : t(
              '{{count}} payers have gone quiet: {{share}} of the {{recent}} who used quota in the last 28 days.',
              {
                count: fmt.num(activity.lapsed),
                share: fmt.pct(activity.lapsed / recent),
                recent: fmt.num(recent),
              }
            )
      }
    >
      <SimpleTable
        rows={activity.top}
        rowKey={(row) => row.user_id}
        empty={t('No payer has gone quiet in this range')}
        columns={[
          {
            key: 'user',
            label: t('User'),
            render: (row) =>
              row.username ? (
                <Link
                  to='/users'
                  search={{ filter: row.username }}
                  className={LINK}
                >
                  <UserLabel user_id={row.user_id} username={row.username} />
                </Link>
              ) : (
                <UserLabel user_id={row.user_id} username={row.username} />
              ),
          },
          {
            key: 'before',
            label: t('Used before'),
            hint: t(
              'The quota the payer used in the 14 days before the last 14 days of the range.'
            ),
            align: 'right',
            render: (row) => charge.usd(charge.toUSD(row.quota_usd)),
          },
        ]}
      />
    </Panel>
  )
}
