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

import { getPaymentMethodName } from '@/features/wallet/lib/billing'
import { cn } from '@/lib/utils'

import {
  failureTone,
  groupProvider,
  OTHER_COLOR,
  SERIES_COLORS,
  useInsightsFormat,
  useVendorName,
  vendorColor,
  VENDOR_ORDER,
} from '../lib'
import {
  POOL_PROVIDERS,
  type EnginePool,
  type FinanceInsights,
  type QualityInsights,
} from '../types'
import { ShareDonut, type ShareSlice } from './share-donut'
import { Panel, SimpleTable } from './shared'

const TONE_TEXT = {
  danger: 'text-destructive font-medium',
  warning: 'text-amber-600 dark:text-amber-400',
} as Record<string, string>

/** What each vendor charged at list price over the range. */
function vendorCharges(finance: FinanceInsights | undefined) {
  const totals = new Map<string, number>()
  for (const day of finance?.daily ?? []) {
    for (const [vendor, usd] of Object.entries(day.vendor_usd ?? {})) {
      totals.set(vendor, (totals.get(vendor) ?? 0) + usd)
    }
  }
  return totals
}

function byVendorOrder(a: string, b: string) {
  const rank = (vendor: string) => {
    const index = VENDOR_ORDER.indexOf(vendor)
    return index < 0 ? VENDOR_ORDER.length : index
  }
  return rank(a) - rank(b)
}

/**
 * One row per provider: its accounts and slots now, and its requests,
 * failures, first token and charge over the range.
 */
export function ProvidersPanel(props: {
  pool: EnginePool | undefined
  quality: QualityInsights | undefined
  finance: FinanceInsights | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  const charges = vendorCharges(props.finance)
  const quality = new Map(
    (props.quality?.vendors ?? []).map((row) => [row.vendor, row])
  )
  const rows = POOL_PROVIDERS.map((key) => {
    const groups = (props.pool?.groups ?? []).filter(
      (group) => groupProvider(group) === key
    )
    const enabled = groups.filter((group) => group.enabled)
    return {
      key,
      accounts: groups.reduce((sum, group) => sum + group.accounts, 0),
      eligible: groups.reduce((sum, group) => sum + group.eligible, 0),
      slots: enabled.reduce((sum, group) => sum + group.slots, 0),
      inFlight: groups.reduce((sum, group) => sum + group.in_flight, 0),
      quality: quality.get(key),
      charge: charges.get(key) ?? 0,
    }
  }).filter((row) => row.accounts > 0 || (row.quality?.requests ?? 0) > 0)

  return (
    <Panel
      title={t('By provider')}
      help={t(
        'Accounts, slots and in flight are live, from the engine. Requests, failures, first token and charge cover the range; GPT models run on the Codex accounts.'
      )}
    >
      <SimpleTable
        rows={props.pool || props.quality ? rows : undefined}
        rowKey={(row) => row.key}
        empty={t('No provider has accounts or requests')}
        columns={[
          {
            key: 'provider',
            label: t('Provider'),
            render: (row) => (
              <span className='flex items-center gap-2 font-medium'>
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 rounded-sm',
                    vendorColor(row.key).fill
                  )}
                />
                {vendorName(row.key)}
              </span>
            ),
          },
          {
            key: 'accounts',
            label: t('Schedulable accounts'),
            align: 'right',
            render: (row) => (
              <span
                className={cn(
                  row.accounts > 0 &&
                    row.eligible === 0 &&
                    'text-destructive font-medium'
                )}
              >
                {row.eligible} / {row.accounts}
              </span>
            ),
          },
          {
            key: 'in-flight',
            label: t('In flight now'),
            align: 'right',
            render: (row) =>
              row.slots ? `${row.inFlight} / ${row.slots}` : row.inFlight,
          },
          {
            key: 'requests',
            label: t('Requests'),
            align: 'right',
            render: (row) => fmt.num(row.quality?.requests ?? 0),
          },
          {
            key: 'failures',
            label: t('Failure rate'),
            align: 'right',
            render: (row) =>
              row.quality ? (
                <span
                  className={TONE_TEXT[failureTone(row.quality.error_rate)]}
                >
                  {fmt.pct(row.quality.error_rate)}
                </span>
              ) : (
                '-'
              ),
          },
          {
            key: 'ttft',
            label: t('TTFT p50'),
            align: 'right',
            render: (row) =>
              row.quality?.ttft_p50_ms
                ? fmt.measuredMs(row.quality.ttft_p50_ms)
                : '-',
          },
          {
            key: 'charge',
            label: t('Consumption'),
            align: 'right',
            render: (row) => fmt.cny(row.charge),
          },
        ]}
      />
    </Panel>
  )
}

