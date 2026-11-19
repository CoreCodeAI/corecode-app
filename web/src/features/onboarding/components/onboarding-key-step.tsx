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
 * CoreCode fork: step 2 of the onboarding wizard, the customer's key and the
 * config to paste. A customer with no key that fits the client gets one made
 * in the group built for it; one who has a key picks it. The snippets, hints
 * and deep links are the ones the key's own setup guide shows
 * (features/keys/lib/client-setup.ts), so they cannot drift from it.
 *
 * Like that guide, the screen shows a masked key and every copy button copies
 * the full one. "Show key" reveals it here.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { overviewKeysQueryOptions } from '@/features/dashboard/hooks/use-customer-overview'
import { createApiKey, fetchTokenKey, getApiKey } from '@/features/keys/api'
import {
  getApiKeyFormDefaultValues,
  transformFormDataToPayload,
} from '@/features/keys/lib/api-key-form'
import {
  buildCCSwitchURL,
  buildClientSetupSnippet,
  getAnthropicBaseUrl,
  maskApiKey,
  pickClaudeModels,
  type ClientSetupTarget,
} from '@/features/keys/lib/client-setup'
import { openDeepLink } from '@/features/keys/lib/open-deep-link'
import {
  getTargetHint,
  TARGET_LABELS,
  TARGET_SOURCES,
} from '@/features/keys/lib/setup-labels'
import { useSetupClients } from '@/features/keys/lib/use-setup-clients'
import type { ApiKey } from '@/features/keys/types'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useStatus } from '@/hooks/use-status'
import { getUserGroups } from '@/lib/api'
import { groupText } from '@/lib/group-text'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  pickOnboardingGroup,
  pickReusableKeys,
  setupDocUrl,
  type OnboardingClient,
  type UserGroups,
} from '../lib/onboarding'
import { FundingNotice } from './funding-notice'

/** The shell and file snippets each client offers, in tab order. */
const CLIENT_SNIPPET_TARGETS: Record<
  OnboardingClient,
  readonly ClientSetupTarget[]
> = {
  'claude-code': ['settings', 'shell', 'powershell'],
  'cc-switch': ['cc-switch'],
  agent: [],
  openai: ['openai-shell', 'openai-powershell', 'openai-curl'],
}

type Translate = (key: string, options?: Record<string, unknown>) => string

function pickShownKey(
  key: ApiKey | null,
  fullKey: string | null,
  t: Translate
): string {
  if (!key) return t('sk-your-key')
  return fullKey ?? maskApiKey(key.key)
}

function describeSnippet(
  client: OnboardingClient,
  target: ClientSetupTarget | null,
  baseUrl: string,
  t: Translate
): string {
  if (client === 'agent') {
    return t(
      'Paste this into Claude Code, Codex, Cursor or any AI agent. It reads the setup guide and edits your config for you.'
    )
  }
  if (client === 'openai') {
    return t(
      'In Cursor, Cherry Studio and other tools, set the OpenAI base URL to {{url}}/v1 and paste the key. Environment variables work for SDKs.',
      { url: baseUrl }
    )
  }
  return target ? getTargetHint(target, t) : ''
}

function renderSnippet(
  client: OnboardingClient,
  target: ClientSetupTarget | null,
  apiKey: string,
  agentPrompt: (apiKey: string) => string,
  snippetArgs: (apiKey: string) => Parameters<typeof buildClientSetupSnippet>[1]
): string {
  if (client === 'agent') return agentPrompt(apiKey)
  return target ? buildClientSetupSnippet(target, snippetArgs(apiKey)) : ''
}

