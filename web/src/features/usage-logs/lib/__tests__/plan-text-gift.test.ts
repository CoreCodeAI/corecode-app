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

import { planTextReader } from '@/features/subscriptions/lib/plan-text'
import en from '@/i18n/locales/en.json'
import ru from '@/i18n/locales/ru.json'
import zh from '@/i18n/locales/zh.json'

import { parseLogOther, renderLogContent } from '../format'

const i18n = i18next.createInstance()

beforeAll(async () => {
  await i18n.init({
    lng: 'ru',
    fallbackLng: 'en',
    resources: { en, ru, zhCN: zh },
  })
})

test('a gift message reads the plan title in the reader language', () => {
  const other = parseLogOther(
    JSON.stringify({
      content_parts: [
        {
          key: 'You gave {{user}} the plan {{plan}}',
          params: { user: 'oidc_3457', plan: '渠道体验包' },
        },
      ],
    })
  )
  expect(
    renderLogContent(
      other,
      i18n.getFixedT('ru'),
      planTextReader(i18n.getFixedT('ru'))
    )
  ).toBe('Вы подарили oidc_3457 тариф Пробный пакет по приглашению партнёра')
})

test('a Chinese reader keeps the stored plan title', () => {
  const other = parseLogOther(
    JSON.stringify({
      content_parts: [
        {
          key: 'You gave {{user}} the plan {{plan}}',
          params: { user: 'oidc_3457', plan: '渠道体验包' },
        },
      ],
    })
  )
  expect(
    renderLogContent(
      other,
      i18n.getFixedT('zhCN'),
      planTextReader(i18n.getFixedT('zhCN'))
    )
  ).toBe('你赠送了 oidc_3457 套餐 渠道体验包')
})
