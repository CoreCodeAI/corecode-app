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

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { useChargeFormat, useInsightsFormat } from '../lib'
import { usePartialDays } from '../partial-days'
import type { FinanceInsights } from '../types'
import { ChargeValue, ClaudeEconomics, Figure } from './claude-economics'
import { BarSeries, Panel, SimpleTable } from './shared'

/**
 * The vendors the server splits new-api's charge by (model.ModelVendor),
 * in the order shown. Only Claude has accounts whose cost is counted.
 */
const VENDORS = [
  { key: 'claude', label: 'Claude' },
  { key: 'codex', label: 'Codex' },
  { key: 'grok', label: 'Grok' },
  { key: 'gemini', label: 'Gemini' },
] as const

const OTHER = 'other'

/** new-api's charge by vendor, a tab each; Claude's tab adds what it costs. */
export function VendorTabs(props: { data: FinanceInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const charge = useChargeFormat(props.data)
  const [vendor, setVendor] = useState<string>('claude')
  const models = props.data?.vendor_models ?? []
  const totals = new Map<string, { usd: number; requests: number }>()
  for (const model of models) {
    const total = totals.get(model.vendor) ?? { usd: 0, requests: 0 }
    total.usd += model.usd
    total.requests += model.requests
    totals.set(model.vendor, total)
  }
  // An unrecognised model gets a tab only when it was charged for.
  const tabs = [
    ...VENDORS,
    ...((totals.get(OTHER)?.usd ?? 0) > 0
      ? [{ key: OTHER, label: t('Other models') }]
      : []),
  ]

  return (
    <Tabs
      value={vendor}
      onValueChange={(value) => setVendor(String(value))}
      className='min-w-0'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='text-sm font-semibold'>
            {t('Usage and cost by vendor')}
          </h2>
          <p className='text-muted-foreground text-xs'>
            {t(
              'new-api’s charge in dollars at ¥{{rate}} to the dollar, to compare with gpt-load; the yuan beside it.',
              { rate: fmt.num(charge.rate) }
            )}
          </p>
        </div>
        <TabsList className='h-auto max-w-full justify-start overflow-x-auto'>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} className='gap-2 px-3'>
              {tab.label}
              {props.data?.vendor_models && (
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {fmt.usdWhole(charge.toUSD(totals.get(tab.key)?.usd ?? 0))}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value='claude' className='grid gap-4 pt-2'>
        <ClaudeEconomics data={props.data} />
      </TabsContent>
      {tabs
        .filter((tab) => tab.key !== 'claude')
        .map((tab) => (
          <TabsContent key={tab.key} value={tab.key} className='pt-2'>
            <VendorCharge
              data={props.data}
              vendor={tab.key}
              label={tab.label}
            />
          </TabsContent>
        ))}
    </Tabs>
  )
}

/**
 * What new-api charged for one vendor's models. No account cost is counted
 * for these vendors yet, so there is no ratio against one.
 */
function VendorCharge(props: {
  data: FinanceInsights | undefined
  vendor: string
  label: string
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const partialDay = usePartialDays('finance')
  const charge = useChargeFormat(props.data)
  const all = props.data?.vendor_models ?? []
  const models = all.filter((model) => model.vendor === props.vendor)
  const usd = models.reduce((sum, model) => sum + model.usd, 0)
  const requests = models.reduce((sum, model) => sum + model.requests, 0)
  const allUSD = all.reduce((sum, model) => sum + model.usd, 0)
  const daily = props.data?.daily ?? []

  return (
    <Panel
      title={t('{{vendor}}: new-api usage', { vendor: props.label })}
      help={t(
        'What new-api deducted for this vendor’s models at its own ratios, root included, gifted and paid balance alike. Customers pay ¥1 for each new-api dollar, so it is shown in dollars at the site’s USD exchange rate, with the yuan beside it. A model belongs to a vendor by its name: claude-, gpt- and codex-, grok-, gemini-. No account cost is counted for this vendor yet.'
      )}
    >
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Figure
          loading={!props.data}
          dot='bg-primary'
          label={t('new-api charge')}
          help={t(
            'What new-api deducted for this vendor’s models, root included. In dollars at the site’s exchange rate; the yuan new-api counted is in brackets.'
          )}
          value={
            <ChargeValue usd={fmt.usd(charge.toUSD(usd))} yuan={fmt.cny(usd)} />
          }
        />
        <Figure
          loading={!props.data}
          label={t('Requests')}
          value={fmt.num(requests)}
        />
        <Figure
          loading={!props.data}
          label={t('Charge per request')}
          help={t('The charge divided by the requests.')}
          value={
            requests > 0 ? (
              <ChargeValue
                usd={fmt.usdFine(charge.toUSD(usd / requests))}
                yuan={fmt.cny(usd / requests)}
              />
            ) : (
              '-'
            )
          }
        />
        <Figure
          loading={!props.data}
          label={t('Share of all new-api charge')}
          help={t(
            'This vendor’s charge as a share of new-api’s charge for every model.'
          )}
          value={allUSD > 0 ? fmt.pct(usd / allUSD) : '-'}
        />
      </div>
      <div className='mt-4 border-t pt-4'>
        <BarSeries
          ariaLabel={t('Daily {{vendor}} charge', { vendor: props.label })}
          series={[
            {
              label: t('new-api charge'),
              format: charge.usd,
              compact: fmt.usdCompact,
            },
          ]}
          points={daily.map((day) => ({
            key: day.day,
            title: fmt.day(day.day),
            values: [charge.toUSD(day.vendor_usd?.[props.vendor] ?? 0)],
            partial: partialDay(day.day, [
              charge.toUSD(day.vendor_usd?.[props.vendor] ?? 0),
            ]),
          }))}
        />
      </div>
      <div className='mt-4 border-t pt-2'>
        <SimpleTable
          rows={models}
          rowKey={(row) => row.model}
          empty={t('No charge for this vendor in this range')}
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
              render: (row) => fmt.num(row.requests),
            },
            {
              key: 'per',
              label: t('Charge per request'),
              align: 'right',
              render: (row) =>
                row.requests > 0
                  ? charge.usdFine(charge.toUSD(row.usd / row.requests))
                  : '-',
            },
            {
              key: 'usd',
              label: t('new-api charge'),
              align: 'right',
              render: (row) => charge.usd(charge.toUSD(row.usd)),
            },
            {
              key: 'share',
              label: t('Share'),
              align: 'right',
              render: (row) => (usd > 0 ? fmt.pct(row.usd / usd) : '-'),
            },
          ]}
        />
      </div>
    </Panel>
  )
}
