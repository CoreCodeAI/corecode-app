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
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import {
  getDayProfile,
  getInsights,
  getPoolOutlook,
  getPoolUsage,
  VIEW_MAX_DAYS,
  type InsightsView,
} from './api'
import { CapacityTab, type CapacityVendor } from './components/capacity-tab'
import { ChannelsTab } from './components/channels-tab'
import { FinanceTab } from './components/finance-tab'
import { ActivityTab, GrowthTab } from './components/growth-tab'
import { LogsNote } from './components/insight-kit'
import { OverviewTab } from './components/overview-tab'
import { PoolTab } from './components/pool-tab'
import { QualityTab } from './components/quality-tab'
import { RiskTab } from './components/risk-tab'
import { UpstreamTab } from './components/upstream-tab'
import {
  HOURLY_MAX_DAYS,
  INSIGHTS_PRESETS,
  INSIGHTS_TAB_GROUPS,
  OVERVIEW_VIEWS,
  POOL_REFRESH_CHOICES,
  previousRange,
  rangeStart,
  readPoolRefresh,
  sourceState,
  STALE_VIEW_SECONDS,
  useInsightsFormat,
  writePoolRefresh,
  type InsightsRangeInfo,
  type InsightsSources,
  type InsightsTab,
} from './lib'
import { InsightsSpanContext } from './partial-days'
import type { EngineOutlook, LogsSince, PoolProvider, PoolUsage } from './types'

const route = getRouteApi('/_authenticated/site-insights/')

// The capacity view carries live in-flight counts; the pool is all live.
// The pool tab itself refreshes at the interval chosen on it.
const REFRESH_MS: Partial<Record<InsightsView, number>> = {
  capacity: 30_000,
  pool: 15_000,
}

// The previous period has ended, so its figures change only when the range
// moves; they are kept longer than the current period's.
const PREVIOUS_STALE_MS = 5 * 60_000

function tabMaxDays(tab: InsightsTab) {
  if (tab !== 'overview') return VIEW_MAX_DAYS[tab]
  return Math.min(
    ...OVERVIEW_VIEWS.filter((view) => view !== 'pool').map(
      (view) => VIEW_MAX_DAYS[view]
    )
  )
}

/**
 * The root-only site dashboard. Each tab reads one /api/site-insights view
 * over the chosen number of days, clamped to what that view accepts, and the
 * same view over the period before it for comparison. The overview reads
 * several views and lists what needs attention.
 */
