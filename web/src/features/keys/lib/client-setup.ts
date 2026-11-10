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
/**
 * CoreCode fork: the snippets a customer pastes to point Claude Code at this
 * gateway. They follow the public docs (/docs/#claude-code) word for word, so
 * the console and the docs never give two different answers.
 *
 * Claude Code reads the Anthropic base URL without `/v1`; a trailing `/v1`
 * makes it request `/v1/v1/messages`.
 */

export const CLIENT_SETUP_TARGETS = [
  'settings',
  'shell',
  'powershell',
  'cc-switch',
  'magpie',
  'codex-config',
  'codex-shell',
  'codex-powershell',
  'codex-cc-switch',
  'codex-magpie',
  'openai-shell',
  'openai-powershell',
  'openai-curl',
] as const

export type ClientSetupTarget = (typeof CLIENT_SETUP_TARGETS)[number]

/**
 * The client a key is set up for. A Claude Code only group gets Claude Code
 * alone; other groups get every client their models can serve.
 */
export const SETUP_CLIENTS = ['claude-code', 'codex', 'openai'] as const

export type SetupClient = (typeof SETUP_CLIENTS)[number]

export const CLIENT_TARGETS: Record<SetupClient, readonly ClientSetupTarget[]> =
  {
    'claude-code': ['settings', 'shell', 'powershell', 'cc-switch', 'magpie'],
    codex: [
      'codex-config',
      'codex-shell',
      'codex-powershell',
      'codex-cc-switch',
      'codex-magpie',
    ],
    openai: ['openai-shell', 'openai-powershell', 'openai-curl'],
  }

/** The model Codex starts on when the key can call it. */
export const DEFAULT_CODEX_MODEL = 'gpt-6.1-sol'

/**
 * Clients for a key whose group serves `models`. With no models known yet the
 * guide shows Claude Code, the client every group but GPT serves.
 */
export function getSetupClients(args: {
  claudeCodeOnly: boolean
  codexOnly?: boolean
  models: readonly string[]
}): SetupClient[] {
  if (args.codexOnly) return ['codex']
  if (args.claudeCodeOnly || args.models.length === 0) return ['claude-code']
  const clients: SetupClient[] = []
  if (args.models.some((model) => model.startsWith('claude-'))) {
    clients.push('claude-code')
  }
  if (args.models.some((model) => model.startsWith('gpt-'))) {
    clients.push('codex')
  }
  clients.push('openai')
  return clients
}

/** i18n key of the action that opens the guide for a key with `clients`. */
export function getSetupTitle(clients: readonly SetupClient[]): string {
  if (clients.length === 1 && clients[0] === 'claude-code') {
    return 'Connect Claude Code'
  }
  if (clients[0] === 'codex') return 'Connect Codex'
  return 'Connect a client'
}

export function pickCodexModel(models: readonly string[]): string {
  if (models.includes(DEFAULT_CODEX_MODEL)) return DEFAULT_CODEX_MODEL
  return models.find((model) => model.startsWith('gpt-')) ?? DEFAULT_CODEX_MODEL
}

/** A model for the OpenAI examples: the group's own before a Claude one. */
export function pickOpenAIModel(models: readonly string[]): string {
  const callable = models.filter((model) => model !== 'codex-auto-review')
  return (
    callable.find((model) => !model.startsWith('claude-')) ??
    pickClaudeModels(callable)[0]
  )
}

/** The variable Codex reads the key from, e.g. CORECODE_API_KEY. */
export function getCodexEnvKey(providerName: string): string {
  return `${getMagpieProviderId(providerName).toUpperCase().replaceAll('-', '_')}_API_KEY`
}

export function buildVerifyCommand(
  client: SetupClient,
  baseUrl: string,
  prompt: string
): string {
  switch (client) {
    case 'claude-code':
      return `claude -p "${prompt}"`
    case 'codex':
      return `codex exec "${prompt}"`
    case 'openai':
      return `curl ${baseUrl}/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`
  }
}

/** Used when the gateway lists no Claude models for this account. */
export const DEFAULT_CLAUDE_MODELS = [
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
]

export function getAnthropicBaseUrl(
  serverAddress: string | undefined,
  fallbackOrigin: string
): string {
  const base = serverAddress?.trim() || fallbackOrigin
  return base.replace(/\/+$/, '').replace(/\/v1$/, '')
}

