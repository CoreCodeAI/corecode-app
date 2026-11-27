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
import { groupVendor, orderGroups, vendorSections } from '../group-vendors'

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

describe('orderGroups by vendor', () => {
  // The live board on 2026-11-27, which interleaved GPT with DeepSeek by
  // ratio; the image group is made cheaper here to test the per-call rule.
  const openai = { name: 'OpenAI', icon: 'OpenAI' }
  const vendors = new Map([
    ['CC', { name: 'Anthropic', icon: 'Claude.Color' }],
    ['GPT 福利', openai],
    ['DeepSeek（官Key）', { name: 'DeepSeek', icon: 'DeepSeek.Color' }],
    ['GPT', openai],
    ['GPT（UltraFast）', openai],
    ['Seedance视频', { name: 'ByteDance', icon: 'ByteDance.Color' }],
    ['GPT生图1-4K', openai],
    ['Grok', { name: 'xAI', icon: 'XAI' }],
    ['root', null],
  ])
  const ratios: Record<string, number> = {
    CC: 1.9,
    'GPT 福利': 0.5,
    'DeepSeek（官Key）': 0.6,
    GPT: 0.7,
    'GPT（UltraFast）': 1,
    Seedance视频: 1,
    'GPT生图1-4K': 0.9,
    Grok: 1.2,
    root: 0.1,
  }
  const perCall = new Set(['Seedance视频', 'GPT生图1-4K'])
  const ordered = orderGroups(
    [...vendors.keys()].reverse(),
    vendors,
    (g) => ratios[g],
    (g) => !perCall.has(g)
  )

  // The image group is cheaper than UltraFast yet follows it, priced per call.
  it('keeps each vendor together, cheapest vendor first', () => {
    expect(ordered).toEqual([
      'CC',
      'GPT 福利',
      'GPT',
      'GPT（UltraFast）',
      'GPT生图1-4K',
      'DeepSeek（官Key）',
      'Seedance视频',
      'Grok',
      'root',
    ])
  })

  it('splits the order into one section per vendor', () => {
    expect(
      vendorSections(ordered, vendors).map((section) => [
        section.vendor?.name ?? null,
        section.groups.length,
      ])
    ).toEqual([
      ['Anthropic', 1],
      ['OpenAI', 4],
      ['DeepSeek', 1],
      ['ByteDance', 1],
      ['xAI', 1],
      [null, 1],
    ])
  })
})
