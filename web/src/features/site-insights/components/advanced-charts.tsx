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
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'

import { useInsightsFormat, vendorColor, type WeekCell } from '../lib'

/** A round step near `span / ticks`: 1, 2 or 5 times a power of ten. */
function roundStep(span: number, ticks: number) {
  if (span <= 0) return 1
  const raw = span / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  if (unit <= 1) return power
  if (unit <= 2) return 2 * power
  if (unit <= 5) return 5 * power
  return 10 * power
}

/**
 * A weekday-by-hour grid, one hue from the surface to full strength at the
 * busiest slot, so the rhythm shows however far below `limit` it runs. A
 * slot past `limit` is ringed.
 */
export function WeekHeatmap(props: {
  cells: WeekCell[]
  format: (value: number) => string
  /** A ceiling such as the pool's slots; the scale reaches it at least. */
  limit?: number
  empty: string
}) {
  const { t, i18n } = useTranslation()
  const fmt = useInsightsFormat()
  if (props.cells.length === 0) {
    return <p className='text-muted-foreground text-xs'>{props.empty}</p>
  }
  const top = Math.max(...props.cells.map((cell) => cell.max))
  const byKey = new Map(
    props.cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell])
  )
  // 2024-01-01 was a Monday.
  const weekday = new Intl.DateTimeFormat(
    toIntlLocale(i18n.resolvedLanguage || i18n.language),
    {
      weekday: 'short',
    }
  )
  const names = Array.from({ length: 7 }, (_, index) =>
    weekday.format(new Date(2024, 0, 1 + index))
  )
  const busiest = props.cells.reduce((a, b) => (b.max > a.max ? b : a))

  return (
    <TooltipProvider delay={0}>
      <div className='-mx-4 overflow-x-auto px-4'>
        <div
          className='grid gap-0.5 text-[10px]'
          style={{
            gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))',
            minWidth: 560,
          }}
        >
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className='text-muted-foreground text-center tabular-nums'
            >
              {hour % 3 === 0 ? hour : ''}
            </span>
          ))}
          {names.map((name, day) => (
            <div key={name} className='contents'>
              <span className='text-muted-foreground pr-2 text-right leading-5'>
                {name}
              </span>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = byKey.get(`${day}-${hour}`)
                if (!cell) {
                  return (
                    <span key={hour} className='bg-muted/40 h-5 rounded-sm' />
                  )
                }
                const share = top > 0 ? cell.max / top : 0
                const over = props.limit != null && cell.max > props.limit
                return (
                  <TapTooltip key={hour}>
                    <TapTooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          aria-label={`${name} ${hour}:00 ${props.format(cell.max)}`}
                          className='hover:ring-foreground/30 focus-visible:ring-ring/50 block h-5 cursor-default rounded-sm outline-none hover:ring-1 focus-visible:ring-2'
                          style={{
                            // A slot past the limit is ringed in red.
                            boxShadow: over
                              ? 'inset 0 0 0 2px var(--destructive)'
                              : undefined,
                            backgroundColor: `color-mix(in oklab, var(--primary) ${Math.max(6, Math.round(share * 100))}%, transparent)`,
                          }}
                        />
                      }
                    />
                    <TooltipContent>
                      <p className='font-medium'>
                        {name} {hour}:00–{hour + 1}:00
                      </p>
                      <p>
                        {t(
                          'Highest {{value}}, average {{mean}} over {{days}} days',
                          {
                            value: props.format(cell.max),
                            mean: props.format(Math.round(cell.mean * 10) / 10),
                            days: cell.days,
                          }
                        )}
                      </p>
                      {props.limit ? (
                        <p>
                          {t('{{share}} of {{limit}}', {
                            share: fmt.pct(cell.max / props.limit),
                            limit: props.format(props.limit),
                          })}
                        </p>
                      ) : null}
                    </TooltipContent>
                  </TapTooltip>
                )
              })}
            </div>
          ))}
        </div>
        <p className='text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
          <span className='flex items-center gap-1'>
            {t('Low')}
            <span
              aria-hidden
              className='inline-block h-2 w-16 rounded-sm'
              style={{
                background:
                  'linear-gradient(to right, color-mix(in oklab, var(--primary) 6%, transparent), var(--primary))',
              }}
            />
            {t('High')}
          </span>
          {props.limit ? (
            <span className='flex items-center gap-1'>
              <span
                aria-hidden
                className='inline-block size-2.5 rounded-sm'
                style={{ boxShadow: 'inset 0 0 0 2px var(--destructive)' }}
              />
              {t('Past {{limit}}', { limit: props.format(props.limit) })}
            </span>
          ) : null}
          <span>
            {t('Busiest: {{day}} {{hour}}:00, {{value}}', {
              day: names[busiest.weekday],
              hour: busiest.hour,
              value: props.format(busiest.max),
            })}
          </span>
        </p>
      </div>
    </TooltipProvider>
  )
}

