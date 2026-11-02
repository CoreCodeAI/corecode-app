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
import { describe, expect, test } from 'vitest'

import {
  localeParts,
  splitLocale,
} from '../../scripts/i18n-locale-split-loader.mjs'
import zh from './locales/zh.json'

const parts = localeParts(zh.translation)

describe('the locale split for the boot and core pages', () => {
  test('puts every key in exactly one part', () => {
    const split = (['boot', 'core', 'rest'] as const).map(
      (part) => splitLocale(zh, part, parts).translation
    )
    expect(Object.assign({}, ...split)).toEqual(zh.translation)
    expect(split.reduce((n, part) => n + Object.keys(part).length, 0)).toBe(
      Object.keys(zh.translation).length
    )
    for (const part of split) {
      expect(Object.keys(part).length).toBeGreaterThan(0)
    }
  })

  test('boot keeps the keys the sign-in page names, through aliases', () => {
    // The sign-in form (routes/(auth)/sign-in.tsx -> @/features/auth/sign-in).
    expect(parts.get('Sign-in code sent, please check your inbox')).toBe('boot')
  })

  test('core keeps the keys the overview and keys pages name, through lazy imports', () => {
    // The key drawer the keys page mounts.
    expect(parts.get('Successfully created {{count}} API Key(s)')).toBe('core')
    // A chart the dashboard loads with lazy(() => import(...)).
    expect(parts.get('Show cache hit rate for')).toBe('core')
  })

  test('leaves keys only other pages name in rest', () => {
    // The channels page's high-risk retry dialog.
    expect(parts.get('I confirm enabling high-risk retry')).toBe('rest')
  })

  test('reads keys after and inside template literals with substitutions', () => {
    // The pool tab names this after several `${...}` templates; their closing
    // backticks once opened matches that swallowed it, so it went to core.
    expect(parts.get('Peak throughput')).toBe('rest')
    // The error page names this inside one: `${t('...')} ...`.
    expect(parts.get('Oops! Something went wrong')).toBe('boot')
  })

  test('puts keys no console source names, which the server may send, in core', () => {
    const unnamed = 'A message only the server sends'
    const signIn = 'Sign-in code sent, please check your inbox'
    const split = localeParts({ [unnamed]: '仅服务端', [signIn]: '已发送' })
    expect(split.get(unnamed)).toBe('core')
    expect(split.get(signIn)).toBe('boot')
  })
})
