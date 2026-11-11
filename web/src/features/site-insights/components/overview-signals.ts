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
// The overview's service and money signals: the pool's peak against its
// slots, whose refusal each failure was, what customers saw fail, media
// tasks, and checkouts that stopped completing.

import type { TFunction } from 'i18next'

import { getPaymentMethodName } from '@/features/wallet/lib/billing'

import type { Finding } from '../analysis'
import {
  countsRequestsOnce,
  failureTone,
  HEADROOM_SHARE,
  joinSentences,
  MIN_ORDERS,
  MIN_TASKS,
  SMALL_SAMPLE,
} from '../lib'
import type {
  CapacityInsights,
  FinanceInsights,
  NamedCount,
  OrderMethodFunnel,
  QualityInsights,
  TaskOutcome,
} from '../types'
import { FAILING_RATE, type InsightsFormat } from './overview-analysis'

/** A completion rate under this share of the previous period's has fallen. */
export const COMPLETION_DROP_SHARE = 0.5

/** Media models named in a task signal. */
const TASK_MODEL_LIMIT = 3

/** One category's count; 0 when absent. */
export function categoryCount(
  categories: NamedCount[] | null | undefined,
  name: string
): number {
  return categories?.find((item) => item.name === name)?.count ?? 0
}

/**
 * The peak to read against the pool's slots: the pool's own when the server
 * sends it, else none, since the site's peak counts every channel and would
 * call a busy paid upstream a full pool.
 */
export function poolPeakAgainstSlots(
  capacity: CapacityInsights | undefined
): { peak: number; at: number; slots: number; share: number } | undefined {
  const slots = capacity?.pool?.configured ? capacity.pool.effective_slots : 0
  if (!capacity || !slots || capacity.pool_peak == null) return undefined
  return {
    peak: capacity.pool_peak,
    at: capacity.pool_peak_at ?? capacity.peak_at,
    slots,
    share: capacity.pool_peak / slots,
  }
}

/** How a pool peak reads against the slots: full at them, near past HEADROOM_SHARE. */
export function peakTone(share: number): 'danger' | 'warning' | 'default' {
  if (share >= 1) return 'danger'
  if (share >= HEADROOM_SHARE) return 'warning'
  return 'default'
}

/** Finished tasks: the ones a failure rate rests on. */
export function finishedTasks(row: TaskOutcome): number {
  return row.succeeded + row.failed
}

/**
 * Media tasks failing past FAILING_RATE over at least SMALL_SAMPLE finished
 * tasks, with the models failing past it over at least MIN_TASKS, most
 * failures first.
 */
export function failingTasks(
  quality: QualityInsights | undefined
): { total: TaskOutcome; models: TaskOutcome[] } | undefined {
  const total = quality?.tasks?.total
  if (
    !total ||
    finishedTasks(total) < SMALL_SAMPLE ||
    total.failure_rate <= FAILING_RATE
  ) {
    return undefined
  }
  const models = (quality?.tasks?.models ?? [])
    .filter(
      (row) =>
        finishedTasks(row) >= MIN_TASKS && row.failure_rate > FAILING_RATE
    )
    .sort((a, b) => b.failed - a.failed)
  return { total, models }
}

/**
 * Checkouts opened in the range and how many were paid. Those still pending
 * and opened within the hour may yet be paid, so they are left out of the
 * rate; rate is undefined when none is settled.
 */
export function checkoutCompletion(
  methods: OrderMethodFunnel[] | null | undefined
): { created: number; paid: number; settled: number; rate?: number } {
  let created = 0
  let paid = 0
  let open = 0
  for (const row of methods ?? []) {
    created += row.created
    paid += row.paid
    open += Math.max(row.pending - row.pending_stale, 0)
  }
  const settled = created - open
  return {
    created,
    paid,
    settled,
    rate: settled > 0 ? paid / settled : undefined,
  }
}

/**
 * The checkout completion rate when it fell under COMPLETION_DROP_SHARE of
 * the previous period's, both periods with at least MIN_ORDERS opened.
 * created is the settled checkouts the rate rests on.
 */
