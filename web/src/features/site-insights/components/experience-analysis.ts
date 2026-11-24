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
import type { InsightsRangeInfo } from '../lib'
import type {
  ExperienceFeedback,
  ExperienceInsights,
  ExperiencePoint,
  ExperienceWaste,
  WasteKind,
} from '../types'

/** The kinds of waste in the order the chart stacks them, bottom first. */
export const WASTE_KINDS: WasteKind[] = [
  'refusal',
  'failed_billed',
  'gate_wallet',
]

/** A range's waste share from this much is worth a look, and from the second figure it needs action. */
export const WASTE_SHARE_WARN = 0.01
export const WASTE_SHARE_ALERT = 0.05
/** Reports unanswered for a day: one is a look, this many is a backlog. */
export const UNANSWERED_ALERT = 5

/** The dot color of each kind, as the chart's segments carry it. */
export const KIND_DOTS: Record<WasteKind, string> = {
  refusal: 'bg-primary',
  failed_billed: 'bg-sky-500',
  gate_wallet: 'bg-amber-500',
}

const HOUR = 3600

/** One kind's money; zero when the kind is absent from the list. */
export function kindUsd(waste: ExperienceWaste, kind: WasteKind): number {
  return waste.kinds.find((item) => item.kind === kind)?.usd ?? 0
}

/** One kind's request count. */
export function kindRequests(waste: ExperienceWaste, kind: WasteKind): number {
  return waste.kinds.find((item) => item.kind === kind)?.requests ?? 0
}

/** A point's wasted money, the kinds summed. */
export function pointWaste(point: ExperiencePoint): number {
  return point.refusal_usd + point.failed_usd + point.gate_usd
}

/** A point's reports, the four categories summed. */
export function pointReports(point: ExperiencePoint): number {
  return point.bug + point.suggestion + point.billing + point.other_feedback
}

/** The share of what customers consumed that was wasted, or null with nothing consumed. */
export function wasteShare(waste: ExperienceWaste): number | null {
  return waste.consumed_usd > 0 ? waste.total_usd / waste.consumed_usd : null
}

/**
 * The part of the range the waste figures do not cover: the logs the view
 * reads reach back a fixed number of days, so a longer range starts later
 * than it asked. Null when the whole range was read.
 */
export function unreadFrom(
  waste: ExperienceWaste,
  range: Pick<InsightsRangeInfo, 'start'> | undefined
): number | null {
  if (!range || waste.log_start <= range.start + HOUR) return null
  return waste.log_start
}

/** Where the one-hour cache starts reading, when later than the other kinds. */
export function cacheUnreadBefore(waste: ExperienceWaste): number | null {
  return waste.cache_start > waste.log_start + HOUR ? waste.cache_start : null
}

/** A point of the series that lies wholly before the logs the waste kinds read. */
export function beforeWasteLogs(
  at: number,
  unit: number,
  waste: ExperienceWaste
): boolean {
  return waste.log_start > 0 && at + unit <= waste.log_start
}

/**
 * Whether the waste of the range and of the one before are read over the
 * same span: a change between them says something only then. A range longer
 * than the view reads is never comparable, nor is a previous one that ended
 * up partly unread.
 */
export function wasteComparable(
  data: ExperienceInsights,
  previous: ExperienceInsights | undefined,
  range: Pick<InsightsRangeInfo, 'start' | 'days'> | undefined
): boolean {
  if (!previous || !range) return false
  if (unreadFrom(data.waste, range) != null) return false
  const span = range.days * 86400
  return previous.waste.log_start <= range.start - span + HOUR
}

/** Whether the first-reply times of two periods can be compared: both have replies. */
export function replyComparable(
  feedback: ExperienceFeedback,
  previous: ExperienceFeedback | undefined
): boolean {
  return !!previous && feedback.replied > 0 && previous.replied > 0
}

/**
 * The customers among the checked wasteful ones who never filed a report:
 * the people nobody has heard from.
 */
export function unheard(waste: ExperienceWaste): number {
  return Math.max(0, waste.checked_top - waste.reported_top)
}

/** The share of senders whose week is over that sent a request in it, or null with none judged. */
export function stayedShare(feedback: ExperienceFeedback): number | null {
  return feedback.judged > 0 ? feedback.active / feedback.judged : null
}

/**
 * How the one-hour cache came out for customers: ahead when its reads saved
 * more than its writes cost over five-minute ones. Null with nothing priced.
 */
export function cacheVerdict(
  cache: ExperienceWaste['cache']
): 'ahead' | 'behind' | null {
  if (cache.writes === 0 && cache.reads === 0) return null
  return cache.net_usd >= 0 ? 'ahead' : 'behind'
}
