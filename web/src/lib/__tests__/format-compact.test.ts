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
import i18next from 'i18next'
import { afterEach, expect, test } from 'vitest'

import { formatCompactNumber } from '../format'

afterEach(async () => {
  await i18next.changeLanguage('en')
})

test('a Russian console writes compact counts without 万', async () => {
  await i18next.changeLanguage('ru')
  const text = formatCompactNumber(42000)
  expect(text).toMatch(/тыс/)
  expect(text).not.toContain('万')
})

test('the Chinese console keeps 万 for compact counts', async () => {
  await i18next.changeLanguage('zhCN')
  expect(formatCompactNumber(42000)).toBe('4.2万')
})

test('an explicit locale still wins over the console language', async () => {
  await i18next.changeLanguage('ru')
  expect(formatCompactNumber(42000, 'en-US')).toBe('42K')
})
