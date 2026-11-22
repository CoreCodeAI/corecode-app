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
/**
 * CoreCode fork: the words for the newcomer plan limit, one place for the
 * usage log, the banner and the plan card. The server's refusal message
 * (i18n/locales, quota.limited_plan_gate) says the same.
 */
import type { TFunction } from 'i18next'

import type { PlanGateKind } from '../types'

export function planGateLabel(t: TFunction, kind: PlanGateKind): string {
  if (kind === 'wallet') return t('Newcomer plan paused · charged to balance')
  if (kind === 'refused') return t('Newcomer plan paused · request refused')
  return t('Newcomer plan paused · charged to another plan')
}

export function planGateExplanation(t: TFunction, kind: PlanGateKind): string {
  if (kind === 'wallet') {
    return t(
      'We detected that your network exit is shared with several newcomer plan accounts. To prevent abuse, the newcomer plan is paused and this request was charged to your balance. If you are a normal user, contact us in Feedback to restore it.'
    )
  }
  if (kind === 'refused') {
    return t(
      'We detected that your network exit is shared with several newcomer plan accounts. To prevent abuse, the newcomer plan is paused, and your balance could not pay for this request, so it was refused. If you are a normal user, contact us in Feedback to restore it.'
    )
  }
  return t(
    'We detected that your network exit is shared with several newcomer plan accounts. To prevent abuse, the newcomer plan is paused and this request was charged to your other plan. If you are a normal user, contact us in Feedback to restore it.'
  )
}

/** The Billing row of a log's detail: where the gated request was charged. */
export function planGateBilling(t: TFunction, kind: PlanGateKind): string {
  if (kind === 'wallet') {
    return t('Billed to balance (newcomer plan network limit)')
  }
  if (kind === 'refused') return t('Refused (newcomer plan network limit)')
  return t('Billed to another plan (newcomer plan network limit)')
}
