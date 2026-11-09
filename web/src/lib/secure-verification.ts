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
import axios from 'axios'
import i18next from 'i18next'

import {
  getServerErrorMessageKey,
  getServerMessage,
  safeServerErrorMessage,
} from './server-error-message'

// English source keys: callers translate them with `authErrorMessage`.
const SERVICE_BUSY_MESSAGE = 'Please try again later.'
const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many attempts. Please wait a minute and try again.'

export class AuthOperationError extends Error {
  readonly [safeServerErrorMessage] = true
  constructor(
    message: string,
    readonly code?: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AuthOperationError'
  }

  static from(
    error: unknown,
    fallback = 'Verification failed. Please try again.'
  ): AuthOperationError {
    if (error instanceof AuthOperationError) return error
    if (axios.isAxiosError<{ message?: string; code?: string }>(error)) {
      const status = error.response?.status
      const data = error.response?.data
      // A localized server reason (`message_key`) is safe to show as is.
      const hasMessageKey =
        typeof (data as { message_key?: unknown } | undefined)?.message_key ===
        'string'
      return new AuthOperationError(
        getServerErrorMessageKey(error) ||
          (hasMessageKey ? getServerMessage(data) : undefined) ||
          (status !== undefined && status >= 500
            ? SERVICE_BUSY_MESSAGE
            : undefined) ||
          (status === 429 ? TOO_MANY_ATTEMPTS_MESSAGE : undefined) ||
          getServerMessage(data) ||
          // No response at all: offline, timed out or blocked. Axios' own text
          // ("Network Error", "timeout of 0ms exceeded") is not for customers.
          (error.response ? undefined : SERVICE_BUSY_MESSAGE) ||
          fallback,
        data?.code,
        { cause: error }
      )
    }
    return new AuthOperationError(
      error instanceof Error ? error.message : fallback,
      undefined,
      { cause: error }
    )
  }
}

/**
 * The customer-facing text of an auth failure. `AuthOperationError` messages
 * are English source keys or already-localized server reasons; translating
 * again is a no-op for the latter.
 */
export function authErrorMessage(error: unknown, fallback?: string): string {
  return i18next.t(AuthOperationError.from(error, fallback).message)
}

export const authRequestOptions = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

export async function authResult<T>(
  request: Promise<{
    data: { success: boolean; message?: string; code?: string; data?: T }
  }>,
  fallback = 'Verification failed. Please try again.'
): Promise<T> {
  try {
    const { data: response } = await request
    if (!response.success || response.data === undefined) {
      throw new AuthOperationError(
        getServerErrorMessageKey(response) ||
          getServerMessage(response) ||
          fallback,
        response.code
      )
    }
    return response.data
  } catch (error) {
    throw AuthOperationError.from(error, fallback)
  }
}
