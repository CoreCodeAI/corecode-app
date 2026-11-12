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
import type { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'

import { apiKeySchema, type ApiKey } from '../../types'
import {
  getApiKeyFormDefaultValues,
  getApiKeyFormSchema,
  transformApiKeyToFormDefaults,
  transformFormDataToPayload,
} from '../api-key-form'

const t = ((key: string, options?: Record<string, unknown>) => {
  if (options?.max !== undefined) {
    return key.replace('{{max}}', String(options.max))
  }
  return key
}) as TFunction

const baseApiKey: ApiKey = {
  id: 1,
  name: 'test',
  key: 'sk-test',
  status: 1,
  remain_quota: 0,
  used_quota: 0,
  unlimited_quota: true,
  expired_time: -1,
  created_time: 1,
  accessed_time: 0,
  group: 'auto',
  auto_groups: null,
  cross_group_retry: true,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
  allow_user_quota_query: false,
}

describe('API key Auto group form mapping', () => {
  test('treats legacy token responses without auto_groups as inheritance', () => {
    const legacyApiKey: Record<string, unknown> = { ...baseApiKey }
    delete legacyApiKey.auto_groups

    expect(apiKeySchema.parse(legacyApiKey).auto_groups).toBe(null)
  })

  test('creates an Auto token that inherits the global order', () => {
    const defaults = getApiKeyFormDefaultValues(true)

    expect(defaults.group).toBe('auto')
    expect(defaults.auto_groups_mode).toBe('inherit')
    expect(defaults.auto_groups).toEqual([])
    expect(transformFormDataToPayload(defaults).auto_groups).toEqual([])
  })

  test('maps omitted, null, and empty snapshots to inheritance on edit', () => {
    const legacyApiKey: Record<string, unknown> = { ...baseApiKey }
    delete legacyApiKey.auto_groups
    const inheritedApiKeys = [
      apiKeySchema.parse(legacyApiKey),
      baseApiKey,
      { ...baseApiKey, auto_groups: [] },
    ]

    for (const apiKey of inheritedApiKeys) {
      const defaults = transformApiKeyToFormDefaults(
        apiKey,
        ['default', 'vip'],
        2
      )

      expect(defaults.auto_groups_mode).toBe('inherit')
      expect(defaults.auto_groups).toEqual([])
    }
  })

  test('filters a stored snapshot before applying a lowered limit', () => {
    const defaults = transformApiKeyToFormDefaults(
      {
        ...baseApiKey,
        auto_groups: ['revoked', 'vip', 'default'],
      },
      ['default', 'vip'],
      2
    )

    expect(defaults.auto_groups_mode).toBe('custom')
    expect(defaults.auto_groups).toEqual(['vip', 'default'])
  })

  test('keeps a fully filtered snapshot custom and rejects it until resolved', () => {
    const defaults = transformApiKeyToFormDefaults(
      { ...baseApiKey, auto_groups: ['revoked'] },
      ['default'],
      2
    )

    expect(defaults.auto_groups_mode).toBe('custom')
    expect(defaults.auto_groups).toEqual([])

    const result = getApiKeyFormSchema(t, 2).safeParse(defaults)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path).toEqual(['auto_groups'])
    expect(result.error.issues[0]?.message).toBe(
      'Select at least one Auto group or restore global Auto.'
    )
  })

  test('submits a valid custom snapshot in its configured order', () => {
    const custom = {
      ...getApiKeyFormDefaultValues(true),
      auto_groups_mode: 'custom' as const,
      auto_groups: ['vip', 'default'],
    }

    expect(transformFormDataToPayload(custom).auto_groups).toEqual([
      'vip',
      'default',
    ])
  })

  test('submits an empty array for inheritance and for non-Auto groups', () => {
    const inherited = getApiKeyFormDefaultValues(true)
    expect(transformFormDataToPayload(inherited).auto_groups).toEqual([])

    const nonAuto = {
      ...inherited,
      group: 'default',
      auto_groups_mode: 'custom' as const,
      auto_groups: ['vip'],
    }
    expect(transformFormDataToPayload(nonAuto).auto_groups).toEqual([])
    expect(transformFormDataToPayload(nonAuto).cross_group_retry).toBe(false)
  })

  test('rejects snapshots over the configured limit', () => {
    const result = getApiKeyFormSchema(t, 1).safeParse({
      ...getApiKeyFormDefaultValues(true),
      name: 'limited token',
      auto_groups_mode: 'custom',
      auto_groups: ['default', 'vip'],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.path[0]).toBe('auto_groups')
    expect(result.error.issues[0]?.message).toBe('Select at most 1 Auto groups')
  })

  test('rejects duplicate custom groups', () => {
    const result = getApiKeyFormSchema(t).safeParse({
      ...getApiKeyFormDefaultValues(true),
      name: 'duplicate token',
      auto_groups_mode: 'custom',
      auto_groups: ['vip', 'vip'],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]?.message).toBe(
      'Auto groups must not contain duplicates'
    )
  })
})

describe('API key user quota query form mapping', () => {
  test('lets a new key query the user quota by default', () => {
    for (const defaultUseAutoGroup of [true, false]) {
      const defaults = getApiKeyFormDefaultValues(defaultUseAutoGroup)

      expect(defaults.allow_user_quota_query).toBe(true)
      expect(transformFormDataToPayload(defaults).allow_user_quota_query).toBe(
        true
      )
    }
  })

  test.each([true, false])(
    'keeps the stored value %s when an existing key is edited and saved',
    (stored) => {
      const defaults = transformApiKeyToFormDefaults({
        ...baseApiKey,
        allow_user_quota_query: stored,
      })

      expect(defaults.allow_user_quota_query).toBe(stored)
      expect(transformFormDataToPayload(defaults).allow_user_quota_query).toBe(
        stored
      )
    }
  )
})

describe('API key daily quota form mapping', () => {
  const values = getApiKeyFormDefaultValues(false)

  test('sends a limited key its daily cap in quota units', () => {
    const payload = transformFormDataToPayload({
      ...values,
      unlimited_quota: false,
      remain_quota_dollars: 100,
      daily_quota_dollars: 2,
    })
    expect(payload.daily_quota).toBe(1_000_000)
  })

  test.each([
    ['zero', { unlimited_quota: false, daily_quota_dollars: 0 }],
    ['negative', { unlimited_quota: false, daily_quota_dollars: -3 }],
    ['empty', { unlimited_quota: false, daily_quota_dollars: undefined }],
    ['the Unlimited switch', { unlimited_quota: true, daily_quota_dollars: 2 }],
  ])('sends no daily cap for a %s value', (_label, change) => {
    expect(
      transformFormDataToPayload({ ...values, ...change }).daily_quota
    ).toBe(0)
  })

  test('sends a daily cap with no total as unlimited plus the cap', () => {
    const payload = transformFormDataToPayload({
      ...values,
      unlimited_quota: false,
      remain_quota_dollars: 0,
      daily_quota_dollars: 2,
    })
    expect(payload).toMatchObject({
      unlimited_quota: true,
      remain_quota: 0,
      daily_quota: 1_000_000,
    })
  })

  test('keeps a total and a daily cap together as a limited key', () => {
    const payload = transformFormDataToPayload({
      ...values,
      unlimited_quota: false,
      remain_quota_dollars: 100,
      daily_quota_dollars: 2,
    })
    expect(payload.unlimited_quota).toBe(false)
    expect(payload.remain_quota).toBeGreaterThan(0)
  })

  test('shows a stored cap, and none for keys without one', () => {
    const limited = { ...baseApiKey, unlimited_quota: false }
    expect(
      transformApiKeyToFormDefaults({ ...limited, daily_quota: 1_000_000 })
        .daily_quota_dollars
    ).toBe(2)
    expect(transformApiKeyToFormDefaults(limited).daily_quota_dollars).toBe(0)
  })

  test('shows an unlimited key with a cap as a zero total, not the switch', () => {
    const form = transformApiKeyToFormDefaults({
      ...baseApiKey,
      unlimited_quota: true,
      daily_quota: 1_000_000,
    })
    expect(form.unlimited_quota).toBe(false)
    expect(form.remain_quota_dollars).toBe(0)
    expect(form.daily_quota_dollars).toBe(2)
    expect(
      transformApiKeyToFormDefaults({ ...baseApiKey, unlimited_quota: true })
        .unlimited_quota
    ).toBe(true)
  })

  test('saves an unlimited key with a cap back unchanged', () => {
    const stored = {
      ...baseApiKey,
      unlimited_quota: true,
      daily_quota: 1_000_000,
    }
    const payload = transformFormDataToPayload(
      transformApiKeyToFormDefaults(stored)
    )
    expect(payload).toMatchObject({
      unlimited_quota: true,
      remain_quota: 0,
      daily_quota: 1_000_000,
    })
  })

  describe('validation', () => {
    const schema = getApiKeyFormSchema(t)
    const issues = (change: Record<string, unknown>) => {
      const result = schema.safeParse({
        ...values,
        name: 'k',
        unlimited_quota: false,
        ...change,
      })
      return result.success ? [] : result.error.issues.map((i) => i.message)
    }

    test('rejects a key with neither a total nor a daily limit', () => {
      const message =
        'Set a total quota or a daily quota, or turn on Unlimited Quota.'
      expect(
        issues({ remain_quota_dollars: 0, daily_quota_dollars: 0 })
      ).toContain(message)
      expect(
        issues({ remain_quota_dollars: 0, daily_quota_dollars: undefined })
      ).toContain(message)
      expect(
        issues({ remain_quota_dollars: 0, daily_quota_dollars: -1 })
      ).toContain(message)
    })

    test('accepts a total only, a daily cap only, or both', () => {
      expect(
        issues({ remain_quota_dollars: 10, daily_quota_dollars: 0 })
      ).toEqual([])
      expect(
        issues({ remain_quota_dollars: 0, daily_quota_dollars: 5 })
      ).toEqual([])
      expect(
        issues({ remain_quota_dollars: 10, daily_quota_dollars: 5 })
      ).toEqual([])
    })

    test('accepts the Unlimited switch with both fields empty', () => {
      expect(
        issues({
          unlimited_quota: true,
          remain_quota_dollars: 0,
          daily_quota_dollars: 0,
        })
      ).toEqual([])
    })
  })
})