/** The model Claude Code starts on when the key can call it. */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/**
 * The key's Claude models, DEFAULT_CLAUDE_MODEL first: callers that need one
 * model take the first, and the list itself is in name order, which put Fable
 * ahead of Opus.
 */
export function pickClaudeModels(models: readonly string[]): string[] {
  const claude = models.filter((model) => model.startsWith('claude-'))
  if (claude.length === 0) return DEFAULT_CLAUDE_MODELS
  if (!claude.includes(DEFAULT_CLAUDE_MODEL)) return claude
  return [
    DEFAULT_CLAUDE_MODEL,
    ...claude.filter((model) => model !== DEFAULT_CLAUDE_MODEL),
  ]
}

/** Shows enough of a key to recognise it without exposing it on screen. */
export function maskApiKey(key: string): string {
  const full = key.startsWith('sk-') ? key : `sk-${key}`
  if (full.length <= 14) return full
  return `${full.slice(0, 7)}…${full.slice(-4)}`
}

export function getMagpieProviderId(providerName: string): string {
  const slug = providerName
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
  return slug || 'corecode'
}

export function buildClientSetupSnippet(
  target: ClientSetupTarget,
  args: {
    baseUrl: string
    apiKey: string
    providerName: string
    models: readonly string[]
  }
): string {
  switch (target) {
    case 'settings':
    case 'cc-switch':
      return JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: args.baseUrl,
            ANTHROPIC_AUTH_TOKEN: args.apiKey,
          },
        },
        null,
        2
      )
    case 'shell':
      return [
        `export ANTHROPIC_BASE_URL=${args.baseUrl}`,
        `export ANTHROPIC_AUTH_TOKEN=${args.apiKey}`,
        'claude',
      ].join('\n')
    case 'powershell':
      return [
        `$env:ANTHROPIC_BASE_URL = "${args.baseUrl}"`,
        `$env:ANTHROPIC_AUTH_TOKEN = "${args.apiKey}"`,
        'claude',
      ].join('\n')
    case 'codex-config':
    case 'codex-cc-switch': {
      const id = getMagpieProviderId(args.providerName)
      return [
        `model = "${pickCodexModel(args.models)}"`,
        `model_provider = "${id}"`,
        '',
        `[model_providers.${id}]`,
        `name = "${args.providerName}"`,
        `base_url = "${args.baseUrl}/v1"`,
        `env_key = "${getCodexEnvKey(args.providerName)}"`,
        'wire_api = "responses"',
      ].join('\n')
    }
    case 'codex-shell':
      return [
        `export ${getCodexEnvKey(args.providerName)}=${args.apiKey}`,
        'codex',
      ].join('\n')
    case 'codex-powershell':
      return [
        `$env:${getCodexEnvKey(args.providerName)} = "${args.apiKey}"`,
        'codex',
      ].join('\n')
    case 'openai-shell':
      return [
        `export OPENAI_BASE_URL=${args.baseUrl}/v1`,
        `export OPENAI_API_KEY=${args.apiKey}`,
      ].join('\n')
    case 'openai-powershell':
      return [
        `$env:OPENAI_BASE_URL = "${args.baseUrl}/v1"`,
        `$env:OPENAI_API_KEY = "${args.apiKey}"`,
      ].join('\n')
    case 'openai-curl':
      return [
        `curl ${args.baseUrl}/v1/chat/completions \\`,
        `  -H "Authorization: Bearer ${args.apiKey}" \\`,
        '  -H "Content-Type: application/json" \\',
        `  -d '{"model":"${pickOpenAIModel(args.models)}","messages":[{"role":"user","content":"Hello"}]}'`,
      ].join('\n')
    case 'magpie':
    case 'codex-magpie': {
      // One provider for every agent: the Anthropic, Chat Completions and
      // Responses addresses, and no model list, so Magpie reads /v1/models
      // with the key as the import link does.
      const id = getMagpieProviderId(args.providerName)
      const agent =
        target === 'magpie'
          ? `magpie claude ${id}/${pickClaudeModels(args.models)[0]}`
          : `magpie codex ${id}/${pickCodexModel(args.models)}`
      return [
        `magpie provider add ${args.providerName} anthropic=${args.baseUrl} \\`,
        `  url=${args.baseUrl}/v1 responses=${args.baseUrl}/v1 key=${args.apiKey}`,
        `magpie provider test ${id}`,
        agent,
      ].join('\n')
    }
  }
}

