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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openPaymentPage } from '../payment'

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test'

function stubLocation() {
  const assign = vi.fn()
  vi.spyOn(window, 'location', 'get').mockReturnValue({
    ...window.location,
    assign,
  })
  return assign
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openPaymentPage', () => {
  it('opens a new tab and stays on this page when the popup opens', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const assign = stubLocation()

    expect(openPaymentPage(CHECKOUT_URL)).toBe('new-tab')
    expect(open).toHaveBeenCalledWith(CHECKOUT_URL, '_blank')
    expect(assign).not.toHaveBeenCalled()
  })

  it('opens the page in this tab when the browser blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = stubLocation()

    expect(openPaymentPage(CHECKOUT_URL)).toBe('same-tab')
    expect(assign).toHaveBeenCalledWith(CHECKOUT_URL)
  })

  it('opens the page in this tab when opening a popup throws', () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('blocked')
    })
    const assign = stubLocation()

    expect(openPaymentPage(CHECKOUT_URL)).toBe('same-tab')
    expect(assign).toHaveBeenCalledWith(CHECKOUT_URL)
  })
})
