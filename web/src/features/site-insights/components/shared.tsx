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
import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react'
import {
  useState,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { useInsightsFormat } from '../lib'
import type { NamedCount } from '../types'

export function Panel(props: {
  title: ReactNode
  /** What the panel shows now, read from its figures: one sentence. */
  description?: ReactNode
  /** How the panel's figures are defined, shown from an icon by the title. */
  help?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <Card
      data-card-hover='false'
      className={cn('min-w-0 gap-0 py-0', props.className)}
    >
      <div className='flex items-start justify-between gap-2 border-b px-4 py-3'>
        <div className='min-w-0'>
          <h3 className='flex items-center gap-1.5 text-sm font-semibold'>
            {props.title}
            {props.help && <HelpIcon help={props.help} title={props.title} />}
          </h3>
          {props.description != null && (
            <p className='text-muted-foreground mt-0.5 text-xs'>
              {props.description}
            </p>
          )}
        </div>
        {props.actions}
      </div>
      <CardContent className='p-4'>{props.children}</CardContent>
    </Card>
  )
}

/**
 * A definition that opens on hover and on a click or tap. A click keeps it
 * open until the reader clicks elsewhere or presses Escape, so a long one can
 * be read, and a touch screen, which cannot hover, reaches it too.
 */
function HelpPopover(props: {
  trigger: ReactElement
  children: ReactNode
  title?: ReactNode
  help: string
}) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={HELP_DELAY}
        closeDelay={HELP_CLOSE_DELAY}
        render={props.trigger}
      >
        {props.children}
      </PopoverTrigger>
      <PopoverContent
        side='top'
        className='w-auto max-w-xs gap-1 p-3 text-xs leading-relaxed font-normal'
      >
        {props.title != null && (
          <p className='text-foreground font-medium'>{props.title}</p>
        )}
        <p className='text-muted-foreground'>{props.help}</p>
      </PopoverContent>
    </Popover>
  )
}

/** A question-mark icon that explains how a panel's figures are counted. */
/**
 * A row of toggles that picks one provider, each with a count beside its
 * name, as the account pool and capacity tabs switch by.
 */
