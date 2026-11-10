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
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { BrandWordmark } from '../brand-wordmark'

test('a name of two capitalised words shows the second in the accent colour, as the site header does', () => {
  render(<BrandWordmark name='CoreCode' />)
  const wordmark = screen.getByTitle('CoreCode')
  expect(wordmark).toHaveTextContent(/^CoreCode$/)
  expect(screen.getByText('Code')).toHaveClass('text-primary')
  expect(wordmark).not.toHaveClass('text-primary')
})

test('any other name is shown whole, without an accent', () => {
  for (const name of ['Relay', 'new-api', 'Core Code Live', 'CORECODE']) {
    const view = render(<BrandWordmark name={name} />)
    const wordmark = screen.getByTitle(name)
    expect(wordmark).toHaveTextContent(name)
    expect(wordmark.querySelector('.text-primary')).toBeNull()
    view.unmount()
  }
})