/** Minutes between the balance refreshes CC Switch makes for each customer. */
export const CC_SWITCH_USAGE_INTERVAL_MINUTES = 10

/**
 * Usage-query script CC Switch stores on the imported provider card. CC Switch
 * runs it in a sandbox: `request` is sent from the customer's machine and must
 * stay on the provider's origin; `extractor` turns the JSON into the card's
 * balance. `{{baseUrl}}` carries `/v1` for Codex, so the script strips it.
 * 500000 quota is 1 USD, the unit the console shows.
 *
 * `/api/usage/token/` answers to the sk- key itself. `user_quota` only appears
 * when the key allows querying user quota; a limited key can still show its
 * own remaining quota, an unlimited one has nothing to show without it.
 */
export const CC_SWITCH_USAGE_SCRIPT = `({
  request: {
    url: "{{baseUrl}}".replace(/\\/+$/, "").replace(/\\/v1$/, "") + "/api/usage/token/",
    method: "GET",
    headers: {
      "Authorization": "Bearer {{apiKey}}"
    }
  },
  extractor: function (response) {
    var data = response && response.data;
    if (!data) {
      return {
        isValid: false,
        invalidMessage: (response && response.message) || "查询失败"
      };
    }
    var perUnit = 500000;
    var account = data.user_quota;
    if (account) {
      return {
        isValid: true,
        planName: "账户余额",
        remaining: account.total_available / perUnit,
        used: account.total_used / perUnit,
        total: (account.total_available + account.total_used) / perUnit,
        unit: "USD"
      };
    }
    if (!data.unlimited_quota) {
      return {
        isValid: true,
        planName: "密钥额度",
        remaining: data.total_available / perUnit,
        used: data.total_used / perUnit,
        total: data.total_granted / perUnit,
        unit: "USD"
      };
    }
    return {
      isValid: true,
      planName: "无限额度密钥",
      extra: "要显示账户余额，请在 CoreCode 控制台编辑此密钥，开启“允许查询用户额度”"
    };
  }
})`

function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

/**
 * Deep link that CC Switch registers. The app shows a confirmation with the
 * address and the usage script before it imports anything.
 */
export function buildCCSwitchURL(args: {
  app: string
  name: string
  serverAddress: string
  apiKey: string
  models: Record<string, string>
}): string {
  const endpoint =
    args.app === 'codex' ? `${args.serverAddress}/v1` : args.serverAddress
  const params = new URLSearchParams()
  params.set('resource', 'provider')
  params.set('app', args.app)
  params.set('name', args.name)
  params.set('endpoint', endpoint)
  params.set('apiKey', args.apiKey)
  for (const [k, v] of Object.entries(args.models)) {
    if (v) params.set(k, v)
  }
  params.set('homepage', args.serverAddress)
  params.set('enabled', 'true')
  params.set('usageScript', toBase64(CC_SWITCH_USAGE_SCRIPT))
  // Versions before 4.0.10 only start the script when this is set.
  params.set('usageEnabled', 'true')
  params.set('usageAutoInterval', String(CC_SWITCH_USAGE_INTERVAL_MINUTES))
  return `ccswitch://v1/import?${params.toString()}`
}

/**
 * Web link for Magpie's one-click import. Everything rides in the fragment, so
 * the key never reaches a server; the page hands it to `magpie://import`, and
 * Magpie shows a confirmation before it saves. The shared id replaces the
 * built-in CoreCode preset instead of adding a second provider. No `models`:
 * Magpie then reads /v1/models with the key, so each agent sees what that key
 * can call, GPT models included on an Auto key.
 */
export function buildMagpieImportURL(args: {
  baseUrl: string
  apiKey: string
  providerName: string
}): string {
  const params = new URLSearchParams()
  params.set('name', args.providerName)
  params.set('id', 'corecode')
  params.set('chat', `${args.baseUrl}/v1`)
  params.set('responses', `${args.baseUrl}/v1`)
  params.set('anthropic', args.baseUrl)
  params.set('key', args.apiKey)
  params.set('website', args.baseUrl)
  params.set('keys', `${args.baseUrl}/keys`)
  params.set('icon', `${args.baseUrl}/brand/logo.svg`)
  return `https://usemagpie.ai/import#${params.toString()}`
}