/** Three wholes split: requests and charge by vendor, revenue by method. */
export function ShareCharts(props: {
  quality: QualityInsights | undefined
  finance: FinanceInsights | undefined
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  const vendorSlice = (vendor: string, value: number): ShareSlice => ({
    key: vendor,
    label: vendorName(vendor),
    value,
    color: vendorColor(vendor),
  })
  const requests = [...(props.quality?.vendors ?? [])]
    .sort((a, b) => byVendorOrder(a.vendor, b.vendor))
    .map((row) => vendorSlice(row.vendor, row.requests))
  const charges = [...vendorCharges(props.finance)]
    .sort(([a], [b]) => byVendorOrder(a, b))
    .map(([vendor, usd]) => vendorSlice(vendor, usd))
  // A method keeps its color while the same methods are paid with: the
  // slots follow the methods' names, not their amounts.
  const methods = [...(props.finance?.methods ?? [])].sort((a, b) =>
    a.payment_method.localeCompare(b.payment_method)
  )
  const revenue = methods.map((row, index) => ({
    key: row.payment_method,
    label: getPaymentMethodName(row.payment_method, t) || row.payment_method,
    value: row.money,
    color: SERIES_COLORS[index] ?? OTHER_COLOR,
  }))

  return (
    <div className='grid gap-4 lg:grid-cols-3'>
      <Panel
        title={t('Requests by provider')}
        help={t('Requests in the range, by the vendor of the model.')}
      >
        <ShareDonut
          loading={!props.quality}
          slices={requests}
          format={fmt.num}
          ariaLabel={t('Requests by provider')}
          totalLabel={t('Requests')}
          empty={t('No requests in this range')}
        />
      </Panel>
      <Panel
        title={t('Consumption by provider')}
        help={t(
          'What requests were charged at list price, root’s own included, by the vendor of the model.'
        )}
      >
        <ShareDonut
          loading={!props.finance}
          slices={charges}
          format={fmt.cny}
          ariaLabel={t('Consumption by provider')}
          totalLabel={t('Consumption')}
          empty={t('Nothing was charged in this range')}
        />
      </Panel>
      <Panel title={t('Revenue by payment method')}>
        <ShareDonut
          loading={!props.finance}
          slices={revenue}
          format={fmt.cny}
          ariaLabel={t('Revenue by payment method')}
          totalLabel={t('Revenue')}
          empty={t('No successful orders in this range')}
        />
      </Panel>
    </div>
  )
}

/**
 * The busiest models, each a bar of its requests in its vendor's color,
 * with its failure rate and first token beside it.
 */
export function TopModelsPanel(props: {
  quality: QualityInsights | undefined
  limit?: number
  onOpen?: () => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const vendorName = useVendorName()
  const models = [...(props.quality?.models ?? [])]
    .sort((a, b) => b.requests - a.requests)
    .slice(0, props.limit ?? 8)
  const most = models[0]?.requests ?? 0
  const total = props.quality?.requests ?? 0

  return (
    <Panel
      title={t('Busiest models')}
      description={
        props.quality && models.length > 0
          ? t('Top {{count}} of {{all}} models by requests.', {
              count: models.length,
              all: props.quality.models?.length ?? 0,
            })
          : undefined
      }
      actions={
        props.onOpen && (
          <button
            type='button'
            className='text-primary text-xs font-medium hover:underline'
            onClick={props.onOpen}
          >
            {t('Service quality')} →
          </button>
        )
      }
    >
      {!props.quality && (
        <div className='bg-muted h-40 animate-pulse rounded-md' />
      )}
      {props.quality && models.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          {t('No requests in this range')}
        </p>
      )}
      {models.length > 0 && (
        <ul className='grid gap-2.5'>
          {models.map((row) => (
            <li key={row.model} className='grid gap-1'>
              <div className='flex items-baseline gap-2 text-xs'>
                <span
                  className='min-w-0 flex-1 truncate font-mono'
                  title={row.model}
                >
                  {row.model}
                </span>
                <span className='text-muted-foreground shrink-0'>
                  {vendorName(row.vendor)}
                </span>
                <span className='w-16 shrink-0 text-right tabular-nums'>
                  {fmt.num(row.requests)}
                </span>
                <span className='text-muted-foreground w-12 shrink-0 text-right tabular-nums'>
                  {total ? fmt.pct(row.requests / total) : '-'}
                </span>
                <span
                  className={cn(
                    'w-14 shrink-0 text-right tabular-nums',
                    TONE_TEXT[failureTone(row.error_rate)] ??
                      'text-muted-foreground'
                  )}
                  title={t('Failure rate')}
                >
                  {fmt.pct(row.error_rate)}
                </span>
                <span
                  className='text-muted-foreground hidden w-14 shrink-0 text-right tabular-nums sm:inline'
                  title={t('TTFT p50')}
                >
                  {row.ttft_p50_ms ? fmt.measuredMs(row.ttft_p50_ms) : '-'}
                </span>
              </div>
              <div className='bg-muted h-1.5 overflow-hidden rounded-full'>
                <div
                  className={cn(
                    'h-full rounded-full',
                    vendorColor(row.vendor).fill
                  )}
                  style={{
                    width: `${most ? (row.requests / most) * 100 : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
