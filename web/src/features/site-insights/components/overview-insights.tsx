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

import { paymentMethodLabel } from '@/features/wallet/lib/billing'
import { cn } from '@/lib/utils'

import { dominant, type Contribution } from '../analysis'
import {
  useInsightsFormat,
  useTabLabel,
  useVendorName,
  type InsightsTab,
} from '../lib'
import type { FinanceInsights, QualityInsights } from '../types'
import { Drivers, SampleNote, type DriverRow } from './insight-kit'
import {
  consumptionContributions,
  methodOrders,
  requestContributions,
  revenueComparable,
  revenueContributions,
} from './overview-analysis'
import type { TabVerdicts } from './overview-verdicts'
import { Panel, type Tone } from './shared'

/** Parts listed under each headline change. */
const DRIVER_LIMIT = 3

type Pair<T> = [T | undefined, T | undefined]

const CARD_TONES: Record<Tone, { dot: string; ring: string }> = {
  danger: { dot: 'bg-destructive', ring: 'border-l-destructive' },
  warning: { dot: 'bg-amber-500', ring: 'border-l-amber-500' },
  default: {
    dot: 'bg-muted-foreground',
    ring: 'border-l-muted-foreground/40',
  },
  good: { dot: 'bg-emerald-500', ring: 'border-l-emerald-500' },
}

const TONE_RANK: Tone[] = ['danger', 'warning', 'default', 'good']

/**
 * One small card per tab: its name, its headline, a color for how it reads.
 * The rest of the verdict opens under the headline; the name opens the tab.
 */
