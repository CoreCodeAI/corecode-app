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

import { failureTone, SMALL_SAMPLE, useInsightsFormat } from '../lib'
import type { BusinessInsights, QualityInsights } from '../types'
import {
  BarSeries,
  Breakdown,
  MetricGrid,
  Panel,
  SimpleTable,
  TruncatedNotice,
  UserLabel,
  type Tone,
} from './shared'

const RATE_TONES: Record<Tone, string> = {
  default: '',
  good: '',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive font-medium',
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
  const vendorLabels: Record<string, string> = {
    claude: t('Claude'),
    codex: t('GPT'),
    grok: t('Grok'),
    gemini: t('Gemini'),
    other: t('Other'),
  }
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
            'The cards and daily charts cover the selected models. The table, status codes, failure reasons and stream ends cover every model.'
          )}
        </span>
      )}
    </div>
  )
}

export function QualityTab(props: {
  data: QualityInsights | undefined
  previous?: QualityInsights
  models: { selected: string[]; onChange: (models: string[]) => void }
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const previous = props.previous
  const daily = data?.daily ?? []
  const worstDay = daily.reduce<(typeof daily)[number] | undefined>(
    (top, day) => (!top || day.error_rate > top.error_rate ? day : top),
    undefined
  )
  const sampled = (data?.models ?? []).filter(
    (row) => row.requests >= SMALL_SAMPLE
  )
  const worstModel = sampled.reduce<(typeof sampled)[number] | undefined>(
    (top, row) => (!top || row.error_rate > top.error_rate ? row : top),
    undefined
  )

  return (
    <div className='grid gap-4'>
      <ModelFilter
        options={data?.models}
        selected={props.models.selected}
        onChange={props.models.onChange}
      />
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Requests'),
            featured: true,
            value: fmt.num(data?.requests ?? 0),
            delta: {
              current: data?.requests ?? 0,
              previous: previous?.requests,
              better: 'neutral',
            },
            trend: daily.map((day) => ({
              title: fmt.day(day.day),
              value: day.requests,
            })),
            hint: t('{{count}} failed', { count: data?.errors ?? 0 }),
          },
          {
            label: t('Failure rate'),
            value: fmt.pct(data?.error_rate ?? 0),
            help: t('Colored above 2%; red above 5%.'),
            delta: {
              current: data?.error_rate ?? 0,
              previous: previous?.error_rate,
              better: 'down',
              points: true,
            },
            tone: failureTone(data?.error_rate ?? 0),
          },
          {
            label: t('TTFT p50'),
            value: fmt.measuredMs(data?.ttft_p50_ms ?? 0),
            delta: {
              current: data?.ttft_p50_ms ?? 0,
              previous: previous?.ttft_p50_ms || undefined,
              better: 'down',
            },
          },
          {
            label: t('TTFT p95'),
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
            value: fmt.pct(data?.cache_share ?? 0),
            hint: t('of input tokens'),
            delta: {
              current: data?.cache_share ?? 0,
              previous: previous?.cache_share,
              better: 'up',
              points: true,
            },
          },
        ]}
      />
      <TruncatedNotice show={!!data?.truncated} />
      <Panel
        title={t('By model')}
        description={
          worstModel && worstModel.error_rate > 0
            ? t('Highest failure rate: {{model}} at {{rate}}.', {
                model: worstModel.model,
                rate: fmt.pct(worstModel.error_rate),
              })
            : undefined
        }
        help={t(
          'Models with under 100 requests are faded: their rates and percentiles rest on too few requests to compare. With a model filter, models outside it are faded too. A dash means nothing was measured.'
        )}
      >
        <SimpleTable
          rows={data?.models}
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
                      RATE_TONES[failureTone(row.error_rate)]
                  )}
                >
                  {fmt.pct(row.error_rate)}
                </span>
              ),
            },
            {
              key: 'ttft',
              label: 'TTFT p50 / p95',
              align: 'right',
              render: (row) =>
                row.ttft_p50_ms || row.ttft_p95_ms
                  ? `${fmt.measuredMs(row.ttft_p50_ms)} / ${fmt.measuredMs(row.ttft_p95_ms)}`
                  : '—',
            },
            {
              key: 'lat',
              label: t('Duration p50 / p95'),
              align: 'right',
              render: (row) => `${row.latency_p50_s}s / ${row.latency_p95_s}s`,
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
        <Panel title={t('Input tokens by cache use')}>
          <BarSeries
            ariaLabel={t('Input tokens by cache use')}
            series={[
              { label: t('Cache read') },
              { label: t('Cache write') },
              { label: t('Uncached'), muted: true },
            ]}
            points={(data?.daily ?? []).map((day) => ({
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
        <Panel
          title={t('Daily failure rate')}
          description={
            worstDay && worstDay.error_rate > 0
              ? t('Worst day {{day}}: {{rate}} of {{count}} requests.', {
                  day: fmt.day(worstDay.day),
                  rate: fmt.pct(worstDay.error_rate),
                  count: fmt.num(worstDay.requests),
                })
              : undefined
          }
        >
          <BarSeries
            ariaLabel={t('Daily failure rate')}
            series={[{ label: t('Failure rate'), format: fmt.pct }]}
            points={(data?.daily ?? []).map((day) => ({
              key: day.day,
              title: fmt.day(day.day),
              values: [day.error_rate],
              extra: [
                { label: t('Failed'), value: fmt.num(day.errors) },
                { label: t('Requests'), value: fmt.num(day.requests) },
              ],
            }))}
          />
        </Panel>
      </div>
      <div className='grid gap-4 lg:grid-cols-3'>
        <Panel title={t('Failures by status code')}>
          <Breakdown
            items={data?.status_codes}
            empty={t('No failed requests in this range')}
          />
        </Panel>
        <Panel title={t('Failure reasons')}>
          <Breakdown
            items={data?.error_reasons}
            empty={t('No failed requests in this range')}
          />
        </Panel>
        <Panel title={t('How streams ended')}>
          <Breakdown
            items={data?.stream_ends}
            empty={t('No streamed requests in this range')}
          />
        </Panel>
      </div>
    </div>
  )
}

export function BusinessTab(props: {
  data: BusinessInsights | undefined
  previous?: BusinessInsights
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const data = props.data
  const previous = props.previous

  return (
    <div className='grid gap-4'>
      <MetricGrid
        loading={!data}
        items={[
          {
            label: t('Invitee consumption'),
            featured: true,
            value: fmt.usd(data?.invitee_spend_usd ?? 0),
            delta: {
              current: data?.invitee_spend_usd ?? 0,
              previous: previous?.invitee_spend_usd,
              better: 'up',
            },
            hint: t('{{inviters}} inviters brought {{invitees}} invitees', {
              inviters: fmt.num(data?.inviters ?? 0),
              invitees: fmt.num(data?.invitees ?? 0),
            }),
          },
          {
            label: t('Invitee payments'),
            value: fmt.cny(data?.invitee_payments ?? 0),
            delta: {
              current: data?.invitee_payments ?? 0,
              previous: previous?.invitee_payments,
              better: 'up',
            },
          },
          {
            label: t('Commission credited'),
            value: fmt.usd(data?.commission_usd ?? 0),
            delta: {
              current: data?.commission_usd ?? 0,
              previous: previous?.commission_usd,
              better: 'neutral',
            },
          },
          {
            label: t('Commission ÷ invitee consumption'),
            value: fmt.pct(data?.commission_to_spend ?? 0),
            help: t('Colored above 30%, where commission eats the margin.'),
            tone:
              (data?.commission_to_spend ?? 0) > 0.3 ? 'warning' : 'default',
          },
        ]}
      />
      <Panel
        title={t('Model economics')}
        description={
          data
            ? t('{{revenue}} of revenue in this range, split by consumption.', {
                revenue: fmt.cny(data.revenue),
              })
            : undefined
        }
        help={t(
          'Revenue is allocated to models by their share of list-price consumption; it is an estimate. Models with under 100 requests are faded.'
        )}
      >
        <SimpleTable
          rows={data?.models}
          rowKey={(row) => row.model}
          faded={(row) => row.requests < SMALL_SAMPLE}
          empty={t('No consumption in this range')}
          columns={[
            {
              key: 'model',
              label: t('Model'),
              render: (row) => (
                <span className='font-mono text-xs'>{row.model}</span>
              ),
            },
            {
              key: 'usd',
              label: t('Consumption'),
              align: 'right',
              render: (row) => fmt.usd(row.quota_usd),
            },
            {
              key: 'share',
              label: t('Share'),
              align: 'right',
              render: (row) => fmt.pct(row.share),
            },
            {
              key: 'rev',
              label: t('Revenue (est.)'),
              align: 'right',
              render: (row) => fmt.cny(row.revenue_estimate),
            },
            {
              key: 'per',
              label: t('Per request'),
              align: 'right',
              render: (row) => fmt.usd(row.per_request_usd),
            },
            {
              key: 'users',
              label: t('Users'),
              align: 'right',
              render: (row) => fmt.num(row.users),
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
      <Panel title={t('Referral return by inviter')}>
        <SimpleTable
          rows={data?.top_inviters}
          rowKey={(row) => row.user_id}
          empty={t('No referrals')}
          columns={[
            {
              key: 'user',
              label: t('Inviter'),
              render: (row) => <UserLabel {...row} />,
            },
            {
              key: 'inv',
              label: t('Invitees (active)'),
              align: 'right',
              render: (row) => `${row.invitees} (${row.active_invitees})`,
            },
            {
              key: 'spend',
              label: t('Invitee consumption'),
              align: 'right',
              render: (row) => fmt.usd(row.spend_usd),
            },
            {
              key: 'pay',
              label: t('Invitee payments'),
              align: 'right',
              render: (row) => fmt.cny(row.payments),
            },
            {
              key: 'com',
              label: t('Commission'),
              align: 'right',
              render: (row) => fmt.usd(row.commission_usd),
            },
          ]}
        />
      </Panel>
      <div className='grid gap-4 lg:grid-cols-2'>
        <Panel
          title={t('Clients')}
          help={t(
            'Requests by client and version. Logs written before this was recorded count as unknown.'
          )}
        >
          <Breakdown
            items={data?.clients}
            empty={t('No requests in this range')}
          />
        </Panel>
        <Panel title={t('Users by group')}>
          <Breakdown items={data?.groups} empty={t('No users')} />
        </Panel>
      </div>
    </div>
  )
}
