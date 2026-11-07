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
import { expect, it } from 'vitest'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import vi from './locales/vi.json'
import zhTW from './locales/zh-TW.json'
import zh from './locales/zh.json'

// A supported language loads without the en fallback, so a key it lacks
// would render as its raw source text. `bun run i18n:sync` fills the gaps.
it('gives every locale a non-empty value for every en key', () => {
  const locales = { fr, ja, ko, ru, vi, zhTW, zh }
  const keys = Object.keys(en.translation)
  for (const [name, locale] of Object.entries(locales)) {
    const translation = locale.translation as Record<string, string>
    const missing = keys.filter((key) => !translation[key])
    expect(missing, name).toEqual([])
  }
})

// `bun run i18n:sync` treats en as the base, so a key only another locale
// has is dropped from it on the next sync. Add the key to en.json first.
it('gives no locale a key en lacks', () => {
  const locales = { fr, ja, ko, ru, vi, zhTW, zh }
  const keys = new Set(Object.keys(en.translation))
  for (const [name, locale] of Object.entries(locales)) {
    const extra = Object.keys(locale.translation).filter(
      (key) => !keys.has(key)
    )
    expect(extra, name).toEqual([])
  }
})