export function ProviderSwitch<K extends string>(props: {
  value: K
  items: { key: K; label: string; count?: number }[]
  onChange?: (value: K) => void
  ariaLabel: string
}) {
  return (
    <ToggleGroup
      variant='outline'
      size='sm'
      className='max-w-full justify-start overflow-x-auto'
      aria-label={props.ariaLabel}
      value={[props.value]}
      onValueChange={(value: string[]) => {
        const next = value.at(-1) as K | undefined
        if (next && next !== props.value) props.onChange?.(next)
      }}
    >
      {props.items.map((item) => (
        <ToggleGroupItem key={item.key} value={item.key}>
          {item.label}
          {item.count != null && (
            <span className='text-muted-foreground tabular-nums'>
              {item.count}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

const VERDICT_TONES: Record<Tone, { bar: string; dot: string }> = {
  default: { bar: 'border-l-muted-foreground/40', dot: 'bg-muted-foreground' },
  good: { bar: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  warning: { bar: 'border-l-amber-500', dot: 'bg-amber-500' },
  danger: { bar: 'border-l-destructive', dot: 'bg-destructive' },
}

/**
 * A tab's answer in one sentence, colored by how it reads: the first thing
 * on the tab, so the figures below it confirm rather than have to be read
 * to find out.
 */
export function Verdict(props: {
  tone: Tone
  text: string | undefined
  loading?: boolean
}) {
  const tone = VERDICT_TONES[props.tone]
  if (props.loading) return <Skeleton className='h-11 w-full rounded-xl' />
  if (!props.text) return null
  return (
    <div
      role='status'
      className={cn(
        'bg-card flex items-start gap-2.5 rounded-xl border border-l-4 px-4 py-3 text-sm font-medium',
        tone.bar
      )}
    >
      <span
        aria-hidden
        className={cn('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)}
      />
      <p className='min-w-0 leading-relaxed'>{props.text}</p>
    </div>
  )
}

export function HelpIcon(props: { help: string; title?: ReactNode }) {
  const { t } = useTranslation()
  return (
    <HelpPopover
      help={props.help}
      title={props.title}
      trigger={
        <button
          type='button'
          aria-label={t('How this is counted')}
          className='text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 data-popup-open:text-foreground inline-flex cursor-help rounded-full outline-none focus-visible:ring-2'
        />
      }
    >
      <CircleHelp className='size-3.5' aria-hidden />
    </HelpPopover>
  )
}

/**
 * Status colors mean one thing each: danger needs action, warning needs a
 * look. A figure that is merely fine stays uncolored; good marks only a
 * change for the better.
 */
export type Tone = 'default' | 'warning' | 'danger' | 'good'

/**
 * A figure beside the same figure over the period before. Better says which
 * direction is an improvement; neutral figures are drawn without color.
 */
export type MetricDelta = {
  current: number
  previous: number | undefined
  better: 'up' | 'down' | 'neutral'
  /** Compare shares by percentage points instead of relative change. */
  points?: boolean
}

export type MetricItem = {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: Tone
  /** What the figure means, shown when the label is hovered or focused. */
  help?: string
  /** A share from 0 to 1, drawn as a bar under the value. */
  meter?: { value: number; tone?: Tone; label: string }
  delta?: MetricDelta
  /** A headline figure: wider, larger, with its trend drawn. */
  featured?: boolean
  /** The figure over the range, oldest first, drawn on a featured card. */
  trend?: TrendPoint[]
  /** How a trend point's value reads out; plain numbers by default. */
  trendFormat?: (value: number) => string
}

const TONES = {
  default: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
  good: 'text-emerald-600 dark:text-emerald-400',
}

const METER_TONES = {
  default: 'bg-primary/70',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
  good: 'bg-emerald-500',
}

/**
 * A horizontal bar for a share of a whole. An optional marker, such as a
 * quota budget, shades the track past it. Values are percentages.
 */
export function Meter(props: {
  value: number
  marker?: number
  tone?: Tone
  label: string
  className?: string
}) {
  const value = Math.min(100, Math.max(0, props.value))
  const marker = props.marker ?? 0
  return (
    <div
      role='meter'
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className={cn(
        'bg-foreground/10 relative h-1.5 w-full overflow-hidden rounded-full',
        props.className
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          METER_TONES[props.tone ?? 'default']
        )}
        style={{ width: `${value}%` }}
      />
      {marker > 0 && marker < 100 && (
        <span
          aria-hidden
          className='border-foreground/60 bg-foreground/15 absolute inset-y-0 right-0 border-l-2'
          style={{ left: `${marker}%` }}
        />
      )}
    </div>
  )
}

/**
 * A label with a dotted underline that explains itself on hover, or on a
 * click or tap.
 */
export function HelpLabel(props: { label: ReactNode; help?: string }) {
  if (!props.help) return props.label
  return (
    <HelpPopover
      help={props.help}
      title={props.label}
      trigger={
        <button
          type='button'
          className='decoration-muted-foreground/50 hover:decoration-foreground data-popup-open:decoration-foreground focus-visible:ring-ring/50 cursor-help text-left underline decoration-dotted underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-2'
        />
      }
    >
      {props.label}
    </HelpPopover>
  )
}

// Tooltips in cards and tables open quickly, so a reader scanning across
// them is not left waiting on each one.
const HELP_DELAY = 150
// Long enough to move the pointer from a label onto its definition.
const HELP_CLOSE_DELAY = 150

/**
 * The change from the previous period: relative for counts and amounts,
 * in percentage points for shares. Nothing is shown before the previous
 * period has loaded, or when it had nothing to compare against.
 */
export function DeltaBadge(props: { delta: MetricDelta }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const delta = props.delta
  if (delta.previous === undefined) return null
  if (!delta.points && delta.previous === 0) {
    if (delta.current === 0) return null
    return (
      <span className='text-muted-foreground text-xs font-normal whitespace-nowrap'>
        {t('New this period')}
      </span>
    )
  }
  const change = delta.points
    ? delta.current - delta.previous
    : (delta.current - delta.previous) / Math.abs(delta.previous)
  // Below these, a change reads as flat rather than as a movement.
  const flat = delta.points
    ? Math.abs(change) < 0.001
    : Math.abs(change) < 0.005
  let tone: Tone = 'default'
  if (!flat && delta.better !== 'neutral') {
    const improved = delta.better === 'up' ? change > 0 : change < 0
    tone = improved ? 'good' : 'danger'
  }
  let arrow = '→'
  if (!flat) arrow = change > 0 ? '▲' : '▼'
  // A figure that more than doubled reads better as a multiple than as
  // a four-digit percentage.
  let amount = fmt.pct(Math.abs(change))
  if (delta.points) {
    amount = t('{{value}} pt', { value: (Math.abs(change) * 100).toFixed(1) })
  } else if (change >= 1) {
    amount = t('×{{value}}', {
      value: fmt.num(Math.round((delta.current / delta.previous) * 10) / 10),
    })
  }
  return (
    <span
      className={cn(
        'text-xs font-medium whitespace-nowrap tabular-nums',
        TONES[tone]
      )}
      title={t('Compared with the previous period of the same length')}
    >
      {arrow} {flat ? t('Flat') : amount}
    </span>
  )
}

export type TrendPoint = {
  /** The date or hour of the point, shown when it is read. */
  title: string
  value: number
}

/**
 * A small line of a figure's values over the range, or a bar per point
 * when the values are amounts per day rather than a level. Hovering, or
 * focusing and pressing the arrow keys, marks the point under the pointer
 * and reads out its date and value.
 */
export function Sparkline(props: {
  points: TrendPoint[]
  format: (value: number) => string
  label: string
  className?: string
  /** Draws a bar per point instead of a line. */
  bars?: boolean
}) {
  const { t } = useTranslation()
  const [active, setActive] = useState<number | null>(null)
  const points = props.points
  if (points.length < 2) return null
  const values = points.map((point) => point.value)
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const last = points.length - 1
  // A line puts its points on the edges; bars put each in its own column,
  // so every position across the chart belongs to one bar.
  const xOf = (index: number) =>
    props.bars ? ((index + 0.5) / points.length) * 100 : (index / last) * 100
  const yOf = (value: number) => 28 - ((value - min) / span) * 26
  const column = 100 / points.length
  const path = values
    .map(
      (value, index) =>
        `${index === 0 ? 'M' : 'L'}${xOf(index).toFixed(2)},${yOf(value).toFixed(2)}`
    )
    .join(' ')
  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const share = (event.clientX - box.left) / Math.max(box.width, 1)
    const index = props.bars
      ? Math.floor(share * points.length)
      : Math.round(share * last)
    return Math.min(last, Math.max(0, index))
  }
  const point = active === null ? null : points[active]
  const x = active === null ? 0 : xOf(active)
  const latest = points[last]
  return (
    <div
      tabIndex={0}
      role='img'
      aria-label={t('{{label}} from {{first}} to {{last}}, latest {{value}}', {
        label: props.label,
        first: points[0].title,
        last: latest.title,
        value: props.format(latest.value),
      })}
      // A finger dragging across reads point after point; a vertical drag
      // still scrolls the page.
      className={cn(
        'focus-visible:ring-ring/50 relative cursor-crosshair touch-pan-y rounded-sm outline-none focus-visible:ring-2',
        props.className
      )}
      onPointerDown={(event) => setActive(nearest(event))}
      onPointerMove={(event) => setActive(nearest(event))}
      // A lifted finger leaves too; its point stays read until a tap
      // elsewhere blurs the chart.
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') setActive(null)
      }}
      // A tap focuses the chart after its pointerdown has picked a point.
      onFocus={() => setActive((current) => current ?? last)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          setActive((current) => Math.max(0, (current ?? last) - 1))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          setActive((current) => Math.min(last, (current ?? last) + 1))
        }
      }}
    >
      <svg
        aria-hidden
        viewBox='0 0 100 30'
        preserveAspectRatio='none'
        className='text-primary block h-8 w-full overflow-visible'
      >
        {props.bars ? (
          points.map(({ title, value }, index) => (
            <rect
              key={title}
              x={index * column + column * 0.15}
              width={column * 0.7}
              y={Math.min(yOf(value), yOf(0))}
              height={Math.abs(yOf(0) - yOf(value))}
              className={cn(
                'fill-current',
                active === null || active === index
                  ? 'opacity-70'
                  : 'opacity-30'
              )}
            />
          ))
        ) : (
          <>
            <path
              d={`${path} L100,30 L0,30 Z`}
              className='fill-current opacity-10'
            />
            <path
              d={path}
              fill='none'
              stroke='currentColor'
              strokeWidth={1.5}
              vectorEffect='non-scaling-stroke'
              strokeLinejoin='round'
            />
          </>
        )}
      </svg>
      {point && (
        <>
          {!props.bars && (
            <>
              <span
                aria-hidden
                className='border-foreground/30 pointer-events-none absolute inset-y-0 border-l border-dashed'
                style={{ left: `${x}%` }}
              />
              <span
                aria-hidden
                className='bg-primary ring-background pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2'
                style={{
                  left: `${x}%`,
                  top: `${(yOf(point.value) / 30) * 100}%`,
                }}
              />
            </>
          )}
          <span
            role='status'
            className={cn(
              'bg-popover text-popover-foreground pointer-events-none absolute bottom-full mb-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm',
              x < 20 && 'translate-x-0',
              x >= 20 && x <= 80 && '-translate-x-1/2',
              x > 80 && '-translate-x-full'
            )}
            style={{ left: `${x}%` }}
          >
            <span className='text-muted-foreground'>{point.title}</span>{' '}
            <span className='font-medium tabular-nums'>
              {props.format(point.value)}
            </span>
          </span>
        </>
      )}
    </div>
  )
}

export function MetricGrid(props: { items: MetricItem[]; loading?: boolean }) {
  const fmt = useInsightsFormat()
  return (
    <TooltipProvider delay={HELP_DELAY}>
      <dl className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
        {props.items.map((item) => (
          <Card
            key={item.label}
            data-card-hover='false'
            className={cn(
              'bg-muted/20 gap-1 px-3 py-2.5',
              item.featured && 'col-span-2 sm:col-span-3 lg:col-span-2'
            )}
          >
            <dt className='text-muted-foreground truncate text-xs'>
              <HelpLabel label={item.label} help={item.help} />
            </dt>
            <dd
              className={cn(
                'flex min-w-0 items-baseline gap-2 font-semibold tabular-nums',
                item.featured ? 'text-2xl' : 'text-xl'
              )}
            >
              {props.loading ? (
                <Skeleton className='h-7 w-16' />
              ) : (
                <span className={cn('truncate', TONES[item.tone ?? 'default'])}>
                  {item.value}
                </span>
              )}
              {item.featured && item.delta && !props.loading && (
                <DeltaBadge delta={item.delta} />
              )}
            </dd>
            {!item.featured && item.delta && !props.loading && (
              <dd className='-mt-0.5 leading-none'>
                <DeltaBadge delta={item.delta} />
              </dd>
            )}
            {item.meter && !props.loading && (
              <dd className='py-0.5'>
                <Meter
                  value={item.meter.value * 100}
                  tone={item.meter.tone}
                  label={item.meter.label}
                />
              </dd>
            )}
            {item.featured && item.trend && !props.loading && (
              <dd className='-mx-0.5'>
                <Sparkline
                  points={item.trend}
                  format={item.trendFormat ?? fmt.num}
                  label={item.label}
                />
              </dd>
            )}
            {item.hint != null && (
              <dd
                className='text-muted-foreground line-clamp-2 text-xs'
                title={typeof item.hint === 'string' ? item.hint : undefined}
              >
                {item.hint}
              </dd>
            )}
          </Card>
        ))}
      </dl>
    </TooltipProvider>
  )
}

export type BarPoint = {
  key: string | number
  /** The date or hour, shown atop the tooltip. */
  title: string
  /**
   * A short axis label. When any point has one, only those points are
   * labelled, and each starts a new segment (a day in an hourly series).
   */
  axis?: string
  /** Stacked segments, bottom first, one per series. */
  values: number[]
  /** Further figures listed in the tooltip below the series. */
  extra?: { label: string; value: string }[]
}

export type BarSeriesItem = {
  label: string
  format?: (value: number) => string
  /** A shorter form for the axis and the bar labels, such as $1.5K. */
  compact?: (value: number) => string
  /** A background series, such as the remainder of a whole, drawn grey. */
  muted?: boolean
}

const SEGMENT_COLORS = [
  'bg-primary/60 group-hover/bar:bg-primary group-focus-visible/bar:bg-primary',
  'bg-sky-500/60 group-hover/bar:bg-sky-500 group-focus-visible/bar:bg-sky-500',
  'bg-amber-500/60 group-hover/bar:bg-amber-500 group-focus-visible/bar:bg-amber-500',
  'bg-rose-500/60 group-hover/bar:bg-rose-500 group-focus-visible/bar:bg-rose-500',
]
const MUTED_SEGMENT =
  'bg-muted-foreground/25 group-hover/bar:bg-muted-foreground/45 group-focus-visible/bar:bg-muted-foreground/45'

const DOT_COLORS = ['bg-primary', 'bg-sky-500', 'bg-amber-500', 'bg-rose-500']
const MUTED_DOT = 'bg-muted-foreground/40'

// Gridlines on the value axis, and the most labels the time axis carries.
const VALUE_TICKS = 4
const AXIS_LABELS = 7
// A series this short labels each bar with its total.
const LABELLED_BARS = 14
// A series up to this long keeps a gap between its bars.
const SPACED_BARS = 60
// A phone-width chart's plot area, and the width a bar label's character
// takes at its 10px size; labels that would not fit are left to the tooltip.
const NARROW_PLOT_PX = 280
const LABEL_CHAR_PX = 6

/** The smallest round step (1, 2, 2.5 or 5 × 10^n) at least value. */
function niceStep(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10
  return step * magnitude
}

/**
 * A bar per point with a gridded value axis and a labelled time axis.
 * Hovering or focusing a bar shows each series' value; the tooltip opens
 * at once and follows the pointer from bar to bar.
 */
export function BarSeries(props: {
  points: BarPoint[]
  series: BarSeriesItem[]
  className?: string
  ariaLabel: string
  /** Draws the series side by side to compare them, instead of stacking parts of a whole. */
  grouped?: boolean
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const formatOf = (index: number) =>
    props.series[index]?.format ?? props.series[0]?.format ?? fmt.num
  const axisFormat =
    props.series[0]?.compact ?? props.series[0]?.format ?? fmt.num
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const max = Math.max(
    0,
    ...props.points.map((point) =>
      props.grouped ? Math.max(0, ...point.values) : sum(point.values)
    )
  )
  const step = niceStep(max / VALUE_TICKS)
  const top = max > 0 ? Math.ceil(max / step) * step : 1
  const ticks = Array.from(
    { length: Math.round(top / step) + 1 },
    (_, index) => index * step
  )
  const stacked = props.series.length > 1 && !props.grouped
  const count = props.points.length
  const segmented = props.points.some((point) => point.axis)
  // Labelled points: segment starts, or evenly spaced titles. Either way,
  // thinned so the labels never crowd.
  const candidates = props.points
    .map((point, index) => ({ index, text: point.axis ?? point.title }))
    .filter((_, index) => !segmented || props.points[index].axis)
  const short = count <= LABELLED_BARS
  // A grouped bar has no single total to print above it.
  const barLabels = short && !props.grouped
  const labelChars = Math.max(
    0,
    ...props.points.map((point) => axisFormat(sum(point.values)).length)
  )
  const labelsCrowdNarrow =
    count * (labelChars * LABEL_CHAR_PX + 4) > NARROW_PLOT_PX
  // The space between bars sits inside each bar's hover area, so every point
  // across the chart answers the pointer. A dense series, such as a week of
  // hours in a narrow panel, has no room for it and draws bars edge to edge.
  const spaced = count <= SPACED_BARS
  const every = short
    ? 1
    : Math.max(1, Math.ceil(candidates.length / AXIS_LABELS))
  const labels = candidates.filter((_, index) => index % every === 0)
  const colorOf = (index: number) =>
    props.series[index]?.muted
      ? MUTED_SEGMENT
      : SEGMENT_COLORS[index % SEGMENT_COLORS.length]
  const dotOf = (index: number) =>
    props.series[index]?.muted
      ? MUTED_DOT
      : DOT_COLORS[index % DOT_COLORS.length]
  return (
    <div className={cn('grid gap-2', props.className)}>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-2'>
        <div
          aria-hidden
          className={cn(
            'text-muted-foreground relative h-40 text-right text-[10px] tabular-nums',
            barLabels && 'mt-4'
          )}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className='block translate-y-1/2 leading-none whitespace-nowrap'
              style={{
                position: 'absolute',
                right: 0,
                bottom: `${(tick / top) * 100}%`,
              }}
            >
              {axisFormat(tick)}
            </span>
          ))}
          {/* Holds the column's width when every label is absolute. */}
          <span className='invisible block h-0 leading-none'>
            {axisFormat(top)}
          </span>
        </div>
        <div className={cn('relative h-40', barLabels && 'mt-4')}>
          <div aria-hidden className='pointer-events-none absolute inset-0'>
            {ticks.map((tick) => (
              <span
                key={tick}
                className={cn(
                  'absolute inset-x-0 border-t',
                  tick === 0
                    ? 'border-border'
                    : 'border-border/50 border-dashed'
                )}
                style={{ bottom: `${(tick / top) * 100}%` }}
              />
            ))}
          </div>
          <TooltipProvider delay={0}>
            <ol
              className='relative flex h-full items-end'
              aria-label={props.ariaLabel}
            >
              {props.points.map((point, pointIndex) => {
                const total = sum(point.values)
                const rows = point.values.map((value, index) => ({
                  id: `series-${index}`,
                  label: props.series[index]?.label ?? '',
                  value: formatOf(index)(value),
                  dot: dotOf(index),
                }))
                if (stacked) {
                  rows.push({
                    id: 'total',
                    label: t('Total'),
                    value: formatOf(0)(total),
                    dot: '',
                  })
                }
                const ariaLabel = [
                  point.title,
                  ...rows.map((row) => `${row.label} ${row.value}`),
                  ...(point.extra ?? []).map(
                    (row) => `${row.label} ${row.value}`
                  ),
                ].join(', ')
                return (
                  // The item is the trigger itself: a trigger inside an item
                  // left a sub-pixel sliver at some item edges that the
                  // pointer reached without reaching any bar.
                  <TapTooltip key={point.key}>
                    <TapTooltipTrigger
                      render={
                        <li
                          tabIndex={0}
                          aria-label={ariaLabel}
                          className={cn(
                            'group/bar focus-visible:ring-ring/50 hover:bg-muted/40 data-popup-open:bg-muted/40 flex h-full min-w-0 flex-1 flex-col-reverse items-stretch justify-start rounded-sm outline-none focus-visible:ring-3',
                            spaced && 'px-px sm:px-[3px]',
                            // A segment's divider is part of its first bar,
                            // so pointing at the line still reads that bar.
                            segmented &&
                              point.axis &&
                              pointIndex > 0 &&
                              'border-border/70 rounded-l-none border-l border-dashed'
                          )}
                        />
                      }
                    >
                      {total > 0 && props.grouped && (
                        <span className='flex h-full items-end gap-px'>
                          {point.values.map((value, index) => (
                            <span
                              key={rows[index].id}
                              className={cn(
                                'min-w-0 flex-1 rounded-t-[3px]',
                                colorOf(index)
                              )}
                              style={{ height: `${(value / top) * 100}%` }}
                            />
                          ))}
                        </span>
                      )}
                      {total > 0 &&
                        !props.grouped &&
                        point.values.map((value, index) => (
                          <span
                            key={rows[index].id}
                            className={cn(
                              'w-full first:rounded-b-none last:rounded-t-[3px]',
                              colorOf(index)
                            )}
                            style={{ height: `${(value / top) * 100}%` }}
                          />
                        ))}
                      {barLabels && total > 0 && (
                        <span
                          aria-hidden
                          className={cn(
                            'text-muted-foreground truncate pb-0.5 text-center text-[10px] leading-none tabular-nums',
                            labelsCrowdNarrow && 'max-sm:hidden'
                          )}
                        >
                          {axisFormat(total)}
                        </span>
                      )}
                    </TapTooltipTrigger>
                    <TooltipContent className='block min-w-40 py-2'>
                      <p className='mb-1.5 font-semibold'>{point.title}</p>
                      <dl className='grid grid-cols-[1fr_auto] gap-x-4 gap-y-1'>
                        {rows.map((row) => (
                          <div key={row.id} className='contents'>
                            <dt
                              className={cn(
                                'flex items-center gap-1.5 opacity-80',
                                row.id === 'total' && 'font-medium opacity-100'
                              )}
                            >
                              {row.dot && (
                                <span
                                  className={cn('size-2 rounded-sm', row.dot)}
                                />
                              )}
                              {row.label}
                            </dt>
                            <dd
                              className={cn(
                                'text-right tabular-nums',
                                row.id === 'total' && 'font-medium'
                              )}
                            >
                              {row.value}
                            </dd>
                          </div>
                        ))}
                        {(point.extra ?? []).map((row) => (
                          <div key={row.label} className='contents'>
                            <dt className='opacity-80'>{row.label}</dt>
                            <dd className='text-right tabular-nums'>
                              {row.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </TooltipContent>
                  </TapTooltip>
                )
              })}
            </ol>
          </TooltipProvider>
        </div>
        <span aria-hidden />
        <div
          aria-hidden
          className='text-muted-foreground relative mt-1 h-3 text-[10px] leading-none tabular-nums'
        >
          {labels.map((label) => {
            // A segment's label sits at its start; a bar's under its centre.
            const offset = segmented ? label.index : label.index + 0.5
            const position = (offset / Math.max(count, 1)) * 100
            return (
              <span
                key={label.index}
                className={cn(
                  'absolute whitespace-nowrap',
                  !segmented &&
                    position > 4 &&
                    position < 96 &&
                    '-translate-x-1/2',
                  !segmented && position >= 96 && '-translate-x-full'
                )}
                style={{ left: `${Math.min(position, 100)}%` }}
              >
                {label.text}
              </span>
            )
          })}
        </div>
      </div>
      {props.series.length > 1 && (
        <ul className='text-muted-foreground flex flex-wrap gap-3 text-xs'>
          {props.series.map((item, index) => (
            <li key={item.label} className='flex items-center gap-1.5'>
              <span className={cn('size-2 rounded-sm', dotOf(index))} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Horizontal share bars for a breakdown. Hovering or focusing a row shows
 * its full name, which the row may truncate, with its count and share.
 */
export function Breakdown(props: {
  items: NamedCount[] | null | undefined
  label?: (name: string) => string
  empty: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const items = props.items ?? []
  const total = items.reduce((sum, item) => sum + item.count, 0)
  if (items.length === 0) {
    return <p className='text-muted-foreground text-xs'>{props.empty}</p>
  }
  return (
    <TooltipProvider delay={0}>
      <ul className='-mx-1.5 grid gap-0.5 text-sm'>
        {items.map((item) => {
          const name = props.label ? props.label(item.name) : item.name
          const share = total ? item.count / total : 0
          return (
            <li key={item.name} className='min-w-0'>
              <TapTooltip>
                <TapTooltipTrigger
                  render={
                    <div
                      tabIndex={0}
                      aria-label={`${name}: ${fmt.num(item.count)}, ${fmt.pct(share)}`}
                      className='group/row hover:bg-muted/50 data-popup-open:bg-muted/50 focus-visible:ring-ring/50 grid grid-cols-1 gap-1 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2'
                    />
                  }
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='truncate'>{name}</span>
                    <span className='text-muted-foreground shrink-0 tabular-nums'>
                      {fmt.num(item.count)} · {fmt.pct(share)}
                    </span>
                  </div>
                  <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
                    <div
                      className='bg-primary/60 group-hover/row:bg-primary group-focus-visible/row:bg-primary h-full rounded-full transition-colors'
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                </TapTooltipTrigger>
                <TooltipContent className='block max-w-sm py-2'>
                  <p className='mb-1 font-semibold break-words'>{name}</p>
                  <p className='tabular-nums opacity-80'>
                    {t('{{count}} of {{total}} · {{share}}', {
                      count: fmt.num(item.count),
                      total: fmt.num(total),
                      share: fmt.pct(share),
                    })}
                  </p>
                </TooltipContent>
              </TapTooltip>
            </li>
          )
        })}
      </ul>
    </TooltipProvider>
  )
}

export type Column<T> = {
  key: string
  label: string
  /** What the column means, shown when its header is hovered or focused. */
  hint?: string
  align?: 'right'
  render: (row: T) => ReactNode
}

// Rows a table shows at once. A longer list pages, so a view with several
// long tables stays short and renders only what is on screen.
const TABLE_PAGE_SIZE = 10

export function SimpleTable<T>(props: {
  columns: Column<T>[]
  rows: T[] | null | undefined
  rowKey: (row: T, index: number) => string | number
  empty: string
  /** Fades a row whose figures carry little weight, such as a small sample. */
  faded?: (row: T) => boolean
  /**
   * Draws each row as a card below the sm breakpoint, where a wide table
   * would scroll sideways; the table shows from sm up.
   */
  card?: (row: T) => ReactNode
}) {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const rows = props.rows ?? []
  if (rows.length === 0) {
    return <p className='text-muted-foreground text-xs'>{props.empty}</p>
  }
  const pages = Math.ceil(rows.length / TABLE_PAGE_SIZE)
  // A refresh can shorten the list below the page being read.
  const current = Math.min(page, pages - 1)
  const offset = current * TABLE_PAGE_SIZE
  const visible = rows.slice(offset, offset + TABLE_PAGE_SIZE)
  return (
    <TooltipProvider delay={HELP_DELAY}>
      {props.card && (
        <ul className='grid gap-2 sm:hidden'>
          {visible.map((row, index) => (
            <li
              key={props.rowKey(row, offset + index)}
              className={cn(
                'rounded-md border p-3 tabular-nums',
                props.faded?.(row) && 'text-muted-foreground'
              )}
            >
              {props.card?.(row)}
            </li>
          ))}
        </ul>
      )}
      <div
        className={cn('-mx-4 overflow-x-auto', props.card && 'hidden sm:block')}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {props.columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn(
                    'text-muted-foreground h-9 text-xs first:pl-4 last:pr-4',
                    column.align === 'right' && 'text-right'
                  )}
                >
                  <HelpLabel label={column.label} help={column.hint} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className='[&>tr]:h-10'>
            {visible.map((row, index) => (
              <TableRow
                key={props.rowKey(row, offset + index)}
                className={cn(props.faded?.(row) && 'text-muted-foreground')}
              >
                {props.columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      'py-1.5 tabular-nums first:pl-4 last:pr-4',
                      column.align === 'right' && 'text-right'
                    )}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {pages > 1 && (
        <div className='text-muted-foreground flex items-center justify-end gap-2 pt-2 text-xs tabular-nums'>
          <span>
            {t('Page {{current}} of {{total}}', {
              current: current + 1,
              total: pages,
            })}
          </span>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('Previous page')}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('Next page')}
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </TooltipProvider>
  )
}

/**
 * A count with its rate beside it, in a fixed-width muted column, so both
 * line up when a table is read down.
 */
export function CountRate(props: { count: string; rate: string }) {
  return (
    <span className='inline-flex items-baseline justify-end gap-2'>
      <span>{props.count}</span>
      <span className='text-muted-foreground w-12 text-xs'>{props.rate}</span>
    </span>
  )
}

export function UserLabel(props: { user_id: number; username: string }) {
  return (
    <span className='truncate'>
      {props.username || '-'}{' '}
      <span className='text-muted-foreground font-mono text-xs'>
        #{props.user_id}
      </span>
    </span>
  )
}

export function TruncatedNotice(props: { show: boolean }) {
  const { t } = useTranslation()
  if (!props.show) return null
  return (
    <p className='text-xs text-amber-600 dark:text-amber-400'>
      {t(
        'This range has more request logs than one view reads; figures cover the newest 200,000.'
      )}
    </p>
  )
}