export function TabCards(props: {
  verdicts: TabVerdicts
  onOpen?: (tab: InsightsTab, section?: string) => void
}) {
  const { t } = useTranslation()
  const label = useTabLabel()
  const cards = props.verdicts
    .flatMap(([tab, verdict]) => (verdict ? [{ tab, verdict }] : []))
    .sort(
      (a, b) =>
        TONE_RANK.indexOf(a.verdict.tone) - TONE_RANK.indexOf(b.verdict.tone)
    )
  if (cards.length === 0) return null
  return (
    <Panel
      title={t('Tab by tab')}
      help={t('Each tab’s own one-line verdict, the worst first.')}
    >
      <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {cards.map(({ tab, verdict }) => {
          const [headline = verdict.text, ...rest] = verdict.points
          const tone = CARD_TONES[verdict.tone]
          return (
            <li
              key={tab}
              data-tone={verdict.tone}
              className={cn(
                'bg-muted/20 grid content-start gap-1.5 rounded-lg border border-l-4 px-3 py-2.5',
                tone.ring
              )}
            >
              <div className='flex items-center gap-2'>
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', tone.dot)}
                />
                <span className='text-sm font-semibold'>{label(tab)}</span>
                {props.onOpen && (
                  <button
                    type='button'
                    className='text-primary ml-auto text-xs font-medium hover:underline'
                    onClick={() => props.onOpen?.(tab)}
                  >
                    {t('Open')} →
                  </button>
                )}
              </div>
              <p className='line-clamp-2 text-sm leading-snug' title={verdict.text}>
                {headline}
              </p>
              {rest.length > 0 && (
                <details className='group text-xs'>
                  <summary className='text-muted-foreground hover:text-foreground cursor-pointer select-none'>
                    {t('{{count}} more points', { count: rest.length })}
                  </summary>
                  <ul className='text-foreground/80 mt-1 grid list-disc gap-0.5 pl-4'>
                    {rest.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function signed(value: number, format: (value: number) => string): string {
  return value > 0 ? `+${format(value)}` : format(value)
}

/** The sentence naming the one or two parts that drove a change. */
function useDriverSentence() {
  const { t } = useTranslation()
  return (parts: Contribution[], label: (key: string) => string) => {
    const [first, second] = parts
    if (!first) return null
    if (!second) return t('Mostly {{part}}.', { part: label(first.key) })
    return t('Mostly {{first}} and {{second}}.', {
      first: label(first.key),
      second: label(second.key),
    })
  }
}

function driverRows(
  parts: Contribution[],
  label: (key: string) => string,
  change: (value: number) => string,
  share: (part: Contribution) => string | undefined
): DriverRow[] {
  return parts.slice(0, DRIVER_LIMIT).map((part) => ({
    key: part.key,
    label: label(part.key),
    change: change(part.change),
    share: share(part),
  }))
}

function DriverBlock(props: {
  title: string
  summary: string
  sentence: string | null
  rows: DriverRow[]
  note?: string
}) {
  const { t } = useTranslation()
  return (
    <div className='grid content-start gap-2'>
      <div>
        <p className='text-muted-foreground text-xs'>{props.title}</p>
        <p className='text-sm font-medium tabular-nums'>{props.summary}</p>
        {props.sentence && (
          <p className='text-muted-foreground text-xs'>{props.sentence}</p>
        )}
      </div>
      <Drivers
        rows={props.rows}
        empty={t('No part moved against the previous period.')}
      />
      {props.note && <SampleNote>{props.note}</SampleNote>}
    </div>
  )
}

/**
 * What drove each headline change against the previous period: requests by
 * model, consumption by provider, revenue by payment method.
 */
export function WhatChanged(props: {
  quality: Pair<QualityInsights>
  finance: Pair<FinanceInsights>
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  const sentence = useDriverSentence()
  const [quality, previousQuality] = props.quality
  const [finance, previousFinance] = props.finance
  if (!(quality && previousQuality) && !(finance && previousFinance)) {
    return null
  }
  // A part's share of the change, when it moved the same way as the whole.
  const shareOf = (total: number) => (part: Contribution) =>
    total !== 0 && Math.sign(part.change) === Math.sign(total)
      ? fmt.pct(part.change / total)
      : undefined
  const methodName = (method: string) => paymentMethodLabel(method, t)
  const name = (key: string) => key

  const blocks = []
  if (quality && previousQuality) {
    const parts = requestContributions(quality, previousQuality)
    const total = quality.requests - previousQuality.requests
    blocks.push(
      <DriverBlock
        key='requests'
        title={t('Requests by model')}
        summary={t('{{previous}} → {{current}} ({{change}})', {
          previous: fmt.num(previousQuality.requests),
          current: fmt.num(quality.requests),
          change: signed(total, fmt.num),
        })}
        sentence={sentence(dominant(parts, total), name)}
        rows={driverRows(
          parts,
          name,
          (value) => signed(value, fmt.num),
          shareOf(total)
        )}
      />
    )
  }
  if (finance && previousFinance) {
    const consumption = consumptionContributions(finance, previousFinance)
    const previousTotal = consumption.parts.reduce(
      (sum, part) => sum + part.previous,
      0
    )
    blocks.push(
      <DriverBlock
        key='consumption'
        title={t('Consumption by provider')}
        summary={t('{{previous}} → {{current}} ({{change}})', {
          previous: fmt.cny(previousTotal),
          current: fmt.cny(previousTotal + consumption.total),
          change: signed(consumption.total, fmt.cny),
        })}
        sentence={sentence(
          dominant(consumption.parts, consumption.total),
          vendorName
        )}
        rows={driverRows(
          consumption.parts,
          vendorName,
          (value) => signed(value, fmt.cny),
          shareOf(consumption.total)
        )}
      />
    )

    const revenue = revenueContributions(finance, previousFinance)
    const total = finance.revenue - previousFinance.revenue
    const comparable = revenueComparable(finance.orders, previousFinance.orders)
    const orders = methodOrders(finance, previousFinance)
    blocks.push(
      <DriverBlock
        key='revenue'
        title={t('Revenue by payment method')}
        summary={t('{{previous}} → {{current}} ({{change}})', {
          previous: fmt.cny(previousFinance.revenue),
          current: fmt.cny(finance.revenue),
          change: signed(total, fmt.cny),
        })}
        sentence={
          comparable ? sentence(dominant(revenue, total), methodName) : null
        }
        rows={driverRows(
          revenue,
          methodName,
          (value) => signed(value, fmt.cny),
          comparable
            ? shareOf(total)
            : (part) =>
                t('{{previous}} → {{current}} orders', {
                  previous: fmt.num(orders.get(part.key)?.previous ?? 0),
                  current: fmt.num(orders.get(part.key)?.current ?? 0),
                })
        )}
        note={
          comparable
            ? undefined
            : t(
                '{{previous}} orders before, {{current}} now: too few to read as a percentage.',
                {
                  previous: fmt.num(previousFinance.orders),
                  current: fmt.num(finance.orders),
                }
              )
        }
      />
    )
  }

  return (
    <Panel
      title={t('What changed')}
      help={t(
        'Each headline figure against the previous period of the same length, split into the parts that moved it most.'
      )}
    >
      <div className='grid gap-4 lg:grid-cols-3'>{blocks}</div>
    </Panel>
  )
}
