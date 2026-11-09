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
import { expect, it } from 'vitest'

import { MESSAGE_STATUS } from '../../../constants'
import type { Message } from '../../../types'
import {
  getMessageErrorState,
  isInsufficientBalanceError,
} from '../message-error-utils'

function failed(content: string, errorCode?: string | null): Message {
  return {
    key: 'm',
    from: 'assistant',
    status: MESSAGE_STATUS.ERROR,
    errorCode,
    versions: [{ id: 'v', content }],
  }
}

it('recognises the server code for an insufficient wallet', () => {
  const message = failed('whatever the server said', 'insufficient_user_quota')

  expect(isInsufficientBalanceError(message)).toBe(true)
  expect(getMessageErrorState(message, false)?.kind).toBe(
    'insufficient-balance'
  )
})

it('falls back to the wording when the code was lost', () => {
  expect(isInsufficientBalanceError(failed('用户额度不足, 剩余额度: 0'))).toBe(
    true
  )
  expect(
    isInsufficientBalanceError(
      failed('Insufficient user quota, remaining quota: 0')
    )
  ).toBe(true)
})

it('does not read a different code as a balance problem', () => {
  expect(
    isInsufficientBalanceError(
      failed('额度不足', 'pre_consume_token_quota_failed')
    )
  ).toBe(false)
  expect(
    isInsufficientBalanceError(failed('upstream timed out', 'bad_response'))
  ).toBe(false)
})

it('keeps the model price error its own kind', () => {
  expect(
    getMessageErrorState(failed('no price', 'model_price_error'), true)?.kind
  ).toBe('model-price')
})

it('ignores a message that is not an error', () => {
  const message = { ...failed('额度不足'), status: MESSAGE_STATUS.COMPLETE }

  expect(isInsufficientBalanceError(message)).toBe(false)
  expect(getMessageErrorState(message, false)).toBeNull()
})
