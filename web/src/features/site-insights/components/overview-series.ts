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
import { alignPrevious, beforeLogs, closedHours } from '../analysis'
import { countsRequestsOnce } from '../lib'
import { previousDayPartial, type PartialMark } from '../partial-days'
import type {
  ActivityInsights,
  CapacityInsights,
  FinanceInsights,
  QualityInsights,
  RiskInsights,
} from '../types'
import type { TrendPoint } from './shared'

/**
 * An hourly series as trend points, the hour still filling left out. Each
 * point's previous-period value is the hour one range earlier, where that
 * period has it and the comparison holds.
 */
export function hourlyTrend<
  T extends { hour: number },
  B extends { hour: number },
>(
  rows: T[],
  end: number,
  options: {
    title: (hour: number) => string
    value: (row: T) => number
    earlier: B[] | null | undefined
    earlierValue: (row: B) => number
    span: number
    gate: boolean
    /** An hour before the logs: drawn missing, not as zero. */
    missing?: (hour: number) => boolean
  }
): TrendPoint[] {
  const closed = closedHours(rows, end)
  const before = alignPrevious(closed, options.earlier, options.span)
  return closed.map((row, index) => {
    const prior = before[index]
    return {
      title: options.title(row.hour),
      value: options.value(row),
      missing: options.missing?.(row.hour),
      previous:
        options.gate && options.span > 0 && prior
          ? options.earlierValue(prior)
          : undefined,
    }
  })
}

/**
 * A daily series as trend points. The previous period is read at the same
 * place in its range (day 1 with day 1), where the comparison holds.
 */
export function dailyTrend<
  T extends { day: number },
  B extends { day: number },
>(
  rows: T[],
  options: {
    title: (day: number) => string
    value: (row: T) => number
    earlier: B[] | null | undefined
    earlierValue: (row: B) => number
    gate: boolean
    partial?: (row: T, value: number) => PartialMark | undefined
    missing?: (day: number) => boolean
  }
): TrendPoint[] {
  const earlier = options.earlier ?? []
  return rows.map((row, index) => {
    const value = options.value(row)
    const prior = earlier.at(index)
    return {
      title: options.title(row.day),
      value,
      partial: options.partial?.(row, value),
      missing: options.missing?.(row.day),
      previous: options.gate && prior ? options.earlierValue(prior) : undefined,
      previousPartial: previousDayPartial(index, earlier.length),
    }
  })
}

/** What the overview's trends are read from. */
export type OverviewTrendInput = {
  hourly: boolean
  end: number
  span: number
  /** The previous period lies before the logs begin: nothing is compared. */
  previousMissing: boolean
  logsSince: number | null | undefined
  dayTitle: (day: number) => string
  hourTitle: (hour: number) => string
  financeDay: (day: number, values?: number[]) => PartialMark | undefined
  qualityDay: (day: number, values?: number[]) => PartialMark | undefined
  finance?: FinanceInsights
  previousFinance?: FinanceInsights
  quality?: QualityInsights
  previousQuality?: QualityInsights
  capacity?: CapacityInsights
  previousCapacity?: CapacityInsights
  risk?: RiskInsights
  previousRisk?: RiskInsights
  activity?: ActivityInsights
  previousActivity?: ActivityInsights
}

/** The series the overview's cards and charts draw, oldest first. */
export type OverviewTrends = {
  revenue?: TrendPoint[]
  /** What customers and root were charged at list price. */
  consumption?: TrendPoint[]
  /** Revenue earned; a day series only, as the server sends no hours. */
  recognized?: TrendPoint[]
  requests?: TrendPoint[]
  failureRate?: TrendPoint[]
  signups?: TrendPoint[]
  activeUsers?: TrendPoint[]
}

const revenueOf = (row: { topup: number; subscription: number }) =>
  row.topup + row.subscription

const chargeOf = (row: {
  consumption_usd: number
  root_consumption_usd?: number
}) => row.consumption_usd + (row.root_consumption_usd ?? 0)

/**
 * A short range reads by the hour, the hour still filling left out; a longer
 * one by the day. The previous period is read at the same place in its range:
 * a day by its place, an hour by the hour one range earlier. Nothing is
 * compared where that period is missing, or counts requests another way.
 */