export function completionDrop(
  current: FinanceInsights | undefined,
  previous: FinanceInsights | undefined
):
  | { rate: number; previous: number; paid: number; created: number }
  | undefined {
  if (!current?.order_methods || !previous?.order_methods) return undefined
  const now = checkoutCompletion(current.order_methods)
  const before = checkoutCompletion(previous.order_methods)
  if (
    now.created < MIN_ORDERS ||
    before.created < MIN_ORDERS ||
    now.rate === undefined ||
    before.rate === undefined ||
    now.rate >= before.rate * COMPLETION_DROP_SHARE
  ) {
    return undefined
  }
  return {
    rate: now.rate,
    previous: before.rate,
    paid: now.paid,
    created: now.settled,
  }
}

/**
 * Signals on what customers met: the pool's peak against its slots, the
 * engine's and the upstreams' refusals, requests no channel serves, what
 * failed, media tasks, and checkouts. Each rests on the threshold its tab
 * colors by.
 */
export function overviewServiceSignals(
  t: TFunction,
  fmt: InsightsFormat,
  props: {
    capacity: CapacityInsights | undefined
    quality: QualityInsights | undefined
    finance: FinanceInsights | undefined
    previousFinance: FinanceInsights | undefined
  }
): Finding[] {
  const signals: Finding[] = []
  const capacity = props.capacity
  const quality = props.quality

  const peak = poolPeakAgainstSlots(capacity)
  const tone = peak ? peakTone(peak.share) : 'default'
  if (peak && tone !== 'default') {
    signals.push({
      key: 'capacity-peak',
      tone,
      title:
        tone === 'danger'
          ? t('The pool’s peak {{peak}} reached its {{slots}} slots', {
              peak: fmt.num(peak.peak),
              slots: fmt.num(peak.slots),
            })
          : t(
              'The pool’s peak {{peak}} used {{share}} of its {{slots}} slots',
              {
                peak: fmt.num(peak.peak),
                share: fmt.pct(peak.share),
                slots: fmt.num(peak.slots),
              }
            ),
      detail: t('At {{time}}, against the slots the pool has now.', {
        time: fmt.time(peak.at),
      }),
      tab: 'capacity',
      impact: peak.peak,
    })
  }

  if (capacity) {
    const categories = capacity.error_categories
    const full = categoryCount(categories, 'engine_concurrency')
    if (full > 0) {
      signals.push({
        key: 'capacity-engine',
        tone: 'danger',
        title: t('The pool was full {{count}} times', { count: full }),
        detail: t('Requests the engine turned away with 429'),
        tab: 'capacity',
        impact: full,
      })
    }
    const capped = categoryCount(categories, 'engine_limit')
    if (capped > 0) {
      signals.push({
        key: 'capacity-engine-limit',
        tone: 'warning',
        title: t('The engine’s caps turned away {{count}} requests', {
          count: fmt.num(capped),
        }),
        detail: t(
          'A group, global or key concurrency cap, or the access key’s rate limit, was reached: raise it in the engine.'
        ),
        tab: 'capacity',
        impact: capped,
      })
    }
    const budget = categoryCount(categories, 'engine_budget')
    if (budget > 0) {
      signals.push({
        key: 'capacity-engine-budget',
        tone: 'warning',
        title: t(
          '{{count}} requests found no pool account with rate or budget left',
          { count: fmt.num(budget) }
        ),
        detail: t(
          'Accounts ran out of request rate or quota budget, or waited for a fresh quota reading: add accounts or wait for the reset.'
        ),
        tab: 'capacity',
        impact: budget,
      })
    }
    const auth = categoryCount(categories, 'upstream_auth')
    if (auth > 0) {
      signals.push({
        key: 'upstream-auth',
        tone: 'warning',
        title: t('Upstreams refused our key {{count}} times', {
          count: fmt.num(auth),
        }),
        detail: t(
          'A 401, 402 or 403 from the upstream: check the channel’s key, balance or plan.'
        ),
        tab: 'upstream',
        impact: auth,
      })
    }
  }

  if (quality) {
    const noChannel =
      quality.refusals?.no_channel ??
      categoryCount(quality.error_categories, 'no_channel')
    if (noChannel > 0) {
      signals.push({
        key: 'quality-no-channel',
        tone: 'warning',
        title: t('{{count}} requests found no channel for their model', {
          count: fmt.num(noChannel),
        }),
        detail: t(
          'A group offers a model no enabled channel serves: add it to a channel or take it off the group.'
        ),
        tab: 'quality',
        impact: noChannel,
      })
    }

    const rateTone =
      quality.requests >= SMALL_SAMPLE
        ? failureTone(quality.error_rate)
        : 'default'
    if (rateTone === 'danger' || rateTone === 'warning') {
      const once = countsRequestsOnce(quality)
      signals.push({
        key: 'quality-rate',
        tone: rateTone,
        title: once
          ? t('{{rate}} of requests failed', {
              rate: fmt.pct(quality.error_rate),
            })
          : t('{{rate}} of attempts failed', {
              rate: fmt.pct(quality.error_rate),
            }),
        detail: joinSentences(
          once
            ? t('{{count}} requests failed.', {
                count: fmt.num(quality.errors),
              })
            : t('{{count}} attempts failed.', {
                count: fmt.num(quality.errors),
              }),
          once && attemptsSentence(t, fmt, capacity)
        ),
        tab: 'quality',
        impact: quality.errors,
      })
    }

    const tasks = failingTasks(quality)
    if (tasks) {
      signals.push({
        key: 'quality-tasks',
        tone: 'warning',
        title: t('{{rate}} of image and video tasks failed', {
          rate: fmt.pct(tasks.total.failure_rate),
        }),
        detail: joinSentences(
          t('{{count}} of {{finished}} finished tasks failed.', {
            count: fmt.num(tasks.total.failed),
            finished: fmt.num(finishedTasks(tasks.total)),
          }),
          tasks.models
            .slice(0, TASK_MODEL_LIMIT)
            .map((row) => `${row.model ?? '-'} ${fmt.pct(row.failure_rate)}`)
            .join(', ')
        ),
        tab: 'quality',
        impact: tasks.total.failed,
      })
    }
  }

  const drop = completionDrop(props.finance, props.previousFinance)
  if (drop) {
    const worst = (props.finance?.order_methods ?? [])
      .filter((row) => row.created >= MIN_ORDERS)
      .sort((a, b) => a.completion_rate - b.completion_rate)[0]
    signals.push({
      key: 'finance-checkouts',
      tone: 'warning',
      title: t('Checkouts completed {{rate}}, against {{previous}} before', {
        rate: fmt.pct(drop.rate),
        previous: fmt.pct(drop.previous),
      }),
      detail: joinSentences(
        t(
          '{{paid}} of {{created}} checkouts paid, those opened within the hour left out.',
          { paid: fmt.num(drop.paid), created: fmt.num(drop.created) }
        ),
        worst &&
          t('Lowest: {{method}}, {{rate}}.', {
            method: getPaymentMethodName(worst.payment_method, t),
            rate: fmt.pct(worst.completion_rate),
          })
      ),
      tab: 'finance',
      impact: drop.created - drop.paid,
    })
  }

  return signals
}

/**
 * Customers' attempts beside what they saw, when the server counts both and
 * they differ; undefined otherwise.
 */
export function attemptsSentence(
  t: TFunction,
  fmt: InsightsFormat,
  capacity: CapacityInsights | undefined
): string | undefined {
  if (
    !capacity ||
    capacity.attempts == null ||
    capacity.attempt_errors == null ||
    capacity.attempts === capacity.requests
  ) {
    return undefined
  }
  return t('Customers’ attempts: {{failed}} of {{attempts}} failed.', {
    failed: fmt.num(capacity.attempt_errors),
    attempts: fmt.num(capacity.attempts),
  })
}
