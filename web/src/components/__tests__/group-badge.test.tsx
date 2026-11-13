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
import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeAll, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import ru from '@/i18n/locales/ru.json'
import zh from '@/i18n/locales/zh.json'

import { GroupBadge } from '../group-badge'

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  i18next.addResourceBundle('ru', 'translation', ru.translation, true, true)
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
})

afterEach(async () => {
  await act(() => i18next.changeLanguage('en'))
})

test('a stored group name shows its translation in another language', async () => {
  await act(() => i18next.changeLanguage('ru'))
  render(<GroupBadge group='Claude 满血（仅限CC）' />)
  expect(
    screen.getByText('Claude Full (только Claude Code)')
  ).toBeInTheDocument()
  expect(screen.queryByText('Claude 满血（仅限CC）')).toBeNull()
})

test('a Chinese interface shows the stored group name as written', async () => {
  await act(() => i18next.changeLanguage('zhCN'))
  render(<GroupBadge group='Claude 满血（仅限CC）' />)
  expect(screen.getByText('Claude 满血（仅限CC）')).toBeInTheDocument()
})

test('a label the caller passes is shown as written', async () => {
  await act(() => i18next.changeLanguage('ru'))
  render(<GroupBadge group='Claude 满血（仅限CC）' label='Custom label' />)
  expect(screen.getByText('Custom label')).toBeInTheDocument()
})
