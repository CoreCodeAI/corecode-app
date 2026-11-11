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

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import {
  countsRequestsOnce,
  failureTone,
  joinSentences,
  SMALL_SAMPLE,
  tableState,
  TONES,
  useInsightsDefinitions,
  useInsightsFormat,
  useVendorName,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from '../lib'
import {
  abnormalStreams,
  attemptsOf,
  excessFailures,
  failingTaskModels,
  failingWindow,
  failsAboveSite,
  failuresListed,
  failureShift,
  hourFlags,
  mediaModels,
  modelChange,
  rankByExcess,
  serviceFailureRate,
  siteFailureRate,
  unplacedModels,
  withRemainder,
  type QualityAttempts,
} from '../quality-analysis'
import type { BusinessInsights, QualityInsights, VendorQuality } from '../types'
import { useQualityVerdict } from '../verdicts'
import { ModelMap } from './advanced-charts'
import { ClientsPanel } from './business-panels'
import { Findings, StaleNote, type Finding } from './insight-kit'
import {
  DailyFailurePanel,
  FailureDriversPanel,
  FailureOwnersPanel,
  QualityHourlyPanels,
  UnplacedModels,
} from './quality-insights'
import { RefusalsPanel, TaskOutcomesPanel } from './quality-tasks'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  TruncatedNotice,
  type MetricItem,
  type Tone,
  Verdict,
} from './shared'

// The model map's own floor: models with fewer requests are noise there.
const MAP_MIN_REQUESTS = 20

const RATE_TONES: Record<Tone, string> = {
  default: '',
  good: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive font-medium',
}

function useVendorLabels(): Record<string, string> {
  const { t } = useTranslation()
  return {
    claude: t('Claude'),
    codex: t('GPT'),
    grok: t('Grok'),
    gemini: t('Gemini'),
    media: t('Image and video'),
    other: t('Other'),
  }
}

function sameModels(a: string[], b: string[]) {
  return a.length === b.length && a.every((name) => b.includes(name))
}

/**
 * One card per vendor, plus one for every model, each with its own figures
 * whatever the filter selects. A click narrows the tab to that vendor's
 * models; the all-models card clears the filter.
 */
