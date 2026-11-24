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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

import {
  SECTIONS,
  type InsightsRangeInfo,
  type SourceState,
  useInsightsFormat,
} from '../lib'
import { usePartialDays } from '../partial-days'
import type { BehaviorFlag, BehaviorMetric, ModelBehavior } from '../types'
import {
  bandLabel,
  BEHAVIOR_METRICS,
  type BehaviorMetricSpec,
  behaviorColor,
  behaviorMetricLabels,
  behaviorLines,
  defaultBehaviorModels,
  lastValue,
  signedPercent,
} from './quality-behavior-analysis'
import { Panel, ProviderSwitch, SimpleTable } from './shared'
import { Fold } from './tab-fold'
import { TrendLines, type TrendLine } from './trend-lines'

const FLAG_CLASS = {
  red: 'border-destructive/40 bg-destructive/10 text-destructive',
  yellow:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
} as const

function useMetricLabels() {
  const { t } = useTranslation()
  return behaviorMetricLabels(t)
}

/** A flag as a small colored label: the model, what moved, and by how much. */
function FlagChip(props: {
  model?: string
  flag: BehaviorFlag
  label: string
}) {
  return (
    <span
      data-level={props.flag.level}
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums',
        FLAG_CLASS[props.flag.level]
      )}
    >
      {props.model && <span className='font-medium'>{props.model}</span>}
      <span>{props.label}</span>
      <span>{signedPercent(props.flag.change)}</span>
    </span>
  )
}

/**
 * How each model behaves, day by day: how long its answers and its thinking
 * are, how fast the first token and the whole reply come, the errors its
 * upstream returned and the cache it read. A day that moved more than 40%
 * against the seven days before it is yellow, past 60% red, and the models
 * with such a day today are listed on top. Requests are compared only with
 * requests of a similar input size, so a day of longer prompts is not read as
 * a model that got wordier.
 */