export function OnboardingKeyStep(props: {
  client: OnboardingClient
  /** Keys made by this wizard, until the keys list includes them. */
  createdKeys: ApiKey[]
  onCreated: (key: ApiKey) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { status } = useStatus()
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const groupsQuery = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    staleTime: 60 * 1000,
  })
  const keysQuery = useQuery(overviewKeysQueryOptions)
  const [pickedKeyId, setPickedKeyId] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [target, setTarget] = useState<ClientSetupTarget | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deepLinkOpened, setDeepLinkOpened] = useState(false)
  const createStarted = useRef(false)

  const groupData = groupsQuery.data?.data
  const groups: UserGroups =
    groupData && !Array.isArray(groupData) ? groupData : {}
  const listed = keysQuery.data ?? []
  const known = [
    ...listed,
    ...props.createdKeys.filter(
      (made) => !listed.some((k) => k.id === made.id)
    ),
  ]
  const reusable = pickReusableKeys(known, groups, props.client)
  const selectedKey =
    reusable.find((key) => key.id === pickedKeyId) ?? reusable[0] ?? null
  const placement = pickOnboardingGroup(groups, props.client)
  const loaded = groupsQuery.isSuccess && keysQuery.isSuccess
  const loadFailed = groupsQuery.isError || keysQuery.isError

  // No key fits the client: make one in the group built for it. The ref keeps
  // a re-render or StrictMode's second effect run from making two.
  const needsKey = loaded && selectedKey === null
  useEffect(() => {
    if (!needsKey || createStarted.current) return
    createStarted.current = true
    setCreating(true)
    void (async () => {
      try {
        const form = getApiKeyFormDefaultValues(placement.group === 'auto')
        const payload = transformFormDataToPayload({
          ...form,
          name: t('Default key'),
          group: placement.group,
        })
        const created = requireServerSuccess(await createApiKey(payload))
        const id = created.data?.id
        if (!id) throw new Error('The new API key has no id')
        const fetched = requireServerSuccess(await getApiKey(id))
        if (!fetched.data) throw new Error('The new API key could not be read')
        props.onCreated(fetched.data)
        void queryClient.invalidateQueries({ queryKey: ['keys'] })
        void queryClient.invalidateQueries({
          queryKey: overviewKeysQueryOptions.queryKey,
        })
      } catch (error) {
        createStarted.current = false
        handleServerError(error, t('Failed to create API key'))
      } finally {
        setCreating(false)
      }
    })()
    // Only the moment a key turns out to be missing starts a creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsKey])

  const { models } = useSetupClients(selectedKey)
  const providerName = status?.system_name?.trim() || 'CoreCode'
  const baseUrl = getAnthropicBaseUrl(
    typeof status?.server_address === 'string'
      ? status.server_address
      : undefined,
    window.location.origin
  )
  const targets = CLIENT_SNIPPET_TARGETS[props.client]
  const activeTarget =
    target && targets.includes(target) ? target : (targets[0] ?? null)

  const secretQuery = useQuery({
    queryKey: ['client-setup', 'secret', selectedKey?.id],
    queryFn: () => fetchTokenKey(selectedKey?.id ?? 0),
    enabled: revealed && selectedKey !== null,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  })
  const fullKey = secretQuery.data?.data?.key
    ? `sk-${secretQuery.data.data.key}`
    : null
  const shownKey = pickShownKey(selectedKey, revealed ? fullKey : null, t)

  const resolveKey = async (): Promise<string | null> => {
    if (!selectedKey) return null
    try {
      const result = await queryClient.fetchQuery({
        queryKey: ['client-setup', 'secret', selectedKey.id],
        queryFn: () => fetchTokenKey(selectedKey.id),
        staleTime: Infinity,
        gcTime: 5 * 60 * 1000,
      })
      if (result.success && result.data?.key) return `sk-${result.data.key}`
      handleServerError(result, t('Failed to copy to clipboard'))
    } catch (error) {
      handleServerError(error, t('Failed to copy to clipboard'))
    }
    return null
  }

  // Hands the clipboard a promise during the click: Safari accepts a write
  // only then, and the full key arrives after a request.
  const copyWithKey = async (id: string, build: (apiKey: string) => string) => {
    const pendingKey = resolveKey()
    const text = pendingKey.then((apiKey) => {
      if (!apiKey) throw new Error('no API key')
      return build(apiKey)
    })
    const ok = await copyToClipboard(text)
    if (!(await pendingKey)) return
    if (!ok) {
      toast.error(t('Failed to copy to clipboard'))
      return
    }
    setCopied(id)
    window.setTimeout(() => setCopied(null), 1800)
    toast.success(t('Copied with your full API key'))
  }

  const snippetArgs = (apiKey: string) => ({
    baseUrl,
    apiKey,
    providerName,
    models,
  })
  const agentPrompt = (apiKey: string) =>
    t(
      'Read {{url}} and follow it to connect Claude Code to {{name}} for me. My API key is {{key}}',
      { url: setupDocUrl(baseUrl), name: providerName, key: apiKey }
    )

  const handleImportCCSwitch = async () => {
    const apiKey = await resolveKey()
    if (!apiKey) return
    openDeepLink(
      buildCCSwitchURL({
        app: 'claude',
        name: providerName,
        serverAddress: baseUrl,
        apiKey,
        models: { model: pickClaudeModels(models)[0] },
      })
    )
    setDeepLinkOpened(true)
  }

  if (loadFailed) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        {t('Failed to load your API keys. Close this guide and try again.')}
      </p>
    )
  }
  if (!selectedKey) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-sm'>
        <Loader2 className='size-4 animate-spin' aria-hidden />
        {creating ? t('Creating your API key…') : t('Checking your API keys…')}
      </p>
    )
  }

  const keyGroup = selectedKey.group || ''
  const snippetText = renderSnippet(
    props.client,
    activeTarget,
    shownKey,
    agentPrompt,
    snippetArgs
  )
  const sourceLabel =
    props.client === 'agent'
      ? t('Prompt for your AI agent')
      : TARGET_SOURCES[activeTarget ?? 'settings']
  const copyButtonId = props.client === 'agent' ? 'prompt' : activeTarget

  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <KeyRound className='text-muted-foreground size-4' aria-hidden />
        {reusable.length > 1 ? (
          <Select
            value={String(selectedKey.id)}
            onValueChange={(value) => setPickedKeyId(Number(value))}
          >
            <SelectTrigger size='sm' aria-label={t('API key')} className='w-44'>
              <SelectValue>
                <span className='truncate'>{selectedKey.name}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {reusable.map((key) => (
                  <SelectItem key={key.id} value={String(key.id)}>
                    {key.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <span className='text-sm font-medium'>{selectedKey.name}</span>
        )}
        <code className='bg-muted rounded-md px-2 py-0.5 font-mono text-xs break-all'>
          {shownKey}
        </code>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
        >
          {revealed ? (
            <EyeOff data-icon='inline-start' />
          ) : (
            <Eye data-icon='inline-start' />
          )}
          {revealed ? t('Hide key') : t('Show key')}
        </Button>
      </div>
      {keyGroup && (
        <p className='text-muted-foreground text-xs'>
          {t('Group: {{group}}', { group: groupText(t, keyGroup) })}
        </p>
      )}
      {placement.fellBack && keyGroup === '' && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Your account cannot use the group made for this client, so the key uses your default group.'
          )}
        </p>
      )}

      {targets.length > 1 && (
        <Tabs
          value={activeTarget ?? undefined}
          onValueChange={(value) => setTarget(value as ClientSetupTarget)}
          className='max-w-full min-w-0'
        >
          <TabsList
            aria-label={t('Setup method')}
            className='no-scrollbar max-w-full justify-start overflow-x-auto'
          >
            {targets.map((item) => (
              <TabsTrigger key={item} value={item} className='flex-none px-2.5'>
                {TARGET_LABELS[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <p className='text-muted-foreground text-xs leading-relaxed text-pretty'>
        {describeSnippet(props.client, activeTarget, baseUrl, t)}
      </p>

      <div className='bg-muted/40 min-w-0 overflow-hidden rounded-xl border'>
        <div className='flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-4'>
          <span className='text-muted-foreground truncate font-mono text-xs'>
            {sourceLabel}
          </span>
          <Button
            variant='ghost'
            size='sm'
            onClick={() =>
              copyWithKey(copyButtonId ?? 'copy', (apiKey) =>
                props.client === 'agent'
                  ? agentPrompt(apiKey)
                  : buildClientSetupSnippet(
                      activeTarget as ClientSetupTarget,
                      snippetArgs(apiKey)
                    )
              )
            }
          >
            {copied === copyButtonId ? (
              <Check className='text-success' data-icon='inline-start' />
            ) : (
              <Copy data-icon='inline-start' />
            )}
            {t('Copy')}
          </Button>
        </div>
        <pre
          className='overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap'
          aria-label={t('Configuration snippet')}
        >
          <code>{snippetText}</code>
        </pre>
        <p className='text-muted-foreground border-t px-4 py-1.5 text-xs'>
          {t('The key is masked here. The Copy button copies the full key.')}
        </p>
      </div>

      {props.client === 'openai' && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => copyWithKey('key', (apiKey) => apiKey)}
          >
            {copied === 'key' ? (
              <Check className='text-success' data-icon='inline-start' />
            ) : (
              <Copy data-icon='inline-start' />
            )}
            {t('Copy API key')}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              void copyToClipboard(`${baseUrl}/v1`).then(() => {
                setCopied('url')
                window.setTimeout(() => setCopied(null), 1800)
              })
            }
          >
            {copied === 'url' ? (
              <Check className='text-success' data-icon='inline-start' />
            ) : (
              <Copy data-icon='inline-start' />
            )}
            {t('Copy base URL')}
          </Button>
        </div>
      )}

      {props.client === 'cc-switch' && (
        <>
          <Button
            className='self-start'
            size='sm'
            onClick={handleImportCCSwitch}
          >
            <ArrowRightLeft data-icon='inline-start' />
            {t('Import to CC Switch')}
          </Button>
          {deepLinkOpened && (
            <p className='text-muted-foreground text-xs'>
              {t(
                'Nothing happened? Install CC Switch first, or copy the config instead.'
              )}
            </p>
          )}
        </>
      )}

      <FundingNotice />
    </div>
  )
}
