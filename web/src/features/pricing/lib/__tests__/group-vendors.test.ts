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
import { describe, expect, it } from 'vitest'

import type { PricingModel } from '../../types'
import { groupVendor, orderGroups } from '../group-vendors'

function model(
  model_name: string,
  enable_groups: string[],
  vendor?: [string, string]
): PricingModel {
  return {
    id: 0,
    model_name,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups,
    vendor_name: vendor?.[0],
    vendor_icon: vendor?.[1],
  } as PricingModel
}

const anthropic: [string, string] = ['Anthropic', 'Claude.Color']
const google: [string, string] = ['Google', 'Gemini.Color']

describe('groupVendor', () => {
  it('lets aliases into another pool not vote', () => {
    const models = [
      model('gemini-3.8-flash-high', ['Gemini'], google),
      model('gemini-4-argon-high', ['Gemini'], google),
      model('gemini/claude-opus-5-5-high', ['Gemini'], anthropic),
      model('gemini/claude-sonnet-5-5-high', ['Gemini'], anthropic),
      model('gemini/claude-haiku-5-5-high', ['Gemini'], anthropic),
    ]
    expect(groupVendor(models, 'Gemini')?.name).toBe('Google')
  })

  it('infers the vendor from the model name when none is configured', () => {
    const models = [
      model('claude-haiku-5-5', ['CC']),
      model('gpt-6-luna', ['GPT']),
      model('deepseek-flash', ['DeepSeek（官Key）']),
    ]
    expect(groupVendor(models, 'CC')).toEqual({
      name: 'Anthropic',
      icon: 'Claude.Color',
    })
    expect(groupVendor(models, 'GPT')?.name).toBe('OpenAI')
    expect(groupVendor(models, 'DeepSeek（官Key）')).toEqual({
      name: 'DeepSeek',
      icon: 'DeepSeek.Color',
    })
  })
})

describe('orderGroups', () => {
  it('puts Claude groups first even when others are cheaper', () => {
    const vendors = new Map([
      ['GPT', { name: 'OpenAI', icon: 'OpenAI' }],
      ['Grok', { name: 'xAI', icon: 'XAI' }],
      ['CC', { name: 'Anthropic', icon: 'Claude.Color' }],
      ['Open', { name: 'Anthropic', icon: 'Claude.Color' }],
    ])
    const ratios: Record<string, number> = {
      GPT: 0.8,
      Grok: 1.2,
      CC: 1.9,
      Open: 2.05,
    }
    expect(
      orderGroups(['Open', 'Grok', 'GPT', 'CC'], vendors, (g) => ratios[g])
    ).toEqual(['CC', 'Open', 'GPT', 'Grok'])
  })
})