export function SiteInsights() {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tab: InsightsTab = search.tab ?? 'overview'
  const days = Math.min(search.days ?? 7, tabMaxDays(tab))
  // The end is fixed at load, so cached results do not refetch on every
  // render and a refetch re-reads the same window; only Refresh moves it to
  // now. Changing the range keeps it.
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  // The clock the page compares its end with, to say when the figures are
  // from; it does not move the end.
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(
      () => setClock(Math.floor(Date.now() / 1000)),
      30_000
    )
    return () => clearInterval(timer)
  }, [])
  const behind = clock - now > STALE_VIEW_SECONDS
  const [poolRefresh, setPoolRefresh] = useState(readPoolRefresh)
  // Every range starts on the hour it starts in, so a span is the same on
  // every tab and the previous period ends exactly where this one starts.
  const range: InsightsRangeInfo = {
    start: rangeStart(now, days),
    end: now,
    days,
    hourly: days <= HOURLY_MAX_DAYS,
  }
  const openTab = (next: InsightsTab) =>
    navigate({ search: (prev) => ({ ...prev, tab: next }) })

  const queryClient = useQueryClient()
  const viewDays = (view: InsightsView) =>
    Math.min(search.days ?? 7, VIEW_MAX_DAYS[view])
  // Only the quality view takes the model filter. The overview reads it
  // unfiltered, so its figures do not follow a filter set on another tab.
  const models = search.models ?? []
  const filterOf = (view: InsightsView, filtered: boolean) =>
    view === 'quality' && filtered ? models : []
  // The capacity tab can narrow to one provider; the overview never does.
  const vendorOf = (view: InsightsView, filtered: boolean) =>
    view === 'capacity' && filtered ? search.vendor : undefined
  const insightsQuery = (view: InsightsView, filtered = true) => {
    const range = {
      start_time: rangeStart(now, viewDays(view)),
      end_time: now,
    }
    const only = filterOf(view, filtered)
    const vendor = vendorOf(view, filtered)
    return {
      queryKey: [
        'site-insights',
        view,
        range,
        ...(only.length ? [only] : []),
        ...(vendor ? [vendor] : []),
      ],
      queryFn: () => getInsights(view, range, only, vendor),
      // A tab prefetched on hover is still fresh when it opens.
      staleTime: 30_000,
    }
  }
  const previousQuery = (view: InsightsView, filtered = true) => {
    const range = previousRange({
      start: rangeStart(now, viewDays(view)),
      days: viewDays(view),
    })
    const only = filterOf(view, filtered)
    const vendor = vendorOf(view, filtered)
    return {
      queryKey: [
        'site-insights',
        view,
        'previous',
        range,
        ...(only.length ? [only] : []),
        ...(vendor ? [vendor] : []),
      ],
      queryFn: () => getInsights(view, range, only, vendor),
      staleTime: PREVIOUS_STALE_MS,
      // The tab names a failed comparison where its changes would be.
      meta: { errorToast: false },
    }
  }
  const view = tab === 'overview' ? undefined : tab
  const query = useQuery({
    ...insightsQuery(view ?? 'capacity'),
    enabled: view !== undefined,
    refetchInterval:
      view === 'pool'
        ? poolRefresh * 1000 || false
        : ((view && REFRESH_MS[view]) ?? false),
    // A new range keeps the old figures on screen until its own arrive. Only
    // the same tab's data fits its component, so another tab starts empty.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === view ? previous : undefined,
  })
  // The pool tab's use on both sides moves slowly; the server shares a
  // read for a minute.
  const provider: PoolProvider = search.provider ?? 'claude'
  const usage = useQuery({
    queryKey: ['site-insights', 'pool-usage', provider],
    queryFn: () => getPoolUsage(provider),
    enabled: tab === 'pool',
    refetchInterval: poolRefresh ? 60_000 : false,
    staleTime: 30_000,
  })
  // The Claude pool's quota ahead moves with the pool, so it refreshes with
  // it. Its failure is shown in its own panel, not as a toast on every poll.
  const outlook = useQuery({
    queryKey: ['site-insights', 'pool-outlook'],
    queryFn: getPoolOutlook,
    enabled: tab === 'pool' && provider === 'claude',
    refetchInterval: poolRefresh * 1000 || false,
    meta: { errorToast: false },
  })
  // How a typical day's requests spread over its hours, to project the days
  // a range covers in part. It moves slowly; a server without it only marks
  // those days.
  const dayProfile = useQuery({
    queryKey: ['site-insights', 'day-profile'],
    queryFn: getDayProfile,
    staleTime: 60 * 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  // The finance, growth and quality tabs each show part of the business
  // view, which has no tab of its own. Its failure is named in the panels
  // that read it, not as a toast.
  const readsBusiness =
    tab === 'finance' || tab === 'growth' || tab === 'quality'
  const business = useQuery({
    ...insightsQuery('business'),
    enabled: readsBusiness,
    meta: { errorToast: false },
  })
  const businessPrevious = useQuery({
    ...previousQuery('business'),
    enabled: tab === 'growth' || tab === 'finance',
  })
  // The overview's own queries, so Refresh shows them loading there too.
  const overviewFetching = useIsFetching({ queryKey: ['site-insights'] })
  // The overview has no query of its own to say where the logs begin: the
  // capacity view's is the same query it already reads, so this shares it.
  const overviewLogs = useQuery({
    ...insightsQuery('capacity', false),
    enabled: tab === 'overview',
  })
  // Where the logs begin, from whichever view the page shows. The overview's
  // views reach back furthest, so its note starts from the earliest of them.
  const logsSince = (view === undefined ? overviewLogs.data : query.data) as
    | LogsSince
    | undefined
  const pageStart =
    view === undefined
      ? Math.min(
          ...OVERVIEW_VIEWS.filter((item) => item !== 'pool').map((item) =>
            rangeStart(now, viewDays(item))
          )
        )
      : range.start
  // The pool is live and has no earlier period.
  const previous = useQuery({
    ...previousQuery(view ?? 'capacity'),
    enabled: view !== undefined && view !== 'pool',
  })
  const prefetch = (next: InsightsTab) => {
    if (next === tab || next === 'overview') return
    void queryClient.prefetchQuery(insightsQuery(next))
    if (next !== 'pool') void queryClient.prefetchQuery(previousQuery(next))
  }

  const tabLabels: Record<InsightsTab, string> = {
    overview: t('Overview'),
    capacity: t('Capacity'),
    pool: t('Account pool'),
    quality: t('Service quality'),
    finance: t('Funds'),
    growth: t('Growth'),
    channels: t('Promotion channels'),
    upstream: t('Upstreams'),
    activity: t('Activity & retention'),
    risk: t('Risk'),
  }
  const groupLabels: Record<string, string> = {
    operations: t('Operations'),
    business: t('Revenue & growth'),
  }
  const presetLabel = (preset: number) =>
    preset === 1 ? t('24 hours') : t('{{count}} days', { count: preset })
  const refreshLabel = (seconds: number) => {
    if (seconds === 0) return t('Off')
    if (seconds < 60) return t('Every {{count}} seconds', { count: seconds })
    return t('Every {{count}} minutes', { count: seconds / 60 })
  }
  const refreshItems = POOL_REFRESH_CHOICES.map((seconds) => ({
    value: String(seconds),
    label: refreshLabel(seconds),
  }))
  const fetching = view ? query.isFetching : overviewFetching > 0
  // The pool is live and refreshes itself: its figures are from its last read.
  const asOf = tab === 'pool' ? Math.floor(query.dataUpdatedAt / 1000) : now
  const readsBusinessPrevious = tab === 'growth' || tab === 'finance'
  const sources: InsightsSources = {
    view: sourceState(query),
    previous: sourceState(previous),
    ...(readsBusiness && { business: sourceState(business) }),
    ...(readsBusinessPrevious && {
      businessPrevious: sourceState(businessPrevious),
    }),
  }

  // On a narrow screen the tabs scroll sideways in one row; the open one is
  // kept in view, including when the page opens on a later tab.
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = tabsRef.current
    const active = list?.querySelector('[data-active]')
    if (!list || !active) return
    const box = list.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.left < box.left) {
      list.scrollLeft -= box.left - item.left + 24
    } else if (item.right > box.right) {
      list.scrollLeft += item.right - box.right + 24
    }
  }, [tab])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Site Insights')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {/* A minmax track, so the tab row's width cannot widen the page. */}
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Tabs
              className='max-w-full min-w-0'
              value={tab}
              onValueChange={(value) =>
                navigate({
                  search: (prev) => ({ ...prev, tab: value as InsightsTab }),
                })
              }
            >
              <TabsList
                ref={tabsRef}
                className='no-scrollbar h-auto max-w-full justify-start overflow-x-auto group-data-horizontal/tabs:h-auto'
              >
                {INSIGHTS_TAB_GROUPS.map((group, index) => (
                  <Fragment key={group.key}>
                    {index > 0 && (
                      <span
                        aria-hidden
                        className='bg-border mx-1 h-4 w-px shrink-0'
                      />
                    )}
                    {group.key in groupLabels && (
                      <span
                        aria-hidden
                        className='text-muted-foreground shrink-0 px-1 text-[11px] whitespace-nowrap'
                      >
                        {groupLabels[group.key]}
                      </span>
                    )}
                    {group.tabs.map((item) => (
                      <TabsTrigger
                        key={item}
                        value={item}
                        className='h-7 flex-none px-2'
                        onPointerEnter={() => prefetch(item)}
                        onFocus={() => prefetch(item)}
                      >
                        {tabLabels[item]}
                      </TabsTrigger>
                    ))}
                  </Fragment>
                ))}
              </TabsList>
            </Tabs>
            <div className='flex items-center gap-2'>
              {tab === 'pool' ? (
                <Select
                  items={refreshItems}
                  value={String(poolRefresh)}
                  onValueChange={(value) => {
                    if (value === null) return
                    const next = Number(value)
                    setPoolRefresh(next)
                    writePoolRefresh(next)
                  }}
                >
                  <SelectTrigger className='h-8' aria-label={t('Auto refresh')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {refreshItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <ToggleGroup
                  variant='outline'
                  size='sm'
                  value={[String(days)]}
                  onValueChange={(value: string[]) => {
                    const next = Number(value.at(-1))
                    if (next) {
                      navigate({ search: (prev) => ({ ...prev, days: next }) })
                    }
                  }}
                >
                  {INSIGHTS_PRESETS.filter(
                    (preset) => preset <= tabMaxDays(tab)
                  ).map((preset) => (
                    <ToggleGroupItem key={preset} value={String(preset)}>
                      {presetLabel(preset)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
              {asOf > 0 && (
                <span className='text-muted-foreground text-xs whitespace-nowrap tabular-nums'>
                  {t('As of {{time}}', { time: fmt.clock(asOf) })}
                </span>
              )}
              <Button
                variant='outline'
                size='icon-sm'
                aria-label={t('Refresh')}
                onClick={() => setNow(Math.floor(Date.now() / 1000))}
                disabled={fetching}
              >
                <RefreshCw className={fetching ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </div>
          {behind && tab !== 'pool' && (
            <p className='text-muted-foreground text-xs'>
              {t('Figures are from then; Refresh reads to now.')}
            </p>
          )}
          <LogsNote start={pageStart} logsSince={logsSince?.logs_since} />
          {view && query.isError && (
            <p className='text-destructive text-sm'>
              {query.error instanceof Error
                ? query.error.message
                : t('Failed to load site insights')}
            </p>
          )}
          <InsightsSpanContext.Provider
            value={{ now, days: viewDays, hours: dayProfile.data?.hours ?? [] }}
          >
            {view ? (
              <InsightsView
                view={view}
                data={query.data}
                previous={previous.data}
                sources={sources}
                range={range}
                onOpen={openTab}
                business={{
                  data: business.data,
                  previous: businessPrevious.data,
                }}
                models={{
                  selected: models,
                  onChange: (next) =>
                    navigate({
                      search: (prev) => ({
                        ...prev,
                        models: next.length > 0 ? next : undefined,
                      }),
                    }),
                }}
                pool={{
                  provider,
                  onProvider: (next) =>
                    navigate({
                      search: (prev) => ({ ...prev, provider: next }),
                    }),
                  usage: usage.data,
                  usageError:
                    usage.error instanceof Error
                      ? usage.error.message
                      : undefined,
                  outlook: outlook.data,
                  outlookError:
                    outlook.error instanceof Error
                      ? outlook.error.message
                      : undefined,
                }}
                capacity={{
                  vendor: search.vendor ?? 'all',
                  onVendor: (next) =>
                    navigate({
                      search: (prev) => ({
                        ...prev,
                        vendor: next === 'all' ? undefined : next,
                      }),
                    }),
                }}
              />
            ) : (
              <OverviewTab
                current={(next) => insightsQuery(next, false)}
                previous={(next) => previousQuery(next, false)}
                refreshMs={REFRESH_MS}
                onOpen={openTab}
                range={range}
              />
            )}
          </InsightsSpanContext.Provider>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function InsightsView(props: {
  view: Exclude<InsightsView, 'business'>
  data: unknown
  previous: unknown
  sources: InsightsSources
  range: InsightsRangeInfo
  onOpen: (tab: InsightsTab) => void
  business: { data: unknown; previous: unknown }
  models: { selected: string[]; onChange: (models: string[]) => void }
  pool: {
    provider: PoolProvider
    onProvider: (provider: PoolProvider) => void
    usage: PoolUsage | undefined
    usageError: string | undefined
    outlook: EngineOutlook | undefined
    outlookError: string | undefined
  }
  capacity: {
    vendor: CapacityVendor
    onVendor: (vendor: CapacityVendor) => void
  }
}) {
  // Each query key includes the view, so data always matches it. The
  // previous period's key does too, and is undefined until it loads.
  const previous = props.previous as never
  const range = props.range
  const onOpen = props.onOpen
  // Every tab but the pool gets its queries' states. A spread, so a tab that
  // does not declare sources yet still type-checks.
  const states = { sources: props.sources }
  switch (props.view) {
    case 'capacity':
      return (
        <CapacityTab
          data={props.data as never}
          previous={previous}
          vendor={props.capacity.vendor}
          onVendor={props.capacity.onVendor}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'finance':
      return (
        <FinanceTab
          data={props.data as never}
          previous={previous}
          business={props.business.data as never}
          businessPrevious={props.business.previous as never}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'risk':
      return (
        <RiskTab
          data={props.data as never}
          previous={previous}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'growth':
      return (
        <GrowthTab
          data={props.data as never}
          previous={previous}
          business={props.business.data as never}
          businessPrevious={props.business.previous as never}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'activity':
      return (
        <ActivityTab
          data={props.data as never}
          previous={previous}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'quality':
      return (
        <QualityTab
          data={props.data as never}
          previous={previous}
          models={props.models}
          business={props.business.data as never}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'pool':
      return <PoolTab data={props.data as never} {...props.pool} />
    case 'channels':
      return (
        <ChannelsTab
          data={props.data as never}
          previous={previous}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
    case 'upstream':
      return (
        <UpstreamTab
          data={props.data as never}
          previous={previous}
          range={range}
          onOpen={onOpen}
          {...states}
        />
      )
  }
}
