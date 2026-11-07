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
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatPercent } from '@/lib/format'

import {
  RISK_GATE_STAGES,
  getRiskGateEvents,
  getRiskGateSummary,
  type RiskGateEvent,
  type RiskGateRange,
  type RiskGateStage,
  type RiskGateSummary,
} from './api'
import { useRiskGateColumns, useRiskGateStageLabels } from './risk-gate-columns'

const EMPTY_EVENTS: RiskGateEvent[] = []
const ALL_STAGES = 'all'

// The viewer's own day, so "today" matches the clock they read.
function todayRange(): RiskGateRange {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  return {
    start: Math.floor(midnight.getTime() / 1000),
    end: Math.floor(Date.now() / 1000) + 1,
  }
}

type StageTotals = Record<
  RiskGateStage,
  { blocked: number; observed: number; failOpen: number }
>

function stageTotals(summary: RiskGateSummary | undefined): StageTotals {
  const totals = Object.fromEntries(
    RISK_GATE_STAGES.map((stage) => [
      stage,
      { blocked: 0, observed: 0, failOpen: 0 },
    ])
  ) as StageTotals
  for (const row of summary?.stages ?? []) {
    const total = totals[row.stage]
    if (!total) continue
    if (row.action === 'blocked') total.blocked += row.count
    if (row.action === 'observed') total.observed += row.count
    if (row.action === 'fail_open') total.failOpen += row.count
  }
  return totals
}

type FunnelCardProps = {
  step?: number
  title: string
  value: string
  note: string
}

function FunnelCard(props: FunnelCardProps) {
  return (
    <div className='bg-card flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5'>
      <span className='text-muted-foreground text-xs'>
        {props.step ? `${props.step} · ` : ''}
        {props.title}
      </span>
      <span className='text-2xl font-semibold tabular-nums'>{props.value}</span>
      <span className='text-muted-foreground text-xs'>{props.note}</span>
    </div>
  )
}

export function RiskGateDashboard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const stageLabels = useRiskGateStageLabels()
  const [stage, setStage] = useState<string>(ALL_STAGES)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  const summary = useQuery({
    queryKey: ['risk-gate-summary'],
    queryFn: () => getRiskGateSummary(todayRange()),
    refetchInterval: 60_000,
  })
  const events = useQuery({
    queryKey: ['risk-gate-events', pagination, stage],
    queryFn: () =>
      getRiskGateEvents({
        ...todayRange(),
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        stage: stage === ALL_STAGES ? undefined : stage,
      }),
    refetchInterval: 60_000,
  })

  const totals = useMemo(() => stageTotals(summary.data), [summary.data])
  const inbound = summary.data?.inbound ?? 0
  const blocked = RISK_GATE_STAGES.reduce(
    (sum, key) => sum + totals[key].blocked,
    0
  )
  const share = (count: number) =>
    inbound > 0 ? formatPercent((count / inbound) * 100) : '-'

  const columns = useRiskGateColumns()
  const { table } = useDataTable({
    columns,
    data: events.data?.items ?? EMPTY_EVENTS,
    getRowId: (event) => String(event.id),
    totalCount: events.data?.total ?? 0,
    pagination,
    onPaginationChange: (updater) =>
      setPagination((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        return next.pageSize === previous.pageSize
          ? next
          : { pageIndex: 0, pageSize: next.pageSize }
      }),
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })

  const selectStage = (next: string) => {
    setStage(next)
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
  }
  const stageItems = [
    { value: ALL_STAGES, label: t('All stages') },
    ...RISK_GATE_STAGES.map((key) => ({
      value: key,
      label: stageLabels[key],
    })),
  ]

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6'>
        <FunnelCard
          title={t('Requests in today')}
          value={formatNumber(inbound, locale)}
          note={t('Blocked {{count}} · {{share}}', {
            count: formatNumber(blocked, locale),
            share: share(blocked),
          })}
        />
        {RISK_GATE_STAGES.map((key, index) => {
          const total = totals[key]
          let note = t('Blocked · {{share}} of requests', {
            share: share(total.blocked),
          })
          if (total.observed > 0) {
            note = t('Would block {{count}} (observe)', {
              count: formatNumber(total.observed, locale),
            })
          }
          if (key === 'decision' && total.failOpen > 0) {
            note += ` · ${t('Failed open {{count}}', {
              count: formatNumber(total.failOpen, locale),
            })}`
          }
          return (
            <FunnelCard
              key={key}
              step={index + 1}
              title={stageLabels[key]}
              value={formatNumber(total.blocked, locale)}
              note={note}
            />
          )
        })}
        <FunnelCard
          step={5}
          title={t('Passed')}
          value={formatNumber(Math.max(inbound - blocked, 0), locale)}
          note={t('Pass rate {{share}}', {
            share: share(Math.max(inbound - blocked, 0)),
          })}
        />
      </div>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Decision model calls today: {{calls}}, failed {{failures}}. Repeated text reuses an earlier verdict for an hour.',
          {
            calls: formatNumber(summary.data?.decision_calls ?? 0, locale),
            failures: formatNumber(
              summary.data?.decision_failures ?? 0,
              locale
            ),
          }
        )}
      </p>

      <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
        <div className='flex min-w-0 flex-col gap-2'>
          <h4 className='text-sm font-medium'>{t('Hits today')}</h4>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Grouped by stage and rule. A rule far above the rest is the first to suspect of false positives.'
            )}
          </p>
          {(summary.data?.hits ?? []).length === 0 ? (
            <p className='text-muted-foreground py-6 text-center text-sm'>
              {t('Nothing was stopped today')}
            </p>
          ) : (
            <div className='flex flex-col gap-1'>
              {summary.data?.hits.map((hit) => (
                <Button
                  key={`${hit.stage}:${hit.rule}`}
                  variant='ghost'
                  className='h-auto justify-between gap-2 px-2 py-1.5'
                  onClick={() => selectStage(hit.stage)}
                >
                  <span className='flex min-w-0 items-center gap-2'>
                    <span className='text-muted-foreground text-xs'>
                      {stageLabels[hit.stage]}
                    </span>
                    <span className='truncate font-mono text-xs'>
                      {hit.rule}
                    </span>
                  </span>
                  <span className='font-semibold tabular-nums'>
                    {formatNumber(hit.count, locale)}
                  </span>
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className='flex min-w-0 flex-col gap-2'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h4 className='text-sm font-medium'>{t('Intercept log')}</h4>
            <Select
              items={stageItems}
              value={stage}
              onValueChange={(value) => selectStage(value ?? ALL_STAGES)}
            >
              <SelectTrigger className='w-44' aria-label={t('Stage')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {stageItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <DataTablePage
            table={table}
            columns={columns}
            isLoading={events.isPending}
            isFetching={events.isFetching}
            emptyTitle={
              events.isError
                ? t('Failed to load the risk audit')
                : t('Nothing was stopped today')
            }
            toolbarProps={null}
            hideMobile
            className='h-auto min-h-0'
            applyHeaderSize
            // The risk control page shows two tables; each keeps its own pages.
            paginationInFooter={false}
          />
        </div>
      </div>
    </div>
  )
}
