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

import type { Contribution } from '../analysis'
import { segmentChanges, signupBurst } from '../growth-analysis'
import {
  useInsightsFormat,
  useSignupMethodLabel,
  type InsightsRangeInfo,
  type InsightsTab,
} from '../lib'
import type { GrowthInsights } from '../types'
import { signupDrivers } from '../verdicts/growth'
import { Drivers, Findings, type DriverRow, type Finding } from './insight-kit'
import { Panel } from './shared'

/**
 * Which sign-up methods and referral segments moved sign-ups against the
 * previous period, and, at a short range, an hour that held a burst.
 */
export function SignupDriversPanel(props: {
  data: GrowthInsights | undefined
  previous?: GrowthInsights
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const label = useSignupMethodLabel()
  const data = props.data
  const previous = props.previous
  const burst = props.range?.hourly ? signupBurst(data?.hourly) : null
  if (!data || (!previous && !burst)) return null
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