export type MapModel = {
  model: string
  vendor: string
  requests: number
  error_rate: number
  ttft_p50_ms: number
}

const MAP = {
  height: 320,
  left: 52,
  right: 24,
  top: 24,
  bottom: 40,
}

// The failure-rate axis ends at the first of these past the worst model.
const RATE_CEILINGS = [0.06, 0.1, 0.2, 0.4, 0.6, 1]
const RATE_TICKS = [0, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.6, 1]

/**
 * Each model as a bubble: first token across, failure rate up, area by
 * requests, color by vendor. Slow and failing models sit up and to the
 * right; the 2% and 5% lines are the tabs' failure thresholds.
 */
export function ModelMap(props: {
  models: MapModel[]
  vendorName: (vendor: string) => string
  /** Models with fewer requests are left out as noise. */
  minRequests?: number
  empty: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const [active, setActive] = useState<string>()
  // Drawn at the container's width, so text keeps its size on any screen.
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const node = box.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const min = props.minRequests ?? 20
  const models = props.models
    .filter((row) => row.requests >= min && row.ttft_p50_ms > 0)
    .sort((a, b) => b.requests - a.requests)
  if (models.length === 0) {
    return <p className='text-muted-foreground text-xs'>{props.empty}</p>
  }
  const plotW = width - MAP.left - MAP.right
  const plotH = MAP.height - MAP.top - MAP.bottom
  const xMaxRaw = Math.max(...models.map((row) => row.ttft_p50_ms / 1000))
  const xStep = roundStep(xMaxRaw, 5)
  const xMax = Math.ceil(xMaxRaw / xStep) * xStep || xStep
  // A square-root scale: most models fail under 5%, and one at 30% would
  // otherwise press them all onto the axis.
  const worst = Math.max(...models.map((row) => row.error_rate))
  const yMax = RATE_CEILINGS.find((ceiling) => ceiling >= worst) ?? 1
  const x = (seconds: number) => MAP.left + (seconds / xMax) * plotW
  const y = (rate: number) =>
    MAP.top + plotH - Math.sqrt(Math.min(rate, yMax) / yMax) * plotH
  const most = models[0].requests
  const radius = (requests: number) => 4 + Math.sqrt(requests / most) * 14
  const xTicks = Array.from(
    { length: Math.round(xMax / xStep) + 1 },
    (_, i) => i * xStep
  )
  const yTicks = RATE_TICKS.filter((tick) => tick <= yMax)
  // Selective labels: the eight busiest, then any failing past 5%. Each
  // tries the right of its bubble, then the left, above and below, and is
  // placed only where it overlaps no bubble's centre nor a placed label.
  const candidates = [
    ...models.slice(0, 8),
    ...models.slice(8).filter((row) => row.error_rate > 0.05),
  ]
  const placed: { x: number; y: number; w: number }[] = []
  const labels: {
    model: string
    x: number
    y: number
    anchor: 'start' | 'middle' | 'end'
  }[] = []
  const LINE = 13
  for (const row of candidates) {
    const cx = x(row.ttft_p50_ms / 1000)
    const cy = y(row.error_rate)
    const r = radius(row.requests)
    const w = row.model.length * 6.2
    const options = [
      { left: cx + r + 4, y: cy, x: cx + r + 4, anchor: 'start' as const },
      { left: cx - r - 4 - w, y: cy, x: cx - r - 4, anchor: 'end' as const },
      { left: cx - w / 2, y: cy - r - 8, x: cx, anchor: 'middle' as const },
      { left: cx - w / 2, y: cy + r + 9, x: cx, anchor: 'middle' as const },
    ]
    const fits = options.find(
      (option) =>
        option.left >= MAP.left &&
        option.left + w <= width - MAP.right &&
        option.y >= MAP.top &&
        option.y <= MAP.top + plotH &&
        !placed.some(
          (other) =>
            option.left < other.x + other.w &&
            option.left + w > other.x &&
            Math.abs(option.y - other.y) < LINE
        ) &&
        !models.some((other) => {
          const ox = x(other.ttft_p50_ms / 1000)
          const oy = y(other.error_rate)
          return (
            other !== row &&
            ox > option.left &&
            ox < option.left + w &&
            Math.abs(oy - option.y) < LINE / 2 + radius(other.requests) / 2
          )
        })
    )
    if (!fits) continue
    placed.push({ x: fits.left, y: fits.y, w })
    labels.push({ model: row.model, x: fits.x, y: fits.y, anchor: fits.anchor })
  }
  const shown = models.find((row) => row.model === active)
  const vendors = [...new Set(models.map((row) => row.vendor))]
  const hidden = props.models.length - models.length

  // The hover card sits beside its bubble, on whichever side has room.
  const tipPosition = (row: MapModel) => {
    const cx = x(row.ttft_p50_ms / 1000)
    const r = radius(row.requests)
    const top = Math.min(Math.max(y(row.error_rate) - 40, 0), MAP.height - 110)
    return cx > width / 2
      ? { right: width - cx + r + 8, top }
      : { left: cx + r + 8, top }
  }

  return (
    <div className='grid gap-2'>
      <div ref={box} className='relative'>
        <svg
          viewBox={`0 0 ${width} ${MAP.height}`}
          width={width}
          height={MAP.height}
          role='img'
          aria-label={t('Models by first token and failure rate')}
          className='block max-w-full select-none'
          style={{ fontSize: 11 }}
        >
          {/* Failure zones: amber from 2%, red from 5%, as the tabs color. */}
          <rect
            x={MAP.left}
            width={plotW}
            y={MAP.top}
            height={Math.max(y(0.05) - MAP.top, 0)}
            fill='var(--destructive)'
            fillOpacity={0.06}
          />
          <rect
            x={MAP.left}
            width={plotW}
            y={y(0.05)}
            height={Math.max(y(0.02) - y(0.05), 0)}
            fill='#eda100'
            fillOpacity={0.08}
          />
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                x1={MAP.left}
                x2={width - MAP.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke='var(--border)'
                strokeWidth={1}
              />
              <text
                x={MAP.left - 8}
                y={y(tick)}
                dy='0.32em'
                textAnchor='end'
                fill='var(--muted-foreground)'
                className='tabular-nums'
              >
                {fmt.pct(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <g key={`x${tick}`}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={MAP.top}
                y2={MAP.top + plotH}
                stroke='var(--border)'
                strokeOpacity={0.5}
                strokeWidth={1}
              />
              <text
                x={x(tick)}
                y={MAP.top + plotH + 16}
                textAnchor='middle'
                fill='var(--muted-foreground)'
                className='tabular-nums'
              >
                {`${fmt.num(tick)}s`}
              </text>
            </g>
          ))}
          <text x={MAP.left - 8} y={12} fill='var(--muted-foreground)'>
            {t('Failure rate')} ↑
          </text>
          <text
            x={width - MAP.right}
            y={MAP.height - 4}
            textAnchor='end'
            fill='var(--muted-foreground)'
          >
            {t('TTFT p50')} →
          </text>
          {shown && (
            <g pointerEvents='none'>
              <line
                x1={MAP.left}
                x2={x(shown.ttft_p50_ms / 1000)}
                y1={y(shown.error_rate)}
                y2={y(shown.error_rate)}
                stroke='var(--muted-foreground)'
                strokeDasharray='3 3'
              />
              <line
                x1={x(shown.ttft_p50_ms / 1000)}
                x2={x(shown.ttft_p50_ms / 1000)}
                y1={y(shown.error_rate)}
                y2={MAP.top + plotH}
                stroke='var(--muted-foreground)'
                strokeDasharray='3 3'
              />
            </g>
          )}
          {[...models].reverse().map((row) => (
            <circle
              key={row.model}
              cx={x(row.ttft_p50_ms / 1000)}
              cy={y(row.error_rate)}
              r={radius(row.requests)}
              strokeWidth={row.model === active ? 2 : 1.5}
              stroke={
                row.model === active ? 'var(--foreground)' : 'var(--card)'
              }
              style={{
                fill: vendorColor(row.vendor),
                fillOpacity: active && active !== row.model ? 0.2 : 0.78,
              }}
              className='cursor-pointer transition-opacity'
              onPointerEnter={() => setActive(row.model)}
              onPointerLeave={() => setActive(undefined)}
            >
              <title>{row.model}</title>
            </circle>
          ))}
          {labels.map((label) => (
            <text
              key={`l${label.model}`}
              x={label.x}
              y={label.y}
              dy='0.32em'
              textAnchor={label.anchor}
              fill='var(--foreground)'
              stroke='var(--card)'
              strokeWidth={3}
              strokeLinejoin='round'
              paintOrder='stroke'
              pointerEvents='none'
              opacity={active && active !== label.model ? 0.3 : 1}
            >
              {label.model}
            </text>
          ))}
        </svg>
        {shown && (
          <div
            className='bg-popover text-popover-foreground pointer-events-none absolute rounded-md border px-3 py-2 text-xs shadow-sm'
            style={tipPosition(shown)}
          >
            <p className='flex items-center gap-1.5 font-mono font-medium'>
              <span
                aria-hidden
                className='size-2.5 rounded-full'
                style={{ backgroundColor: vendorColor(shown.vendor) }}
              />
              {shown.model}
            </p>
            <p className='text-muted-foreground'>
              {props.vendorName(shown.vendor)}
            </p>
            <p className='tabular-nums'>
              {t('Requests')}: {fmt.num(shown.requests)}
            </p>
            <p className='tabular-nums'>
              {t('Failure rate')}: {fmt.pct(shown.error_rate)}
            </p>
            <p className='tabular-nums'>
              {t('TTFT p50')}: {fmt.measuredMs(shown.ttft_p50_ms)}
            </p>
          </div>
        )}
      </div>
      <p className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]'>
        {vendors.map((vendor) => (
          <span key={vendor} className='flex items-center gap-1'>
            <span
              aria-hidden
              className='size-2.5 rounded-full'
              style={{ backgroundColor: vendorColor(vendor) }}
            />
            {props.vendorName(vendor)}
          </span>
        ))}
        <span>{t('Bubble area: requests')}</span>
        {hidden > 0 && (
          <span>
            {t('{{count}} models under {{min}} requests left out', {
              count: hidden,
              min,
            })}
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * A funnel: each step a bar against the first, with its share of the first
 * and the conversion from the step before.
 */
export function FunnelChart(props: {
  steps: { label: string; value: number }[]
  loading?: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  if (props.loading) {
    return <div className='bg-muted h-40 animate-pulse rounded-md' />
  }
  const first = props.steps[0]?.value ?? 0
  return (
    <ol className='grid gap-1'>
      {props.steps.map((step, index) => {
        const previous = props.steps[index - 1]
        const width = first > 0 ? (step.value / first) * 100 : 0
        return (
          <li key={step.label} className='grid gap-1'>
            {previous && (
              <p className='text-muted-foreground pl-1 text-[11px]'>
                ↓{' '}
                {t('{{rate}} went on', {
                  rate:
                    previous.value > 0
                      ? fmt.pct(step.value / previous.value)
                      : '-',
                })}
              </p>
            )}
            <div className='flex items-center gap-3'>
              <span className='w-24 shrink-0 truncate text-xs'>
                {step.label}
              </span>
              <div className='bg-muted relative h-7 flex-1 overflow-hidden rounded-md'>
                <div
                  className='bg-primary h-full rounded-md'
                  style={{
                    width: `${Math.max(width, step.value > 0 ? 1 : 0)}%`,
                  }}
                />
              </div>
              <span className='w-28 shrink-0 text-right text-xs tabular-nums'>
                <span className='font-medium'>{fmt.num(step.value)}</span>{' '}
                <span className='text-muted-foreground'>
                  {first > 0 ? fmt.pct(step.value / first) : '-'}
                </span>
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
