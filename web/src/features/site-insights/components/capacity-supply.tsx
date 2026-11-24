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

import { beforeLogs } from '../analysis'
import { dailyRequests, localDay } from '../capacity-analysis'
import { weekSupply } from '../capacity-supply'
import { TONES, useInsightsFormat } from '../lib'
import type { CapacityHour, EngineOutlook } from '../types'
import { COVERAGE_TONES } from './outlook'
import { BarSeries, Meter, Panel } from './shared'

const DAY_SECONDS = 86400

/**
 * The week ahead as one gauge: what the forecast asks of the pool, over what
 * the pool can spend, with the accounts to add when it falls short. Nothing
 * while the outlook is absent or cannot be built, so a tab without it reads
 * as before.
 */
export function SupplyDemandPanel(props: {
  outlook: EngineOutlook | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const supply = weekSupply(props.outlook)
  if (!supply) return null
  const tone = COVERAGE_TONES[supply.coverage]
  let verdict = t('The pool covers the week.')
  if (supply.coverage === 'tight') {
    verdict = t('The week takes most of what the pool can spend.')
  } else if (supply.coverage === 'short') {
    verdict = t('The pool cannot serve all of the week’s demand.')
  }
  return (
    <Panel
      title={t('Next 7 days: demand over supply')}
      help={t(
        'The smart forecast’s demand for the next 7 days, over the most the Claude pool can spend in them, weekly and 5-hour resets included. Above 100% the pool cannot serve it all; the gauge turns yellow above 80%.'
      )}
    >
      <div className='grid gap-3'>
        <p
          className={`text-3xl font-semibold tabular-nums ${TONES[tone]}`}
          data-testid='supply-ratio'
        >
          {fmt.pct(supply.ratio)}
        </p>
        <Meter
          value={supply.ratio * 100}
          tone={tone}
          label={t('Next 7 days: demand over supply')}
        />
        <p className='text-muted-foreground text-xs'>
          {t('{{demand}} forecast demand of {{supply}} the pool can spend.', {
            demand: fmt.usd(supply.demand),
            supply: fmt.usd(supply.supply),
          })}
        </p>
        <p className={`text-xs ${TONES[tone]}`}>{verdict}</p>
        {supply.coverage !== 'enough' && supply.add && (
          <p className='text-xs'>
            {t('Add {{count}} {{plan}} {{tier}} accounts to leave no gap.', {
              count: supply.add.count,
              plan: supply.add.plan,
              tier: supply.add.tier,
            })}
          </p>
        )}
      </div>
    </Panel>
  )
}

/**
 * The whole days' requests, the failed among them split off, over the same
 * days the daily peak chart draws, so the two read side by side.
 */
export function DailyRequestsPanel(props: {
  hourly: CapacityHour[]
  end: number
  logsSince?: number | null
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const days = dailyRequests(props.hourly, props.end, localDay)
  return (
    <Panel
      title={t('Daily requests')}
      help={t(
        'Customers’ requests per whole day, with the failed ones apart. A day the range cuts, such as its first and today, is left out, as in the daily peak chart.'
      )}
    >
      <BarSeries
        ariaLabel={t('Daily requests')}
        series={[
          { label: t('Succeeded'), compact: fmt.numCompact },
          { label: t('Failed'), compact: fmt.numCompact },
        ]}
        points={days.map((day) => ({
          key: day.day,
          title: fmt.day(day.day),
          values: [day.requests - day.errors, day.errors],
          missing: beforeLogs(day.day, DAY_SECONDS, props.logsSince),
        }))}
      />
    </Panel>
  )
}
