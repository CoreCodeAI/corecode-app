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
import { beforeAll, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import ru from '@/i18n/locales/ru.json'

import { CANVAS_KEY_NAME, displayKeyName } from '../canvas-link'

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  i18next.addResourceBundle('ru', 'translation', ru.translation, true, true)
})

test('the canvas key name shows the locale label; the stored name is unchanged', () => {
  const t = i18next.getFixedT('ru')
  expect(CANVAS_KEY_NAME).toBe('创作台')
  expect(displayKeyName(CANVAS_KEY_NAME, t)).toBe('Студия творчества')
  expect(displayKeyName('my key', t)).toBe('my key')
})
