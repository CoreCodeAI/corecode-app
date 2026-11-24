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

import { useHourAxis, useInsightsFormat, type InsightsRangeInfo } from '../lib'
import { usePartialDays } from '../partial-days'
import { blocksAt, stagesSeen, type GateBlockPoint } from '../risk-gate-stages'
import type { RiskInsights } from '../types'
import { BarSeries, Panel, type BarPoint } from './shared'

/**
 * The requests the risk gate blocked, by hour or day, stacked by the stage that
 * blocked them. Observe-mode hits are not blocks and are left out, as are
 * administrators'. Nothing on a server that does not send the series.
 */
export function GateBlocksPanel(props: {
  data: RiskInsights | undefined
  range?: InsightsRangeInfo
  failed?: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('risk')
  const hourAxis = useHourAxis()
  const data = props.data
  if (data && data.gate_block_series == null) return null
  const series = data?.gate_block_series ?? []
  const stages = stagesSeen(series)
  const labels: Record<string, string> = {
    distill: t('Distillation'),
    hard_regex: t('Hard regex'),
    refusal_cache: t('Refusal cache'),
    decision: t('Decision model'),
  }
  const shown = stages.length > 0 ? stages : ['blocked']
  const valuesOf = (point: GateBlockPoint) =>
    stages.length > 0
      ? stages.map((stage) => point.stages?.[stage] ?? 0)
      : [blocksAt(point)]
  const daily = data?.series_unit === 'day'
  const end = props.range?.end ?? Number.POSITIVE_INFINITY
  const step = daily ? 86400 : 3600
  let points: BarPoint[]
  if (daily) {
    points = series.map((point) => ({
      key: point.at,
      title: fmt.day(point.at),
      values: valuesOf(point),
      faded: point.at + step > end,
      partial: partialDay(point.at, valuesOf(point)),
    }))
  } else {
    points = hourAxis.bars(
      series.map((point) => ({ hour: point.at, point })),
      end,
      (row) => ({ values: valuesOf(row.point) })
    )
  }
  const total = data?.gate_blocked ?? 0
  return (
    <Panel
      title={t('Gate blocks by stage')}
      description={
        data
          ? t('{{count}} requests blocked in this range.', {
              count: fmt.num(total),
            })
          : undefined
      }
      help={t(
        'Requests the risk gate rejected, by hour or day, stacked by the stage that stopped them. Observe-mode hits would have been rejected but passed, so they are not counted. Root and staff are left out.'
      )}
    >
      {props.failed ? (
        <p className='text-muted-foreground text-xs'>
          {t('Could not be read')}
        </p>
      ) : (
        <BarSeries
          ariaLabel={t('Gate blocks by stage')}
          series={shown.map((stage) => ({
            label:
              labels[stage] ?? (stage === 'blocked' ? t('Blocked') : stage),
          }))}
          points={points}
        />
      )}
    </Panel>
  )
}
