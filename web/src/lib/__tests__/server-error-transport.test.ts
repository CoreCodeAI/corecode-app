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
import { AxiosError, type AxiosResponse } from 'axios'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { getServerErrorMessage } from '../server-error-message'

const TRANSPORT_FAILURE_MESSAGE = 'Please try again later.'

function responseError(status: number, data: unknown): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data, statusText: '', headers: {} } as AxiosResponse
  )
}

describe('transport failures', () => {
  it('asks to try again later when a request gets no response', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK')

    expect(getServerErrorMessage(error)).toBe(TRANSPORT_FAILURE_MESSAGE)
  })

  it('asks to try again later when a request times out', () => {
    const error = new AxiosError('timeout of 0ms exceeded', 'ECONNABORTED')

    expect(getServerErrorMessage(error)).toBe(TRANSPORT_FAILURE_MESSAGE)
  })

  it('asks to try again later for a proxy 502 error page', () => {
    const error = responseError(
      502,
      '<html><body>502 Bad Gateway</body></html>'
    )

    expect(getServerErrorMessage(error)).toBe(TRANSPORT_FAILURE_MESSAGE)
  })

  it('shows the message in the active language', async () => {
    i18next.addResourceBundle('zhCN', 'translation', {
      [TRANSPORT_FAILURE_MESSAGE]: zh.translation[TRANSPORT_FAILURE_MESSAGE],
    })
    await i18next.changeLanguage('zhCN')
    try {
      expect(
        getServerErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'))
      ).toBe('请稍后再试。')
    } finally {
      await i18next.changeLanguage('en')
    }
  })
})

describe('failures that carry a reason', () => {
  it('keeps a 5xx business message as the server wrote it', () => {
    const error = responseError(500, {
      success: false,
      message: 'Payment provider rejected the order',
    })

    expect(getServerErrorMessage(error)).toBe(
      'Payment provider rejected the order'
    )
  })

  it('keeps a 5xx message_key translation', () => {
    const error = responseError(503, {
      success: false,
      message: 'Channel 7 does not exist',
      message_key: 'Channel {{id}} does not exist',
      message_params: { id: 7 },
    })

    expect(getServerErrorMessage(error)).toBe('Channel 7 does not exist')
  })

  it('leaves a 4xx without a body as it was', () => {
    expect(getServerErrorMessage(responseError(404, ''))).toBe(
      'Request failed with status code 404'
    )
  })

  it('leaves a cancelled request as it was', () => {
    const error = new AxiosError('canceled', 'ERR_CANCELED')

    expect(getServerErrorMessage(error)).toBe('canceled')
  })
})