export function overviewTrends(input: OverviewTrendInput): OverviewTrends {
  const {
    hourly,
    end,
    span,
    previousMissing,
    logsSince,
    finance,
    previousFinance,
    quality,
    previousQuality,
    capacity,
    previousCapacity,
    risk,
    previousRisk,
    activity,
    previousActivity,
  } = input
  const requestsComparable =
    !previousMissing &&
    countsRequestsOnce(previousQuality) === countsRequestsOnce(quality)
  const gate = !previousMissing

  const money = (
    pick: (row: {
      topup: number
      subscription: number
      consumption_usd: number
      root_consumption_usd?: number
      recognized_revenue?: number
    }) => number,
    projects = true
  ): TrendPoint[] | undefined => {
    if (hourly) {
      if (!finance?.hourly) return undefined
      return hourlyTrend(finance.hourly, end, {
        title: input.hourTitle,
        value: pick,
        earlier: previousFinance?.hourly,
        earlierValue: pick,
        span,
        gate,
      })
    }
    return dailyTrend(finance?.daily ?? [], {
      title: input.dayTitle,
      value: pick,
      earlier: previousFinance?.daily,
      earlierValue: pick,
      gate,
      // A plan earns by the hour and a wallet by use, so earned revenue marks
      // part of a day instead of projecting it from requests.
      partial: (row, value) =>
        input.financeDay(row.day, projects ? [value] : undefined),
    })
  }

  type RequestRow = { hour: number; requests: number; error_rate?: number }
  const requestRows: RequestRow[] | null | undefined =
    quality?.hourly ?? capacity?.hourly
  const earlierRequestRows: RequestRow[] | null | undefined = quality?.hourly
    ? previousQuality?.hourly
    : previousCapacity?.hourly
  // A day's projection is of its requests; a rate has none.
  const requestSeries = (
    pick: (row: { requests: number; error_rate?: number }) => number,
    projects: boolean
  ): TrendPoint[] | undefined => {
    if (hourly) {
      if (!requestRows) return undefined
      // An hour before the logs has no data: drawn missing, not as zero.
      return hourlyTrend(requestRows, end, {
        title: input.hourTitle,
        value: pick,
        earlier: earlierRequestRows,
        earlierValue: pick,
        span,
        gate: requestsComparable,
        missing: (hour) => beforeLogs(hour, 3600, logsSince),
      })
    }
    return dailyTrend(quality?.daily ?? [], {
      title: input.dayTitle,
      value: pick,
      earlier: previousQuality?.daily,
      earlierValue: pick,
      gate: requestsComparable,
      partial: (row) => {
        const mark = input.qualityDay(row.day, [row.requests])
        return projects || !mark ? mark : { note: mark.note }
      },
      missing: (day) => beforeLogs(day, 86400, logsSince),
    })
  }

  let signups: TrendPoint[] | undefined
  if (risk?.signup_series) {
    const series = risk.signup_series.map((point) => ({
      hour: point.at,
      value: point.count,
    }))
    // Sign-ups of the previous period, on the same unit as this one.
    const earlier =
      previousRisk?.series_unit === risk.series_unit
        ? (previousRisk.signup_series ?? []).map((point) => ({
            hour: point.at,
            value: point.count,
          }))
        : []
    signups =
      risk.series_unit === 'hour'
        ? hourlyTrend(series, end || Infinity, {
            title: input.hourTitle,
            value: (row) => row.value,
            earlier,
            earlierValue: (row) => row.value,
            span,
            gate: true,
          })
        : series.map((point, index) => ({
            title: input.dayTitle(point.hour),
            value: point.value,
            previous: earlier.at(index)?.value,
            previousPartial: previousDayPartial(index, earlier.length),
          }))
  }

  let activeUsers: TrendPoint[] | undefined
  if (hourly) {
    if (activity?.hourly) {
      activeUsers = hourlyTrend(activity.hourly, end, {
        title: input.hourTitle,
        value: (row) => row.active_users,
        earlier: previousActivity?.hourly,
        earlierValue: (row) => row.active_users,
        span,
        gate,
      })
    }
  } else if (activity) {
    activeUsers = dailyTrend(activity.daily ?? [], {
      title: input.dayTitle,
      value: (row) => row.dau,
      earlier: previousActivity?.daily,
      earlierValue: (row) => row.dau,
      gate,
      partial: (row) => input.qualityDay(row.day),
    })
  }

  return {
    revenue: money(revenueOf),
    consumption: money(chargeOf),
    recognized: hourly
      ? undefined
      : money((row) => row.recognized_revenue ?? 0, false),
    requests: requestSeries((row) => row.requests, true),
    failureRate: requestSeries((row) => row.error_rate ?? 0, false),
    signups,
    activeUsers,
  }
}

const TICKS = 4

/** The smallest round step (1, 2, 2.5 or 5 × 10^n) at least value. */
function niceStep(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value) ?? 10
  return step * magnitude
}

/** An axis from 0: its round top and the ticks up to it. */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  const step = niceStep(max / TICKS)
  const top = max > 0 ? Math.ceil(max / step - 1e-9) * step : 1
  const ticks = Array.from(
    { length: Math.round(top / step) + 1 },
    (_, index) => index * step
  )
  return { top, ticks }
}

