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

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  THIN_MARGIN_RATE,
  marginExtremes,
  placeLabels,
  modelMargins,
  trafficModels,
  type ModelMarginRow,
  type Point,
} from '../finance-model-margin'
import {
  TONES,
  joinSentences,
  useChargeFormat,
  useInsightsFormat,
  useVendorName,
  vendorColor,
  type SourceState,
} from '../lib'
import type { FinanceInsights } from '../types'
import { Panel, SimpleTable } from './shared'

const WIDTH = 520
const HEIGHT = 260
const PAD = { left: 44, right: 22, top: 12, bottom: 30 }
/** Bubble radius range, in viewBox units. */
const R_MIN = 4
const R_MAX = 17
/** Margin rates are drawn up to 100% and down to the lowest rate, in steps of this, but never below -100%. */
const RATE_STEP = 0.25
const RATE_CEIL = 1
const RATE_LIMIT = -1
/** Named on the chart: the biggest models by charge, and every loss. */

/** Powers of ten from the smallest charge up to the largest. */
function decadeTicks(min: number, max: number): number[] {
  const ticks: number[] = []
  for (let power = Math.floor(Math.log10(min)); ; power += 1) {
    const value = 10 ** power
    if (value > max * 1.0001) break
    if (value >= min * 0.9999) ticks.push(value)
  }
  return ticks.length > 0 ? ticks : [min, max]
}

/**
 * Revenue against margin rate, one bubble per model sized by its requests: the
 * models that bring traffic sit low and wide, the ones that bring profit sit
 * high. Revenue is on a log scale, since one model carries most of it.
 */
