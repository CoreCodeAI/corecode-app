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
import { MESSAGE_STATUS } from '../../constants'
import type { Message } from '../../types'
import { getMessageContent } from './message-utils'

export const MODEL_PRICING_SETTINGS_PATH =
  '/system-settings/billing/model-pricing'

const MODEL_PRICE_ERROR_CODE = 'model_price_error'
// The wallet and any subscription cannot cover the request
// (billing_session.go). The gateway answers HTTP 402 with the code
// insufficient_quota; the console that predates it knew ErrorCodeInsufficientUserQuota
// in relaykit/types/error.go, which an older server still sends.
const INSUFFICIENT_QUOTA_ERROR_CODES = new Set([
  'insufficient_quota',
  'insufficient_user_quota',
])
// An error that lost its code on the way, such as a non-JSON stream event,
// still carries the server's wording, in Chinese or English.
const INSUFFICIENT_QUOTA_TEXT = /额度不足|insufficient (user )?quota/i
// relaykit/types/error.go: the gateway refused a model this key can never
// reach. Its text already says what to change, in the request's language.
const MODEL_NOT_IN_GROUP_ERROR_CODE = 'model_not_in_group'
const MODEL_WRONG_ENDPOINT_ERROR_CODE = 'model_wrong_endpoint'
export const FALLBACK_ERROR_CONTENT = 'An unknown error occurred'

type MessageErrorState = {
  content: string
  kind:
    | 'generic'
    | 'model-price'
    | 'insufficient-balance'
    | 'model-not-in-group'
    | 'model-wrong-endpoint'
  showSettingsLink: boolean
}

export function isAdminRole(role?: number | null): boolean {
  return role != null && role >= 10
}

export function isErrorMessage(message: Message): boolean {
  return message.status === MESSAGE_STATUS.ERROR
}

export function isInsufficientBalanceError(message: Message): boolean {
  if (!isErrorMessage(message)) return false
  if (message.errorCode) {
    return INSUFFICIENT_QUOTA_ERROR_CODES.has(message.errorCode)
  }
  return INSUFFICIENT_QUOTA_TEXT.test(getMessageContent(message))
}

function getErrorKind(message: Message): MessageErrorState['kind'] {
  if (message.errorCode === MODEL_PRICE_ERROR_CODE) return 'model-price'
  if (message.errorCode === MODEL_NOT_IN_GROUP_ERROR_CODE) {
    return 'model-not-in-group'
  }
  if (message.errorCode === MODEL_WRONG_ENDPOINT_ERROR_CODE) {
    return 'model-wrong-endpoint'
  }
  if (isInsufficientBalanceError(message)) return 'insufficient-balance'
  return 'generic'
}

export function getMessageErrorState(
  message: Message,
  isAdmin: boolean
): MessageErrorState | null {
  if (!isErrorMessage(message)) {
    return null
  }

  const content = getMessageContent(message) || FALLBACK_ERROR_CONTENT
  const isModelPriceError = message.errorCode === MODEL_PRICE_ERROR_CODE

  return {
    content,
    kind: getErrorKind(message),
    showSettingsLink: isModelPriceError && isAdmin,
  }
}
