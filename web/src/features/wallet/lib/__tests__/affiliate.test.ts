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
import { expect, test } from 'vitest'

import { generateAffiliateLink } from '../affiliate'

test('the invitation link carries the code as ref, never aff, so linux.do does not flag it', () => {
  const link = generateAffiliateLink('AB12')
  expect(link).toBe(`${window.location.origin}/sign-in?ref=AB12`)
  expect(link).not.toContain('aff=')
})

test('a code with reserved characters is encoded in the link', () => {
  expect(generateAffiliateLink('a b&c')).toMatch(/\?ref=a%20b%26c$/)
})
