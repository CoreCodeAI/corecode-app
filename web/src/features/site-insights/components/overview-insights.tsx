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

import { dominant, type Contribution } from '../analysis'
import {
  useInsightsFormat,
  useVendorName,
  type InsightsRangeInfo,
  type InsightsTab,
  paymentMethodLabel,
} from '../lib'
import type {
  CapacityInsights,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
  UpstreamInsights,
} from '../types'
import {
  useCapacityVerdict,
  useFinanceVerdict,
  useQualityVerdict,
  useRiskVerdict,
  useUpstreamVerdict,
  type TabVerdict,
} from '../verdicts'
import {
  Drivers,
  Findings,
  SampleNote,
  type DriverRow,
  type Finding,
} from './insight-kit'
import {
  consumptionContributions,
  methodOrders,
  requestContributions,
  revenueComparable,
  revenueContributions,
} from './overview-analysis'
import { Panel } from './shared'

/** Parts listed under each headline change. */
const DRIVER_LIMIT = 3

type Pair<T> = [T | undefined, T | undefined]

/** One line per tab: its verdict, worst first, each linked to its tab. */
export function TabDigest(props: {
  capacity: Pair<CapacityInsights>
  quality: Pair<QualityInsights>
  finance: Pair<FinanceInsights>
  risk: RiskInsights | undefined
  upstream: Pair<UpstreamInsights>
  range?: InsightsRangeInfo
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const verdicts: [InsightsTab, TabVerdict | undefined][] = [
    ['capacity', useCapacityVerdict(props.capacity[0], props.capacity[1])],
    ['quality', useQualityVerdict(props.quality[0], props.quality[1])],
    ['finance', useFinanceVerdict(props.finance[0], props.finance[1])],
    [
      'upstream',
      useUpstreamVerdict(props.upstream[0], props.upstream[1], props.range),
    ],
    ['risk', useRiskVerdict(props.risk)],
  ]
  const items: Finding[] = verdicts.flatMap(([tab, verdict]) =>
    verdict ? [{ key: tab, tone: verdict.tone, title: verdict.text, tab }] : []
  )
  if (items.length === 0) return null
  return (
    <Panel
      title={t('Tab by tab')}
      help={t('Each tab’s own one-line verdict, the worst first.')}
    >
      <Findings items={items} onOpen={props.onOpen} />
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
