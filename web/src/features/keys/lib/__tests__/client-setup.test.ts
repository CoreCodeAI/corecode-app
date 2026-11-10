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
  buildCCSwitchURL,
  buildClientSetupSnippet,
  buildMagpieImportURL,
  buildVerifyCommand,
  CC_SWITCH_USAGE_INTERVAL_MINUTES,
  DEFAULT_CLAUDE_MODELS,
  getAnthropicBaseUrl,
  getMagpieProviderId,
  getSetupClients,
  getSetupTitle,
  maskApiKey,
  pickClaudeModels,
  pickOpenAIModel,
} from '../client-setup'

const args = {
  baseUrl: 'https://corecode.live',
  apiKey: 'sk-full-secret-key',
  providerName: 'CoreCode',
  models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
}

describe('getAnthropicBaseUrl', () => {
  test.each([
    ['https://corecode.live', 'https://corecode.live'],
    ['https://corecode.live/', 'https://corecode.live'],
    ['https://corecode.live/v1', 'https://corecode.live'],
    ['https://corecode.live/v1/', 'https://corecode.live'],
    ['  https://corecode.live  ', 'https://corecode.live'],
  ])(
    'reduces %j to the root address Claude Code expects',
    (input, expected) => {
      expect(getAnthropicBaseUrl(input, 'https://origin.test')).toBe(expected)
    }
  )

  test('falls back to the page origin when no server address is set', () => {
    expect(getAnthropicBaseUrl('', 'https://origin.test')).toBe(
      'https://origin.test'
    )
    expect(getAnthropicBaseUrl(undefined, 'https://origin.test/')).toBe(
      'https://origin.test'
    )
  })
})

describe('buildClientSetupSnippet', () => {
  test('settings.json carries both variables inside env', () => {
    expect(JSON.parse(buildClientSetupSnippet('settings', args))).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://corecode.live',
        ANTHROPIC_AUTH_TOKEN: 'sk-full-secret-key',
      },
    })
  })

  test('the shell snippet exports both variables before starting claude', () => {
    expect(buildClientSetupSnippet('shell', args).split('\n')).toEqual([
      'export ANTHROPIC_BASE_URL=https://corecode.live',
      'export ANTHROPIC_AUTH_TOKEN=sk-full-secret-key',
      'claude',
    ])
  })

  test('the PowerShell snippet quotes both values', () => {
    expect(buildClientSetupSnippet('powershell', args)).toContain(
      '$env:ANTHROPIC_AUTH_TOKEN = "sk-full-secret-key"'
    )
  })

  test('the Magpie snippets add one provider for every agent and switch theirs to it', () => {
    const add = [
      'magpie provider add CoreCode anthropic=https://corecode.live \\',
      '  url=https://corecode.live/v1 responses=https://corecode.live/v1 key=sk-full-secret-key',
      'magpie provider test corecode',
    ]
    expect(buildClientSetupSnippet('magpie', args).split('\n')).toEqual([
      ...add,
      'magpie claude corecode/claude-opus-5-5',
    ])
    expect(
      buildClientSetupSnippet('codex-magpie', {
        ...args,
        models: ['gpt-5.6-luna', 'gpt-6.1-sol'],
      }).split('\n')
    ).toEqual([...add, 'magpie codex corecode/gpt-6.1-sol'])
  })
})

describe('pickClaudeModels', () => {
  test('keeps only Claude models from the account list', () => {
    expect(pickClaudeModels(['gpt-4o', 'claude-haiku-5-5'])).toEqual([
      'claude-haiku-5-5',
    ])
  })

  test('puts Opus first when the key can call it', () => {
    expect(
      pickClaudeModels([
        'claude-fable-5-1',
        'claude-haiku-5-5',
        'claude-opus-5-5',
      ])
    ).toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'])
  })

  test('falls back to the documented models when the account lists none', () => {
    expect(pickClaudeModels(['gpt-4o'])).toEqual(DEFAULT_CLAUDE_MODELS)
    expect(pickClaudeModels([])).toEqual(DEFAULT_CLAUDE_MODELS)
  })
})