function VendorCards(props: {
  all?: VendorQuality
  vendors?: VendorQuality[] | null
  selected: string[]
  onChange: (models: string[]) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const labels = useVendorLabels()
  const vendors = props.vendors ?? []
  if (!props.all || vendors.length === 0) return null
  const cards = [
    { key: 'all', label: t('All models'), models: [], figures: props.all },
    ...vendors.map((vendor) => ({
      key: vendor.vendor,
      label: labels[vendor.vendor] ?? vendor.vendor,
      models: vendor.models ?? [],
      figures: vendor,
    })),
  ]

  return (
    <div
      role='group'
      aria-label={t('Quick select by vendor')}
      className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'
    >
      {cards.map((card) => {
        const active = sameModels(props.selected, card.models)
        // Under a filter the all-models card would repeat unfiltered figures
        // beside the filtered ones below; it only clears the filter.
        if (card.key === 'all' && props.selected.length > 0) {
          return (
            <button
              key={card.key}
              type='button'
              aria-pressed={false}
              onClick={() => props.onChange([])}
              className='bg-muted/20 hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none'
            >
              <span className='truncate text-xs font-medium'>{card.label}</span>
              <span className='text-muted-foreground text-xs'>
                {t('Clear the filter')}
              </span>
            </button>
          )
        }
        const ttft = card.figures.ttft_p50_ms
          ? `${fmt.measuredMs(card.figures.ttft_p50_ms)} / ${fmt.measuredMs(card.figures.ttft_p95_ms)}`
          : '—'
        return (
          <button
            key={card.key}
            type='button'
            aria-pressed={active}
            onClick={() => props.onChange(card.models)}
            className={cn(
              'bg-muted/20 hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active && 'border-primary bg-primary/5 ring-primary ring-1'
            )}
          >
            <span className='flex items-baseline justify-between gap-2 text-xs'>
              <span className='truncate font-medium'>{card.label}</span>
              {card.key !== 'all' && (
                <span className='text-muted-foreground shrink-0'>
                  {t('{{count}} models', { count: card.models.length })}
                </span>
              )}
            </span>
            <span className='text-muted-foreground text-[11px]'>
              TTFT p50 / p95
            </span>
            <span
              className={cn(
                'truncate text-lg font-semibold tabular-nums',
                card.figures.ttft_p95_ms > 10000 &&
                  'text-amber-600 dark:text-amber-400'
              )}
            >
              {ttft}
            </span>
            <span className='text-muted-foreground truncate text-xs tabular-nums'>
              {t('{{requests}} requests · {{rate}} failed', {
                requests: fmt.num(card.figures.requests),
                rate: fmt.pct(card.figures.error_rate),
              })}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Picks the models the quality figures cover. The options are the table's
 * models, which the filter does not narrow; a selected model with no traffic
 * in the range stays listed so it can be cleared.
 */
function ModelFilter(props: {
  options?: QualityInsights['models']
  selected: string[]
  onChange: (models: string[]) => void
}) {
  const { t } = useTranslation()
  const rows = props.options ?? []
  const names = [
    ...rows.map((row) => row.model),
    ...props.selected.filter((name) => !rows.some((row) => row.model === name)),
  ]
  const vendorLabels = useVendorLabels()
  const vendors = Object.keys(vendorLabels).filter((vendor) =>
    rows.some((row) => row.vendor === vendor)
  )
  const toggle = (name: string, on: boolean) =>
    props.onChange(
      on
        ? [...props.selected, name]
        : props.selected.filter((item) => item !== name)
    )
  let label = t('All models')
  if (props.selected.length === 1) {
    label = props.selected[0]
  } else if (props.selected.length > 1) {
    label = t('{{count}} models', { count: props.selected.length })
  }

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              variant='outline'
              size='sm'
              className='max-w-full min-w-0 justify-start font-mono text-xs'
              aria-label={t('Filter by model')}
            />
          }
        >
          <span className='truncate'>{label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          className='max-h-80 w-64 overflow-y-auto'
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('Filter by model')}</DropdownMenuLabel>
            <DropdownMenuItem
              closeOnClick={false}
              disabled={props.selected.length === 0}
              onClick={() => props.onChange([])}
            >
              {t('All models')}
            </DropdownMenuItem>
            {vendors.map((vendor) => (
              <DropdownMenuItem
                key={vendor}
                closeOnClick={false}
                onClick={() =>
                  props.onChange(
                    rows
                      .filter((row) => row.vendor === vendor)
                      .map((row) => row.model)
                  )
                }
              >
                {t('All {{vendor}} models', { vendor: vendorLabels[vendor] })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {names.map((name) => (
              <DropdownMenuCheckboxItem
                key={name}
                className='font-mono text-xs'
                checked={props.selected.includes(name)}
                onCheckedChange={(on) => toggle(name, !!on)}
              >
                {name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {props.selected.length > 0 && (
        <span className='text-muted-foreground text-xs'>
          {t(
            'The figures and charts below cover the selected models. The vendor cards above, the table, status codes, failure reasons, stream ends, tasks and refusals cover every model.'
          )}
        </span>
      )}
    </div>
  )
}

export function QualityTab(props: {
  data: QualityInsights | undefined
  previous?: QualityInsights
  /** Read for the clients panel, which moved here from its own tab. */
  business?: BusinessInsights
  models: { selected: string[]; onChange: (models: string[]) => void }
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
  /** The queries' states, so a figure still loading or failed never reads as 0. */
  sources?: InsightsSources
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const definitions = useInsightsDefinitions()
  const modelMapLabels = useVendorLabels()
  const verdict = useQualityVerdict(props.data, props.previous, {
    selected: props.models.selected,
    end: props.range?.end,
  })
  const data = props.data as (QualityInsights & QualityAttempts) | undefined
  const previous = props.previous
  const viewState = props.sources?.view
  const previousFailed = !previous && props.sources?.previous.status === 'error'
  // Without sources (an older caller), no data means loading, as before.
  const loading = !data && viewState?.status !== 'error'
  const missing = !data
  const daily = data?.daily ?? []
  const range = props.range
  const hourly = range?.hourly && data?.hourly?.length ? data.hourly : null
  const siteRate = data ? siteFailureRate(data) : 0
  const shift = data ? failureShift(data, previous) : { kind: 'none' as const }
  const judged = (data?.requests ?? 0) >= SMALL_SAMPLE
  const serviceRate = data ? serviceFailureRate(data) : null
  const previousServiceRate = previous ? serviceFailureRate(previous) : null
  const streams = abnormalStreams(data?.stream_ends)
  const previousStreams = abnormalStreams(previous?.stream_ends)
  const attempts = data ? attemptsOf(data) : null
  const corrected = countsRequestsOnce(data)
  const ranked = rankByExcess(data?.models, siteRate)
  const media = data ? mediaModels(data) : new Set<string>()
  const mapped = (data?.models ?? []).filter((row) => row.ttft_p50_ms > 0)
  const unplaced = unplacedModels(data?.models, MAP_MIN_REQUESTS)
  const reasons = withRemainder(
    data?.error_reasons,
    data ? failuresListed(data) : null,
    t('Other reasons')
  )
  const findings = useQualityFindings(data, previous, siteRate, range?.end)
  const requestTrend = hourly
    ? hourly.map((row) => ({ title: fmt.time(row.hour), value: row.requests }))
    : daily.map((day) => ({ title: fmt.day(day.day), value: day.requests }))
  const worstModel = ranked.find((row) => failsAboveSite(row, siteRate))
  const noPrevious = previousFailed
    ? t('The previous period could not be read.')
    : undefined
  const stateOf = (rows: unknown) => tableState(viewState, rows)

  const attemptItems: MetricItem[] = attempts
    ? [
        {
          label: t('Attempts'),
          value: fmt.num(attempts.attempts),
          help: joinSentences(
            definitions.attempts,
            t(
              'Failed attempts beside it show how hard failover worked: a failed attempt another channel rescued is not a failed request.'
            )
          ),
          hint: t('{{failed}} failed ({{rate}})', {
            failed: fmt.num(attempts.failed),
            rate: fmt.pct(attempts.rate),
          }),
        },
      ]
    : []

  return (
    <div className='grid gap-4'>
      <Verdict
        loading={loading}
        tone={verdict?.tone ?? 'default'}
        text={verdict?.text}
      />
      {data && range && (
        <StaleNote
          staleHours={data.stale_hours}
          rangeHours={(range.end - range.start) / 3600}
        />
      )}
      <VendorCards
        all={data?.all_models}
        vendors={data?.vendors}
        selected={props.models.selected}
        onChange={props.models.onChange}
      />
      <ModelFilter
        options={data?.models}
        selected={props.models.selected}
        onChange={props.models.onChange}
      />
      <MetricGrid
        loading={loading}
        items={[
          {
            label: t('Requests'),
            featured: true,
            missing,
            value: fmt.num(data?.requests ?? 0),
            help: corrected
              ? joinSentences(definitions.requests, definitions.everyone)
              : joinSentences(
                  definitions.requestsAsAttempts,
                  definitions.everyone
                ),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'neutral',
            },
            trend: requestTrend,
            trendBars: !!hourly,
            hint:
              noPrevious ?? t('{{count}} failed', { count: data?.errors ?? 0 }),
          },
          {
            label: t('Failure rate'),
            missing,
            value: fmt.pct(data?.error_rate ?? 0),
            help: joinSentences(
              corrected
                ? t(
                    'What customers saw: requests that no channel served, over requests.'
                  )
                : t(
                    'Failed tries over tries: a request rescued by another channel still counts one failure.'
                  ),
              t(
                'A stream cut short after it started, and an image or video task that failed after it was accepted, count as successes here; see Streams cut short and the tasks panel.'
              ),
              t(
                'Colored above 2%; red above 5%, from 100 requests. Root’s requests count.'
              )
            ),
            delta: {
              current: data?.error_rate ?? 0,
              previous:
                shift.kind === 'small' ? undefined : previous?.error_rate,
              better: 'down',
              points: true,
            },
            hint:
              shift.kind === 'small'
                ? t('Too few requests before to compare')
                : undefined,
            tone: judged ? failureTone(data?.error_rate ?? 0) : 'default',
          },
          ...attemptItems,
          ...(serviceRate == null
            ? []
            : [
                {
                  label: t('Service failure rate'),
                  value: fmt.pct(serviceRate),
                  help: corrected
                    ? t(
                        'The failure rate without customers’ invalid requests (4xx): what the service itself failed. The engine’s limits and budgets, a request no channel served, and a key or wallet the upstream refused all count as the service’s.'
                      )
                    : t(
                        'The failure rate without customers’ invalid requests (4xx). This server still files a key or wallet the upstream refused (401, 402, 403) as the customer’s, so this reads low until it counts the corrected way.'
                      ),
                  delta: {
                    current: serviceRate,
                    previous: previousServiceRate ?? undefined,
                    better: 'down' as const,
                    points: true,
                  },
                  tone: judged ? failureTone(serviceRate) : 'default',
                },
              ]),
          {
            label: t('TTFT p50'),
            missing,
            value: fmt.measuredMs(data?.ttft_p50_ms ?? 0),
            delta: {
              current: data?.ttft_p50_ms ?? 0,
              previous: previous?.ttft_p50_ms || undefined,
              better: 'down',
            },
          },
          {
            label: t('TTFT p95'),
            missing,
            value: fmt.measuredMs(data?.ttft_p95_ms ?? 0),
            help: t('Colored above 10 seconds.'),
            delta: {
              current: data?.ttft_p95_ms ?? 0,
              previous: previous?.ttft_p95_ms || undefined,
              better: 'down',
            },
            tone: (data?.ttft_p95_ms ?? 0) > 10000 ? 'warning' : 'default',
          },
          {
            label: t('Cache read share'),
            missing,
            value: fmt.pct(data?.cache_share ?? 0),
            hint: t('of input tokens'),
            help: corrected
              ? t(
                  'Cache reads over input tokens. Where a vendor’s prompt count already includes cached tokens, as GPT’s does, they are taken out of it first, the way billing counts them.'
                )
              : t(
                  'Cache reads over input tokens. This server counts GPT’s cached tokens twice in the input, so the share reads low whenever GPT’s part of the traffic grows, until it counts the corrected way.'
                ),
            delta: {
              current: data?.cache_share ?? 0,
              previous: previous?.cache_share,
              better: 'up',
              points: true,
            },
          },
          ...(streams == null
            ? []
            : [
                {
                  label: t('Streams cut short'),
                  value: fmt.pct(streams.share),
                  help: t(
                    'Streams that started and then broke off on the service’s side (a timeout, a read error, a crash), over every stream of every model, root included. The client leaving is counted apart and is not a failure. These count as successes in the failure rate.'
                  ),
                  hint: t(
                    '{{count}} of {{total}}; {{gone}} more left by the client',
                    {
                      count: fmt.num(streams.count),
                      total: fmt.num(streams.total),
                      gone: fmt.num(streams.clientGone),
                    }
                  ),
                  delta: {
                    current: streams.share,
                    previous: previousStreams?.share,
                    better: 'down' as const,
                    points: true,
                  },
                  tone:
                    streams.total >= SMALL_SAMPLE
                      ? failureTone(streams.share)
                      : ('default' as const),
                },
              ]),
        ]}
      />
      <TruncatedNotice show={!!data?.truncated} />
      {findings.length > 0 && (
        <Panel title={t('Where to look')}>
          <Findings items={findings} onOpen={props.onOpen} />
        </Panel>
      )}
      {data && (
        <div className='grid gap-4 lg:grid-cols-2'>
          <FailureDriversPanel
            data={data}
            previous={previous}
            selected={props.models.selected}
            previousState={props.sources?.previous}
          />
          <FailureOwnersPanel data={data} onOpen={props.onOpen} />
        </div>
      )}
      {(data?.tasks || data?.refusals) && (
        <div className='grid gap-4'>
          {data.tasks && (
            <TaskOutcomesPanel tasks={data.tasks} onOpen={props.onOpen} />
          )}
          {data.refusals && (
            <RefusalsPanel refusals={data.refusals} onOpen={props.onOpen} />
          )}
        </div>
      )}
      {data && hourly && range && (
        <QualityHourlyPanels
          rows={hourly}
          previous={previous}
          range={range}
          rate={data.error_rate}
        />
      )}
      <Panel
        title={t('Model map')}
        help={t(
          'Each model at its median first token and failure rate, sized by requests (a small model keeps a visible bubble, so size is not exact). Up and to the right is slow and failing; the dashed lines are 2% and 5%. Models with no first-token time are listed below the map instead.'
        )}
      >
        {data ? (
          <div className='grid gap-3'>
            <ModelMap
              models={mapped}
              minRequests={MAP_MIN_REQUESTS}
              vendorName={(vendor) => modelMapLabels[vendor] ?? vendor}
              empty={
                (data.models ?? []).length > 0
                  ? t('No model has a first-token time to place.')
                  : t('No requests in this range')
              }
            />
            <UnplacedModels models={unplaced} media={media} />
          </div>
        ) : (
          <ModelMapPlaceholder failed={viewState?.status === 'error'} />
        )}
      </Panel>
      <Panel
        title={t('By model')}
        description={
          worstModel && worstModel.error_rate > 0
            ? t(
                'Most failures beyond the site’s rate: {{model}}, {{rate}} with {{excess}} extra failures.',
                {
                  model: worstModel.model,
                  rate: fmt.pct(worstModel.error_rate),
                  excess: fmt.num(
                    Math.round(excessFailures(worstModel, siteRate))
                  ),
                }
              )
            : undefined
        }
        help={t(
          'Ranked by failures beyond what the site’s rate would give the model’s requests. A rate is colored only when it is above the site’s beyond chance. Models with under 100 requests are faded, and so are models outside a filter. The change columns compare with the previous period when both rest on 100 requests. A dash means nothing was measured; image and video models have no first token, and their logged duration is only the submission, so both are blank for them.'
        )}
      >
        <SimpleTable
          rows={data ? ranked : undefined}
          state={stateOf(data ? ranked : undefined)}
          rowKey={(row) => row.model}
          empty={t('No requests in this range')}
          faded={(row) =>
            row.requests < SMALL_SAMPLE ||
            (props.models.selected.length > 0 &&
              !props.models.selected.includes(row.model))
          }
          columns={[
            {
              key: 'model',
              label: t('Model'),
              render: (row) => (
                <span className='font-mono text-xs'>{row.model}</span>
              ),
            },
            {
              key: 'req',
              label: t('Requests'),
              align: 'right',
              render: (row) => fmt.num(row.requests),
            },
            {
              key: 'err',
              label: t('Failure rate'),
              align: 'right',
              render: (row) => (
                <span
                  className={cn(
                    row.requests >= SMALL_SAMPLE &&
                      failsAboveSite(row, siteRate) &&
                      RATE_TONES[failureTone(row.error_rate)]
                  )}
                >
                  {fmt.pct(row.error_rate)}
                </span>
              ),
            },
            {
              key: 'err-change',
              label: t('Change'),
              hint: t('Failure rate against the previous period, in points.'),
              align: 'right',
              render: (row) => {
                const change = modelChange(row, previous?.models)
                if (!change || Math.abs(change.points) < 0.05) return '—'
                return (
                  <span
                    className={TONES[change.points > 0 ? 'danger' : 'good']}
                  >
                    {t('{{sign}}{{value}} pt', {
                      sign: change.points > 0 ? '+' : '−',
                      value: Math.abs(change.points).toFixed(1),
                    })}
                  </span>
                )
              },
            },
            {
              key: 'ttft',
              label: 'TTFT p50 / p95',
              align: 'right',
              render: (row) =>
                !media.has(row.model) && (row.ttft_p50_ms || row.ttft_p95_ms)
                  ? `${fmt.measuredMs(row.ttft_p50_ms)} / ${fmt.measuredMs(row.ttft_p95_ms)}`
                  : '—',
            },
            {
              key: 'ttft-change',
              label: t('p95 change'),
              hint: t('First-token p95 against the previous period.'),
              align: 'right',
              render: (row) => {
                const change = modelChange(row, previous?.models)?.ttftP95
                if (change == null || Math.abs(change) < 100) return '—'
                return (
                  <span className={TONES[change > 0 ? 'warning' : 'good']}>
                    {`${change > 0 ? '+' : '−'}${fmt.ms(Math.abs(change))}`}
                  </span>
                )
              },
            },
            {
              key: 'lat',
              label: t('Duration p50 / p95'),
              align: 'right',
              render: (row) =>
                media.has(row.model) ||
                (row.latency_p50_s <= 0 && row.latency_p95_s <= 0)
                  ? '—'
                  : `${row.latency_p50_s}s / ${row.latency_p95_s}s`,
            },
            {
              key: 'cache',
              label: t('Cache read share'),
              align: 'right',
              render: (row) => fmt.pct(row.cache_share),
            },
          ]}
        />
      </Panel>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel
          title={t('Input tokens by cache use')}
          help={
            corrected
              ? t(
                  'Input tokens per day: cache reads, cache writes and the rest. A prompt count that already includes cached tokens has them taken out of the rest.'
                )
              : t(
                  'Input tokens per day: cache reads, cache writes and the rest. On this server GPT’s cached tokens are also inside the rest, so the rest reads high.'
                )
          }
        >
          <BarSeries
            ariaLabel={t('Input tokens by cache use')}
            series={[
              { label: t('Cache read') },
              { label: t('Cache write') },
              { label: t('Uncached'), muted: true },
            ]}
            points={daily.map((day) => ({
              key: day.day,
              title: fmt.day(day.day),
              values: [day.read, day.write, day.uncached],
              extra: [
                {
                  label: t('Cache read share'),
                  value: fmt.pct(day.read_share),
                },
                {
                  label: t('TTFT p50'),
                  value: fmt.measuredMs(day.ttft_p50_ms),
                },
              ],
            }))}
          />
        </Panel>
        {!hourly && data && <DailyFailurePanel data={data} />}
      </div>
      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel title={t('Failures by status code')}>
          <Breakdown
            items={data?.status_codes}
            state={stateOf(data?.status_codes)}
            empty={t('No failed requests in this range')}
          />
        </Panel>
        <Panel
          title={t('Failure reasons')}
          help={t(
            'The most common failure messages over every model. Only the top ones are kept; the rest are summed as other reasons, so each share is of every failure.'
          )}
        >
          <Breakdown
            items={data ? reasons.items : undefined}
            state={stateOf(data?.error_reasons)}
            empty={t('No failed requests in this range')}
          />
        </Panel>
        <Panel
          title={t('How streams ended')}
          help={t(
            'Every stream’s ending, root included, over every model. eof, done and handler_stop are normal; client_gone, ping_fail and cancelled are the client leaving.'
          )}
        >
          <Breakdown
            items={data?.stream_ends}
            state={stateOf(data?.stream_ends)}
            empty={t('No streamed requests in this range')}
          />
        </Panel>
      </div>
      {props.business || !props.sources?.business ? (
        <ClientsPanel data={props.business} />
      ) : (
        <Panel
          title={t('Clients')}
          error={
            props.sources.business.status === 'error'
              ? t('The client figures could not be read.')
              : undefined
          }
        >
          <Breakdown
            items={undefined}
            state={tableState(props.sources.business, undefined)}
            empty={t('No requests in this range')}
          />
        </Panel>
      )}
    </div>
  )
}

/** The model map's place while the view loads, or a line when it failed. */
function ModelMapPlaceholder(props: { failed: boolean }) {
  const { t } = useTranslation()
  if (props.failed) {
    return (
      <p className='text-muted-foreground text-xs'>{t('Could not be read')}</p>
    )
  }
  return <div className='bg-muted h-60 animate-pulse rounded-md' />
}

/**
 * What to look at, worst and largest first: vendors and models failing
 * beyond chance above the site, and the hours failures ran high in.
 */
function useQualityFindings(
  data: QualityInsights | undefined,
  previous: QualityInsights | undefined,
  siteRate: number,
  end: number | undefined
): Finding[] {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  if (!data) return []
  const findings: Finding[] = []
  for (const vendor of data.vendors ?? []) {
    if (vendor.vendor === 'other' || !failsAboveSite(vendor, siteRate)) continue
    if (failureTone(vendor.error_rate) === 'default') continue
    // Image and video have no pool; their supplier is an upstream channel.
    const pooled = vendor.vendor !== 'media'
    findings.push({
      key: `vendor-${vendor.vendor}`,
      tone: failureTone(vendor.error_rate) === 'danger' ? 'danger' : 'warning',
      title: t('{{vendor}} fails {{rate}} of requests.', {
        vendor: vendorName(vendor.vendor),
        rate: fmt.pct(vendor.error_rate),
      }),
      detail: pooled
        ? t(
            'Above the site’s {{site}} beyond chance. Check its pool’s concurrency and accounts.',
            { site: fmt.pct(siteRate) }
          )
        : t(
            'Above the site’s {{site}} beyond chance. Check the supplier’s channels.',
            { site: fmt.pct(siteRate) }
          ),
      tab: pooled ? 'capacity' : 'upstream',
      impact: excessFailures(vendor, siteRate),
    })
  }
  for (const row of failingTaskModels(data.tasks).slice(0, 3)) {
    findings.push({
      key: `task-${row.model}`,
      tone: failureTone(row.failure_rate) === 'danger' ? 'danger' : 'warning',
      title: t(
        '{{model}} tasks fail {{rate}}: {{failed}} of {{finished}} finished.',
        {
          model: row.model,
          rate: fmt.pct(row.failure_rate),
          failed: fmt.num(row.failed),
          finished: fmt.num(row.succeeded + row.failed),
        }
      ),
      detail: row.reasons?.[0]
        ? t('Mostly: {{reason}}. Check the supplier’s channels.', {
            reason: row.reasons[0].name,
          })
        : t('Check the supplier’s channels.'),
      tab: 'upstream',
      impact: row.failed,
    })
  }
  const noChannel = data.refusals?.no_channel ?? 0
  if (noChannel > 0) {
    findings.push({
      key: 'no-channel',
      tone: 'warning',
      title: t('{{count}} requests found no channel for their model.', {
        count: fmt.num(noChannel),
      }),
      detail: t(
        'Every channel of the customer’s group was off, or none lists the model.'
      ),
      tab: 'upstream',
      impact: noChannel,
    })
  }
  for (const row of rankByExcess(data.models, siteRate).slice(0, 3)) {
    if (!failsAboveSite(row, siteRate)) continue
    if (failureTone(row.error_rate) === 'default') continue
    findings.push({
      key: `model-${row.model}`,
      tone: 'warning',
      title: t(
        '{{model}} fails {{rate}}: {{excess}} failures beyond the site’s rate.',
        {
          model: row.model,
          rate: fmt.pct(row.error_rate),
          excess: fmt.num(Math.round(excessFailures(row, siteRate))),
        }
      ),
      detail: t('Check the channels that serve it.'),
      tab: 'upstream',
      impact: excessFailures(row, siteRate),
    })
  }
  const hourly = data.hourly ?? []
  const window =
    hourly.length > 0 && end != null
      ? failingWindow(hourFlags(hourly, previous?.hourly, end))
      : undefined
  if (window) {
    findings.push({
      key: 'hours',
      tone: 'warning',
      title:
        window.from.hour === window.to.hour
          ? t('Failures peaked at {{time}}: {{rate}} of {{count}} requests.', {
              time: fmt.time(window.worst.hour),
              rate: fmt.pct(window.worst.error_rate),
              count: fmt.num(window.worst.requests),
            })
          : t(
              'Failures ran high from {{from}} to {{to}}, peaking at {{rate}}.',
              {
                from: fmt.time(window.from.hour),
                to: fmt.clock(window.to.hour + 3600),
                rate: fmt.pct(window.worst.error_rate),
              }
            ),
      detail: t('See the failure rate by hour below.'),
      impact: window.worst.errors,
    })
  }
  return findings
}