export function ModelBehaviorPanel(props: {
  data: ModelBehavior | undefined
  source?: SourceState
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const labels = useMetricLabels()
  const partialDay = usePartialDays('quality')
  const [metricKey, setMetricKey] = useState<BehaviorMetric | 'cache'>('output')
  const [picked, setPicked] = useState<string[]>()
  const data = props.data
  const failed = props.source?.status === 'error'
  const models = data?.models ?? []
  const shown = picked ?? defaultBehaviorModels(models)
  const metric =
    BEHAVIOR_METRICS.find((item) => item.key === metricKey) ??
    BEHAVIOR_METRICS[0]
  const lines = behaviorLines(models, shown, metric)
  const days = models[0]?.daily.map((day) => day.day) ?? []
  const alerts = data?.alerts ?? []
  const red = alerts.filter((alert) => alert.level === 'red').length
  const formatUnit = (unit: BehaviorMetricSpec['unit'], value: number) => {
    switch (unit) {
      case 'ms':
        return fmt.measuredMs(value)
      case 'seconds':
        return fmt.measuredMs(value * 1000)
      case 'share':
        return fmt.pct(value)
      default:
        return fmt.num(value)
    }
  }
  const format = (value: number) => formatUnit(metric.unit, value)
  const trendLines: TrendLine[] = lines.map((line) => {
    const last = lastValue(line.values)
    return {
      key: line.model,
      label: line.model,
      color: line.color,
      dashed: line.dashed,
      values: line.values,
      summary: last == null ? undefined : format(last),
    }
  })
  const detail = (line: TrendLine, index: number) => {
    const flag = lines.find((item) => item.model === line.key)?.flags[index]
    if (!flag) return undefined
    const change = signedPercent(flag.change)
    if (flag.metric === 'errors') {
      return t('{{change}}, against {{baseline}} before', {
        change,
        baseline: fmt.pct(flag.baseline),
      })
    }
    return t('{{change}} against the 7 days before, inputs {{band}}', {
      change,
      band: bandLabel(data?.band_limits ?? [], flag.band),
    })
  }
  let description: string | undefined
  if (data) {
    description =
      alerts.length > 0
        ? t(
            'On the last day {{count}} model readings moved past a threshold: {{red}} red.',
            { count: alerts.length, red }
          )
        : t('No model moved past 40% against its previous seven days.')
  }
  const loading = !data && !failed
  const lastDay = (name: string) =>
    models.find((row) => row.model === name)?.daily.at(-1)
  return (
    <Panel
      id={SECTIONS.modelBehavior}
      title={t('Model behavior')}
      description={description}
      help={t(
        'Per model and day: the median output tokens, reasoning tokens, first-token time and total time, the upstream errors, and the share of input read from the cache. A reading that moved more than 40% (yellow) or 60% (red) against the seven days before is flagged, when both sides have at least 50 requests. Requests are compared only with requests of a similar input size, so a day of longer prompts is not read as a model that got wordier. Customers only.'
      )}
      error={failed ? t('Could not be read') : undefined}
    >
      <div className='grid gap-3'>
        {loading && (
          <div
            role='status'
            aria-label={t('Loading...')}
            className='grid gap-2'
          >
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-24 w-full' />
          </div>
        )}
        {alerts.length > 0 && (
          <ul
            aria-label={t('Models that moved on the last day')}
            className='flex flex-wrap gap-1.5'
          >
            {alerts.map((alert) => (
              <li key={`${alert.model}-${alert.metric}`}>
                <FlagChip
                  model={alert.model}
                  flag={alert}
                  label={labels[alert.metric]}
                />
              </li>
            ))}
          </ul>
        )}
        {data && models.length === 0 && (
          <p className='text-muted-foreground text-xs'>
            {t('No model has enough requests in this range')}
          </p>
        )}
        {data && models.length > 0 && (
          <>
            <ProviderSwitch
              ariaLabel={t('Metric')}
              value={metricKey}
              items={BEHAVIOR_METRICS.map((item) => ({
                key: item.key,
                label: labels[item.key],
              }))}
              onChange={setMetricKey}
            />
            <ToggleGroup
              multiple
              variant='outline'
              size='sm'
              className='max-w-full flex-wrap justify-start'
              aria-label={t('Models shown')}
              value={shown}
              onValueChange={(value: string[]) => setPicked(value)}
            >
              {models.map((row, index) => (
                <ToggleGroupItem key={row.model} value={row.model}>
                  <span
                    aria-hidden
                    className='size-2 rounded-full'
                    style={{
                      background: shown.includes(row.model)
                        ? lines.find((line) => line.model === row.model)?.color
                        : behaviorColor(index),
                      opacity: shown.includes(row.model) ? 1 : 0.35,
                    }}
                  />
                  {row.model}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {trendLines.every((line) => line.values.every((v) => v == null)) ? (
              <p className='text-muted-foreground text-xs'>
                {metric.key === 'reasoning'
                  ? t(
                      'Reasoning tokens are recorded only for requests made after this release, so earlier days have none.'
                    )
                  : t('No model has enough requests in this range')}
              </p>
            ) : (
              <TrendLines
                ariaLabel={labels[metric.key]}
                titles={days.map((day) => fmt.day(day))}
                axis={days.map((day) => fmt.day(day))}
                lines={trendLines}
                format={format}
                partial={days.map((day) => !!partialDay(day))}
                detail={detail}
              />
            )}
            {(data.missing_hours ?? 0) > 0 && (
              <p className='text-muted-foreground text-xs'>
                {t(
                  '{{count}} hours of this range are still being read, so their requests are missing from the lines.',
                  { count: data.missing_hours }
                )}
              </p>
            )}
            <Fold summary={t('The last day, by model')}>
              <SimpleTable
                rows={models.filter((row) => shown.includes(row.model))}
                rowKey={(row) => row.model}
                empty={t('No model has enough requests in this range')}
                columns={[
                  {
                    key: 'model',
                    label: t('Model'),
                    render: (row) => row.model,
                  },
                  {
                    key: 'requests',
                    label: t('Requests'),
                    align: 'right',
                    render: (row) => fmt.num(lastDay(row.model)?.requests ?? 0),
                  },
                  ...BEHAVIOR_METRICS.map((item) => ({
                    key: item.key,
                    label: labels[item.key],
                    align: 'right' as const,
                    render: (row: { model: string }) => {
                      const day = lastDay(row.model)
                      const value = day ? item.pick(day) : null
                      return value == null ? '—' : formatUnit(item.unit, value)
                    },
                  })),
                  {
                    key: 'flags',
                    label: t('Flags'),
                    render: (row) => (
                      <span className='flex flex-wrap gap-1'>
                        {(lastDay(row.model)?.flags ?? []).map((flag) => (
                          <FlagChip
                            key={flag.metric}
                            flag={flag}
                            label={labels[flag.metric]}
                          />
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
            </Fold>
          </>
        )}
      </div>
    </Panel>
  )
}