describe('maskApiKey', () => {
  test('shows the prefix and last four characters only', () => {
    expect(maskApiKey('abcdefghijklmnopqrstuvwxyz')).toBe('sk-abcd…wxyz')
    expect(maskApiKey('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-abcd…wxyz')
  })
})

describe('getMagpieProviderId', () => {
  test('lowercases the provider name into a slug', () => {
    expect(getMagpieProviderId('CoreCode')).toBe('corecode')
    expect(getMagpieProviderId('My Relay 2')).toBe('my-relay-2')
    expect(getMagpieProviderId('中文')).toBe('corecode')
  })
})

type UsageExtractor = (response: unknown) => Record<string, unknown>
type UsageScript = {
  request: { url: string; method: string; headers: Record<string, string> }
  extractor: UsageExtractor
}

/** Decodes the link the way CC Switch does, then fills the placeholders. */
function loadUsageScript(app: string, serverAddress: string): UsageScript {
  const url = buildCCSwitchURL({
    app,
    name: 'CoreCode',
    serverAddress,
    apiKey: 'sk-test-key',
    models: { model: 'claude-opus-5-5' },
  })
  const params = new URL(url).searchParams
  const text = new TextDecoder().decode(
    Uint8Array.from(atob(params.get('usageScript') ?? ''), (c) =>
      c.charCodeAt(0)
    )
  )
  const endpoint = params.get('endpoint') ?? ''
  const filled = text
    .replaceAll('{{baseUrl}}', endpoint)
    .replaceAll('{{apiKey}}', 'sk-test-key')
  return new Function(`return ${filled}`)() as UsageScript
}

describe('buildCCSwitchURL usage script', () => {
  test('carries the script, the legacy enable flag and the refresh interval', () => {
    const params = new URL(
      buildCCSwitchURL({
        app: 'claude',
        name: 'CoreCode',
        serverAddress: 'https://corecode.live',
        apiKey: 'sk-test-key',
        models: { model: 'claude-opus-5-5' },
      })
    ).searchParams
    expect(params.get('usageScript')).toBeTruthy()
    expect(params.get('usageEnabled')).toBe('true')
    expect(params.get('usageAutoInterval')).toBe(
      String(CC_SWITCH_USAGE_INTERVAL_MINUTES)
    )
  })

  test.each([
    ['claude', 'https://corecode.live'],
    ['codex', 'https://corecode.live'],
  ])(
    '%s: queries the usage endpoint on the same origin with the key',
    (app, origin) => {
      const script = loadUsageScript(app, origin)
      expect(script.request.url).toBe(`${origin}/api/usage/token/`)
      expect(script.request.method).toBe('GET')
      expect(script.request.headers.Authorization).toBe('Bearer sk-test-key')
    }
  )

  test('shows the account balance when the key may query it', () => {
    const { extractor } = loadUsageScript('claude', 'https://corecode.live')
    expect(
      extractor({
        code: true,
        message: 'ok',
        data: {
          unlimited_quota: true,
          total_available: 0,
          user_quota: { total_available: 1_500_000, total_used: 500_000 },
        },
      })
    ).toEqual({
      isValid: true,
      planName: '账户余额',
      remaining: 3,
      used: 1,
      total: 4,
      unit: 'USD',
    })
  })

  test('prefers the account balance over a limited key quota', () => {
    const { extractor } = loadUsageScript('claude', 'https://corecode.live')
    const result = extractor({
      data: {
        unlimited_quota: false,
        total_available: 500_000,
        user_quota: { total_available: 5_000_000, total_used: 0 },
      },
    })
    expect(result.remaining).toBe(10)
  })

  test('falls back to the key quota when the key is limited', () => {
    const { extractor } = loadUsageScript('claude', 'https://corecode.live')
    expect(
      extractor({
        data: {
          unlimited_quota: false,
          total_granted: 1_000_000,
          total_used: 250_000,
          total_available: 750_000,
        },
      })
    ).toEqual({
      isValid: true,
      planName: '密钥额度',
      remaining: 1.5,
      used: 0.5,
      total: 2,
      unit: 'USD',
    })
  })

  test('tells the customer how to show a balance for an unlimited key', () => {
    const { extractor } = loadUsageScript('claude', 'https://corecode.live')
    const result = extractor({
      data: { unlimited_quota: true, total_available: 0, total_used: 12 },
    })
    expect(result.isValid).toBe(true)
    expect(result).not.toHaveProperty('remaining')
    expect(result.extra).toContain('允许查询用户额度')
  })

  test('marks the key invalid with the server message on an error response', () => {
    const { extractor } = loadUsageScript('claude', 'https://corecode.live')
    expect(extractor({ success: false, message: 'Invalid token' })).toEqual({
      isValid: false,
      invalidMessage: 'Invalid token',
    })
    expect(extractor({})).toEqual({
      isValid: false,
      invalidMessage: '查询失败',
    })
  })
})

describe('buildMagpieImportURL', () => {
  const url = buildMagpieImportURL(args)
  const params = new URLSearchParams(new URL(url).hash.slice(1))

  test('keeps every parameter, the key included, in the fragment', () => {
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://usemagpie.ai/import')
    expect(parsed.search).toBe('')
    expect(url.split('#')[0]).not.toContain(args.apiKey)
    expect(params.get('key')).toBe(args.apiKey)
  })

  test('points the three protocols at the gateway', () => {
    expect(params.get('anthropic')).toBe('https://corecode.live')
    expect(params.get('chat')).toBe('https://corecode.live/v1')
    expect(params.get('responses')).toBe('https://corecode.live/v1')
  })

  test('names the provider with the shared id and leaves the models to /v1/models', () => {
    expect(params.get('id')).toBe('corecode')
    expect(params.get('name')).toBe('CoreCode')
    expect(params.has('models')).toBe(false)
    expect(params.get('website')).toBe('https://corecode.live')
    expect(params.get('keys')).toBe('https://corecode.live/keys')
    expect(params.get('icon')).toBe('https://corecode.live/brand/logo.svg')
  })

  test('encodes special characters', () => {
    const encoded = new URLSearchParams(
      new URL(
        buildMagpieImportURL({ ...args, providerName: 'A & B' })
      ).hash.slice(1)
    )
    expect(encoded.get('name')).toBe('A & B')
  })
})

describe('getSetupClients', () => {
  const claude = ['claude-opus-5-5', 'claude-sonnet-5-5']
  const gpt = ['codex-auto-review', 'gpt-5.6-luna', 'gpt-6.1-sol']
  test.each([
    ['a Claude Code only group', true, claude, ['claude-code']],
    [
      'a Claude group open to other clients',
      false,
      claude,
      ['claude-code', 'openai'],
    ],
    ['the GPT group', false, gpt, ['codex', 'openai']],
    ['the Grok group', false, ['grok-4.6'], ['openai']],
    [
      'auto',
      false,
      [...claude, ...gpt, 'grok-4.6'],
      ['claude-code', 'codex', 'openai'],
    ],
    ['a group whose models are not known yet', false, [], ['claude-code']],
  ] as const)('%s', (_, claudeCodeOnly, models, expected) => {
    expect(getSetupClients({ claudeCodeOnly, models })).toEqual(expected)
  })

  test('offers only Codex for a Codex only group', () => {
    expect(
      getSetupClients({ claudeCodeOnly: false, codexOnly: true, models: gpt })
    ).toEqual(['codex'])
    expect(
      getSetupClients({ claudeCodeOnly: false, codexOnly: true, models: [] })
    ).toEqual(['codex'])
  })

  test('names the action after the only client it offers', () => {
    expect(getSetupTitle(['claude-code'])).toBe('Connect Claude Code')
    expect(getSetupTitle(['codex', 'openai'])).toBe('Connect Codex')
    expect(getSetupTitle(['claude-code', 'openai'])).toBe('Connect a client')
  })
})

describe('Codex and OpenAI-compatible snippets', () => {
  const gptArgs = {
    ...args,
    models: ['codex-auto-review', 'gpt-5.6-luna', 'gpt-6.1-sol'],
  }

  test('points Codex at /v1 over the Responses API with the key in an env var', () => {
    const config = buildClientSetupSnippet('codex-config', gptArgs)
    expect(config).toBe(
      [
        'model = "gpt-6.1-sol"',
        'model_provider = "corecode"',
        '',
        '[model_providers.corecode]',
        'name = "CoreCode"',
        'base_url = "https://corecode.live/v1"',
        'env_key = "CORECODE_API_KEY"',
        'wire_api = "responses"',
      ].join('\n')
    )
    expect(config).not.toContain(args.apiKey)
    expect(buildClientSetupSnippet('codex-shell', gptArgs)).toBe(
      'export CORECODE_API_KEY=sk-full-secret-key\ncodex'
    )
    expect(buildClientSetupSnippet('codex-powershell', gptArgs)).toBe(
      '$env:CORECODE_API_KEY = "sk-full-secret-key"\ncodex'
    )
  })

  test("gives OpenAI tools the /v1 address and one of the group's own models", () => {
    expect(buildClientSetupSnippet('openai-shell', gptArgs)).toBe(
      'export OPENAI_BASE_URL=https://corecode.live/v1\nexport OPENAI_API_KEY=sk-full-secret-key'
    )
    expect(buildClientSetupSnippet('openai-curl', gptArgs)).toContain(
      '"model":"gpt-5.6-luna"'
    )
    expect(pickOpenAIModel(['claude-sonnet-5-5', 'grok-4.6'])).toBe('grok-4.6')
    expect(pickOpenAIModel(['claude-sonnet-5-5'])).toBe('claude-sonnet-5-5')
  })

  test('checks each client with its own command', () => {
    expect(buildVerifyCommand('claude-code', args.baseUrl, 'ok')).toBe(
      'claude -p "ok"'
    )
    expect(buildVerifyCommand('codex', args.baseUrl, 'ok')).toBe(
      'codex exec "ok"'
    )
    expect(buildVerifyCommand('openai', args.baseUrl, 'ok')).toBe(
      'curl https://corecode.live/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"'
    )
  })
})
