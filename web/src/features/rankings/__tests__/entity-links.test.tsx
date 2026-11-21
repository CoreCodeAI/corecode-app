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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ModelLink, VendorLink } from '../components/entity-links'

afterEach(cleanup)

// /pricing/ is a static page behind the proxy, not a console route: these are
// plain links so the browser loads it.
describe('rankings entity links', () => {
  it('link a model to /pricing/<model>, which the proxy sends to its page', () => {
    render(<ModelLink modelName='claude-opus-5-5' />)
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/pricing/claude-opus-5-5'
    )
  })

  it('escape a model name that is not path safe', () => {
    render(<ModelLink modelName='a b/c' />)
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/pricing/a%20b%2Fc'
    )
  })

  it('link a vendor to the static price list', () => {
    render(<VendorLink vendor='Anthropic' />)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing/')
  })
})
