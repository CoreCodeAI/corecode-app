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

import { addressAccent, addressVendor } from '../address-vendor'

it.each([
  ['Claude 原生 /v1/messages', 'https://corecode.live', 'claude'],
  ['Нативный Claude /v1/messages', 'https://corecode.live', 'claude'],
  ['Messages', 'https://api.example.com/v1/messages', 'claude'],
  ['Codex / OpenAI Responses /v1/responses', 'https://corecode.live/v1', 'openai'],
  ['Chat', 'https://api.example.com/v1/chat/completions', 'openai'],
  ['模型列表 /v1/models', 'https://corecode.live/v1/models', null],
  ['Asia', 'https://asia.example.com/gateway/v1/', null],
])('reads %s at %s as %s', (route, url, vendor) => {
  expect(addressVendor({ route, url })).toBe(vendor)
})

it('colors a vendor by its brand, else by the configured name, else not at all', () => {
  expect(addressAccent('claude', 'teal')).toBe('#D97757')
  expect(addressAccent('openai', undefined)).toBe('#10A37F')
  expect(addressAccent(null, 'teal')).toBe('#14b8a6')
  expect(addressAccent(null, 'light-blue')).toBe('#38bdf8')
  expect(addressAccent(null, 'not-a-color')).toBeUndefined()
  expect(addressAccent(null, '')).toBeUndefined()
})