export function ModelMarginScatter(props: {
  rows: ModelMarginRow[]
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  const rows = props.rows.filter(
    (row) => row.marginRate != null && row.revenue > 0
  )
  if (rows.length === 0) return null
  const lowest = Math.min(...rows.map((row) => row.revenue))
  const highest = Math.max(...rows.map((row) => row.revenue))
  // Four decades at most: a model charged cents does not stretch the axis, it
  // sits on the left edge.
  const minX = Math.max(Math.min(lowest, highest / 10), highest / 10_000, 0.01)
  const maxX = Math.max(highest, minX * 10)
  const lx = Math.log10(minX)
  const span = Math.log10(maxX) - lx
  const maxRequests = Math.max(...rows.map((row) => row.requests), 1)
  const x = (value: number) =>
    PAD.left +
    ((Math.log10(Math.max(value, minX)) - lx) / span) *
      (WIDTH - PAD.left - PAD.right)
  const lowestRate = Math.min(...rows.map((row) => row.marginRate ?? 0), 0)
  const floor = Math.max(
    Math.floor(lowestRate / RATE_STEP) * RATE_STEP,
    RATE_LIMIT
  )
  const y = (rate: number) => {
    const clamped = Math.min(Math.max(rate, floor), RATE_CEIL)
    return (
      PAD.top +
      ((RATE_CEIL - clamped) / (RATE_CEIL - floor)) *
        (HEIGHT - PAD.top - PAD.bottom)
    )
  }
  const points: Point[] = rows.map((row) => ({
    row,
    x: x(row.revenue),
    y: y(row.marginRate ?? 0),
    r: R_MIN + (R_MAX - R_MIN) * Math.sqrt(row.requests / maxRequests),
  }))
  // Big bubbles first, so a small one is never hidden under a large one.
  const drawn = [...points].sort((a, b) => b.r - a.r)
  const labels = placeLabels(points, WIDTH)
  const vendors = [...new Set(rows.map((row) => row.vendor))]
  const rateTicks: number[] = []
  for (let tick = RATE_CEIL; tick >= floor - 1e-9; tick -= 0.5) {
    rateTicks.push(tick)
  }
  return (
    <figure className='grid gap-2'>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role='img'
        aria-label={props.ariaLabel}
        className='h-auto w-full'
      >
        {rateTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className={cn(
                tick === 0 ? 'stroke-foreground/40' : 'stroke-border'
              )}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor='end'
              className='fill-muted-foreground text-[10px]'
            >
              {fmt.pct(tick)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(THIN_MARGIN_RATE)}
          y2={y(THIN_MARGIN_RATE)}
          className='stroke-amber-500/70'
          strokeWidth={1}
          strokeDasharray='4 3'
        />
        {decadeTicks(minX, maxX).map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={HEIGHT - 10}
            textAnchor='middle'
            className='fill-muted-foreground text-[10px]'
          >
            {fmt.cnyCompact(tick)}
          </text>
        ))}
        {drawn.map(({ row, x: cx, y: cy, r }) => {
          const loss = (row.margin ?? 0) < 0
          return (
            <circle
              key={row.model}
              cx={cx}
              cy={cy}
              r={r}
              fill={vendorColor(row.vendor)}
              fillOpacity={0.55}
              strokeWidth={loss ? 2 : 1}
              className={loss ? 'stroke-destructive' : 'stroke-foreground/50'}
            >
              <title>
                {t(
                  '{{model}}: charged {{revenue}}, margin {{rate}}, {{requests}} requests',
                  {
                    model: row.model,
                    revenue: fmt.cny(row.revenue),
                    rate: fmt.pct(row.marginRate ?? 0),
                    requests: fmt.num(row.requests),
                  }
                )}
              </title>
            </circle>
          )
        })}
        {labels.map(({ row, tx, ty, anchor }) => (
          <text
            key={row.model}
            x={tx}
            y={ty}
            textAnchor={anchor}
            className='fill-foreground stroke-background text-[10px]'
            strokeWidth={3}
            paintOrder='stroke'
            pointerEvents='none'
          >
            {row.model}
          </text>
        ))}
      </svg>
      <figcaption className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
        <span>
          {t('Charged (log scale) across, margin rate up; bubble = requests')}
        </span>
        {vendors.map((vendor) => (
          <span key={vendor} className='inline-flex items-center gap-1'>
            <span
              aria-hidden='true'
              className='inline-block size-2 rounded-full'
              style={{ background: vendorColor(vendor) }}
            />
            {vendorName(vendor)}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/** The most margin each model earns or loses, as horizontal bars. */
const BAR_LIMIT = 8

export function MarginContribution(props: { rows: ModelMarginRow[] }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const counted = props.rows.filter((row) => row.margin != null)
  const total = counted.reduce((sum, row) => sum + (row.margin ?? 0), 0)
  const shown = [...counted]
    .sort(
      (a, b) =>
        Math.abs(b.margin ?? 0) - Math.abs(a.margin ?? 0) ||
        a.model.localeCompare(b.model)
    )
    .slice(0, BAR_LIMIT)
  if (shown.length === 0) return null
  const largest = Math.max(...shown.map((row) => Math.abs(row.margin ?? 0)), 1)
  return (
    <ol
      className='grid content-start gap-2.5'
      aria-label={t('Margin by model')}
    >
      {shown.map((row) => {
        const margin = row.margin ?? 0
        return (
          <li
            key={row.model}
            className='grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1'
          >
            <span className='truncate text-sm' title={row.model}>
              {row.model}
            </span>
            <span
              className={cn(
                'text-right text-sm tabular-nums',
                margin < 0 && TONES.danger
              )}
            >
              {fmt.cny(margin)}
              {total > 0 && (
                <span className='text-muted-foreground ml-2 text-xs'>
                  {fmt.pct(margin / total)}
                </span>
              )}
            </span>
            <div className='bg-muted col-span-2 h-1.5 overflow-hidden rounded-full'>
              <div
                className={cn(
                  'h-full rounded-full',
                  margin < 0 ? 'bg-destructive' : 'bg-primary'
                )}
                style={{ width: `${(Math.abs(margin) / largest) * 100}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** A model's name with how much of its charge has a known cost, when not all of it. */
function ModelCell(props: { row: ModelMarginRow }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const row = props.row
  return (
    <span className='grid'>
      <span className='truncate'>{row.model}</span>
      {row.coverage < 0.995 && (
        <span className='text-muted-foreground text-[11px]'>
          {t('{{rate}} with a known cost', { rate: fmt.pct(row.coverage) })}
        </span>
      )}
    </span>
  )
}

function rateTone(row: ModelMarginRow): string {
  if (row.margin == null) return ''
  if (row.margin < 0) return TONES.danger
  return row.thin ? TONES.warning : ''
}

/**
 * What each model earns: charged, cost, margin, margin rate and per-request
 * figures, with a bubble chart of charge against margin rate and bars of each
 * model's margin. Hidden on a server that does not send the allocation.
 */
export function ModelMarginPanel(props: {
  data: FinanceInsights | undefined
  /** The funds view's state, so a failed read is not drawn as loading. */
  source?: SourceState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const data = props.data
  const margins = data ? modelMargins(data, charge.rate) : null
  if (data && !margins) return null
  const failed = !data && props.source?.status === 'error'
  const extremes = margins ? marginExtremes(margins.rows) : undefined
  const traffic = margins ? trafficModels(margins.rows) : []
  const per = (value: number | null) => (value == null ? '—' : fmt.cny(value))
  let description: string | undefined
  if (margins && margins.rows.length > 0) {
    description =
      margins.coverage != null && margins.coverage < 0.9995
        ? t(
            'Margin {{margin}} ({{rate}}) on {{covered}} of {{revenue}} charged with a known cost ({{coverage}}).',
            {
              margin: fmt.cny(margins.margin),
              rate: fmt.pct(margins.marginRate ?? 0),
              covered: fmt.cny(margins.costedRevenue),
              revenue: fmt.cny(margins.revenue),
              coverage: fmt.pct(margins.coverage),
            }
          )
        : t('Margin {{margin}} ({{rate}}) on {{revenue}} charged.', {
            margin: fmt.cny(margins.margin),
            rate: fmt.pct(margins.marginRate ?? 0),
            revenue: fmt.cny(margins.revenue),
          })
  }
  const notes: string[] = []
  if (extremes?.top.length) {
    notes.push(
      t('Most margin: {{models}}.', {
        models: extremes.top
          .map((row) => `${row.model} ${fmt.cny(row.margin ?? 0)}`)
          .join(', '),
      })
    )
  }
  if (extremes?.losing.length) {
    notes.push(
      t('Losing money: {{models}}.', {
        models: extremes.losing
          .map((row) => `${row.model} ${fmt.cny(row.margin ?? 0)}`)
          .join(', '),
      })
    )
  }
  if (traffic.length > 0) {
    notes.push(
      t('Bring traffic at a thin margin: {{models}}.', {
        models: traffic
          .slice(0, 3)
          .map((row) => `${row.model} ${fmt.pct(row.marginRate ?? 0)}`)
          .join(', '),
      })
    )
  }
  if (margins && margins.unknownRevenue > 0) {
    notes.push(
      t('{{revenue}} charged on models with no known cost is left out.', {
        revenue: fmt.cny(margins.unknownRevenue),
      })
    )
  }
  if (margins && (margins.staffCost > 0.005 || margins.idleCost > 0.005)) {
    notes.push(
      t(
        'Not on a customer model: staff use {{staff}}, idle accounts and unmatched bills {{idle}}.',
        {
          staff: fmt.cny(margins.staffCost),
          idle: fmt.cny(margins.idleCost),
        }
      )
    )
  }
  return (
    <Panel
      title={t('Model margin')}
      description={description}
      error={
        failed ? (props.source?.error ?? t('Could not be read')) : undefined
      }
      help={joinSentences(
        t(
          'Charged is what customers were billed for the model at the groups’ prices, in yuan, not the cash received, which averages less. Staff use is left out of it.'
        ),
        t(
          'Cost is the upstream bill for the model’s own requests, a monthly fee shared by use, and for the pool’s models their share of the account cost by use on the pool’s own channels, as the group margin panel does. Only the part of a model’s charge served where a cost is known is measured, and a model with under half of its charge costed shows no margin.'
        )
      )}
    >
      {!data && !failed && (
        <div className='grid gap-3 lg:grid-cols-2'>
          <Skeleton className='h-64 w-full' />
          <Skeleton className='h-64 w-full' />
        </div>
      )}
      {margins && margins.rows.length > 0 && (
        <div className='grid gap-4'>
          <div className='grid items-start gap-4 lg:grid-cols-2'>
            <ModelMarginScatter
              rows={margins.rows}
              ariaLabel={t('Charge against margin rate by model')}
            />
            <MarginContribution rows={margins.rows} />
          </div>
          {notes.length > 0 && (
            <ul className='text-muted-foreground grid gap-1 text-xs'>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          <SimpleTable
            rows={margins.rows}
            rowKey={(row) => row.model}
            empty={t('No model was charged in this range')}
            faded={(row) => row.margin == null}
            card={(row) => (
              <div className='grid gap-1 text-sm'>
                <ModelCell row={row} />
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>{t('Charged')}</span>
                  <span>{fmt.cny(row.revenue)}</span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>{t('Margin')}</span>
                  <span className={rateTone(row)}>
                    {row.margin == null
                      ? t('Cost unknown')
                      : `${fmt.cny(row.margin)} · ${fmt.pct(row.marginRate ?? 0)}`}
                  </span>
                </div>
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>{t('Requests')}</span>
                  <span>{fmt.num(row.requests)}</span>
                </div>
              </div>
            )}
            columns={[
              {
                key: 'model',
                label: t('Model'),
                render: (row) => <ModelCell row={row} />,
              },
              {
                key: 'revenue',
                label: t('Charged'),
                align: 'right',
                render: (row) => fmt.cny(row.revenue),
              },
              {
                key: 'cost',
                label: t('Cost'),
                align: 'right',
                render: (row) => (row.cost == null ? '—' : fmt.cny(row.cost)),
              },
              {
                key: 'margin',
                label: t('Margin'),
                align: 'right',
                render: (row) =>
                  row.margin == null ? (
                    <span className='text-muted-foreground'>
                      {t('Cost unknown')}
                    </span>
                  ) : (
                    <span className={rateTone(row)}>{fmt.cny(row.margin)}</span>
                  ),
              },
              {
                key: 'rate',
                label: t('Margin rate'),
                align: 'right',
                render: (row) => (
                  <span className={rateTone(row)}>
                    {row.marginRate == null ? '—' : fmt.pct(row.marginRate)}
                  </span>
                ),
              },
              {
                key: 'requests',
                label: t('Requests'),
                align: 'right',
                render: (row) => fmt.num(row.requests),
              },
              {
                key: 'perRequest',
                label: t('Per request'),
                hint: t(
                  'Charge and margin per request. A model with part of its charge uncosted spreads its margin over the costed share of its requests.'
                ),
                align: 'right',
                render: (row) =>
                  `${per(row.revenuePerRequest)} / ${per(row.marginPerRequest)}`,
              },
            ]}
          />
        </div>
      )}
    </Panel>
  )
}
