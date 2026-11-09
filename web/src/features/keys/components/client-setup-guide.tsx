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
 * CoreCode fork: one place that tells a customer how to point their tools at
 * this gateway, with their own key filled in. The clients offered follow the
 * key's group (`useSetupClients`): Claude Code alone for a Claude Code only
 * group, and Codex or OpenAI-compatible tools where the group serves them.
 *
 * The snippet on screen shows a masked key; the copy button fetches the real
 * key and copies the snippet with it. That is why this does not use
 * `CodeBlockCopyButton` or `CopyButton`: both copy the text they display.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowRightLeft,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  TriangleAlert,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useStatus } from '@/hooks/use-status'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { fetchTokenKey } from '../api'
import {
  buildCCSwitchURL,
  buildClientSetupSnippet,
  buildMagpieImportURL,
  buildVerifyCommand,
  CLIENT_TARGETS,
  getAnthropicBaseUrl,
  getSetupTitle,
  maskApiKey,
  pickClaudeModels,
  pickCodexModel,
  type ClientSetupTarget,
  type SetupClient,
} from '../lib/client-setup'
import { openDeepLink } from '../lib/open-deep-link'
import { createStarterKey } from '../lib/quick-create-key'
import { useSetupClients } from '../lib/use-setup-clients'
import type { ApiKey } from '../types'

const TARGET_LABELS: Record<ClientSetupTarget, string> = {
  settings: 'settings.json',
  shell: 'macOS / Linux',
  powershell: 'Windows',
  'cc-switch': 'CC Switch',
  magpie: 'Magpie',
  'codex-config': 'config.toml',
  'codex-shell': 'macOS / Linux',
  'codex-powershell': 'Windows',
  'codex-cc-switch': 'CC Switch',
  'codex-magpie': 'Magpie',
  'openai-shell': 'macOS / Linux',
  'openai-powershell': 'Windows',
  'openai-curl': 'curl',
}

const CLIENT_LABELS: Record<SetupClient, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  openai: 'Other tools',
}

/** What the snippet is: a file to edit or the shell to paste it into. */
const TARGET_SOURCES: Record<ClientSetupTarget, string> = {
  settings: '~/.claude/settings.json',
  shell: 'bash / zsh',
  powershell: 'PowerShell',
  'cc-switch': 'CC Switch · settings.json',
  magpie: 'bash / zsh',
  'codex-config': '~/.codex/config.toml',
  'codex-shell': 'bash / zsh',
  'codex-powershell': 'PowerShell',
  'codex-cc-switch': 'CC Switch · config.toml',
  'codex-magpie': 'bash / zsh',
  'openai-shell': 'bash / zsh',
  'openai-powershell': 'PowerShell',
  'openai-curl': 'bash / zsh',
}

function getTargetHint(
  target: ClientSetupTarget,
  t: (key: string) => string
): string {
  switch (target) {
    case 'settings':
      return t(
        'Recommended. Merge this env block into ~/.claude/settings.json (Windows: %USERPROFILE%\\.claude\\settings.json), then open a new terminal and run claude.'
      )
    case 'shell':
      return t(
        'For the current terminal only. Add the two export lines to ~/.zshrc or ~/.bashrc to keep them.'
      )
    case 'powershell':
      return t(
        'For the current PowerShell window only. Use setx for both variables to keep them, then reopen the terminal.'
      )
    case 'cc-switch':
      return t(
        'Import with one click, or add a custom provider in CC Switch and paste this config. New Claude Code sessions use it after you switch.'
      )
    case 'magpie':
      return t(
        'Adds this gateway as a Magpie provider and switches Claude Code to it. New sessions use it.'
      )
    case 'codex-magpie':
      return t(
        'Adds this gateway as a Magpie provider and switches Codex to it. One provider serves Claude Code and Codex, so add it once.'
      )
    case 'codex-config':
      return t(
        'Recommended. Add this to ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml). Codex reads the key from the variable named in env_key; set it on the macOS / Linux or Windows tab.'
      )
    case 'codex-shell':
      return t(
        'Sets the key Codex reads, for the current terminal only. Add the export line to ~/.zshrc or ~/.bashrc to keep it.'
      )
    case 'codex-powershell':
      return t(
        'Sets the key Codex reads, for the current PowerShell window only. Use setx to keep it, then reopen the terminal.'
      )
    case 'codex-cc-switch':
      return t(
        'Import with one click, or add a custom Codex provider in CC Switch with this config. New Codex sessions use it after you switch.'
      )
    case 'openai-shell':
      return t(
        'For SDKs and tools that speak the OpenAI API and read these variables. Anthropic SDKs take the address without /v1.'
      )
    case 'openai-powershell':
      return t(
        'For SDKs and tools that speak the OpenAI API, in the current PowerShell window only. Anthropic SDKs take the address without /v1.'
      )
    case 'openai-curl':
      return t(
        'A Chat Completions request. Any tool that lets you set an OpenAI base URL works with the same address and key.'
      )
  }
}

interface ClientSetupGuideProps {
  /** Keys the customer can pick from; the first enabled one is preselected. */
  keys: ApiKey[]
  keysLoading?: boolean
  className?: string
  /** Renders a heading above the guide from the selected key's setup title. */
  renderHeading?: (title: string) => ReactNode
}

export function ClientSetupGuide(props: ClientSetupGuideProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { status } = useStatus()
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const [client, setClient] = useState<SetupClient>('claude-code')
  const [target, setTarget] = useState<ClientSetupTarget>('settings')
  const [pickedKeyId, setPickedKeyId] = useState<number | null>(null)
  const [busy, setBusy] = useState<
    'copy' | 'verify' | 'cc-switch' | 'magpie' | 'create' | null
  >(null)
  // The key made here, until the keys list the parent passes includes it.
  const [createdKey, setCreatedKey] = useState<ApiKey | null>(null)
  // The deep link that was just opened; its app may not be installed.
  const [deepLinkOpened, setDeepLinkOpened] = useState<
    'cc-switch' | 'magpie' | null
  >(null)
  const [copied, setCopied] = useState<'copy' | 'verify' | null>(null)

  const listedKeys = props.keys.filter((key) => key.status === 1)
  const usableKeys =
    createdKey && !listedKeys.some((key) => key.id === createdKey.id)
      ? [...listedKeys, createdKey]
      : listedKeys
  const selectedKey =
    usableKeys.find((key) => key.id === pickedKeyId) ?? usableKeys[0] ?? null
  const { clients, models } = useSetupClients(selectedKey)
  // Switching to a key that offers other clients falls back to its first one.
  const activeClient = clients.includes(client) ? client : clients[0]
  const targets = CLIENT_TARGETS[activeClient]
  const activeTarget = targets.includes(target) ? target : targets[0]
  const providerName = status?.system_name?.trim() || 'CoreCode'
  const baseUrl = getAnthropicBaseUrl(
    typeof status?.server_address === 'string'
      ? status.server_address
      : undefined,
    window.location.origin
  )
  const placeholderKey = t('sk-your-key')
  const showCreate = !selectedKey && !props.keysLoading
  const snippet = buildClientSetupSnippet(activeTarget, {
    baseUrl,
    apiKey: selectedKey ? maskApiKey(selectedKey.key) : placeholderKey,
    providerName,
    models,
  })
  const verifyCommand = buildVerifyCommand(
    activeClient,
    baseUrl,
    t('Reply with ok')
  )

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

  const handleCreateKey = async () => {
    setBusy('create')
    try {
      const created = await createStarterKey(
        queryClient,
        status?.default_use_auto_group === true
      )
      setCreatedKey(created)
      setPickedKeyId(created.id)
      toast.success(t('API key created. It is filled into the config below.'))
      void queryClient.invalidateQueries({
        queryKey: ['dashboard', 'overview'],
      })
      void queryClient.invalidateQueries({ queryKey: ['keys'] })
    } catch (error) {
      handleServerError(error, t('Failed to create API key'))
    } finally {
      setBusy(null)
    }
  }

  const flashCopied = (which: 'copy' | 'verify') => {
    setCopied(which)
    window.setTimeout(() => setCopied(null), 1800)
  }

  const handleCopySnippet = async () => {
    setBusy('copy')
    try {
      const apiKey = await resolveKey()
      if (!apiKey) return
      const text = buildClientSetupSnippet(activeTarget, {
        baseUrl,
        apiKey,
        providerName,
        models,
      })
      if (await copyToClipboard(text)) {
        flashCopied('copy')
        toast.success(t('Copied with your full API key'))
      } else {
        toast.error(t('Failed to copy to clipboard'))
      }
    } finally {
      setBusy(null)
    }
  }

  const handleCopyVerify = async () => {
    if (await copyToClipboard(verifyCommand)) flashCopied('verify')
  }

  const handleOpenCCSwitch = async (app: 'claude' | 'codex') => {
    setBusy('cc-switch')
    try {
      const apiKey = await resolveKey()
      if (!apiKey) return
      openDeepLink(
        buildCCSwitchURL({
          app,
          name: providerName,
          serverAddress: baseUrl,
          apiKey,
          models: {
            model:
              app === 'codex'
                ? pickCodexModel(models)
                : pickClaudeModels(models)[0],
          },
        })
      )
      setDeepLinkOpened('cc-switch')
    } finally {
      setBusy(null)
    }
  }

  const handleOpenMagpie = async () => {
    setBusy('magpie')
    try {
      const apiKey = await resolveKey()
      if (!apiKey) return
      openDeepLink(buildMagpieImportURL({ baseUrl, apiKey, providerName }))
      setDeepLinkOpened('magpie')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', props.className)}>
      {props.renderHeading?.(t(getSetupTitle(clients)))}
      {clients.length > 1 && (
        <Tabs
          value={activeClient}
          onValueChange={(value) => setClient(value as SetupClient)}
          className='max-w-full min-w-0'
        >
          <TabsList
            variant='line'
            aria-label={t('Client')}
            className='no-scrollbar max-w-full justify-start overflow-x-auto'
          >
            {clients.map((item) => (
              <TabsTrigger key={item} value={item} className='flex-none px-2.5'>
                {t(CLIENT_LABELS[item])}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <Tabs
          value={activeTarget}
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

        {usableKeys.length > 1 && selectedKey && (
          <Select
            value={String(selectedKey.id)}
            onValueChange={(value) => setPickedKeyId(Number(value))}
          >
            <SelectTrigger size='sm' aria-label={t('API key')} className='w-44'>
              <SelectValue>
                <KeyRound className='text-muted-foreground' aria-hidden />
                <span className='truncate'>{selectedKey.name}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {usableKeys.map((key) => (
                  <SelectItem key={key.id} value={String(key.id)}>
                    {key.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>

      <p className='text-muted-foreground text-xs leading-relaxed text-pretty'>
        {getTargetHint(activeTarget, t)}
      </p>

      <div className='bg-muted/40 min-w-0 overflow-hidden rounded-xl border'>
        <div className='flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-4'>
          <span className='text-muted-foreground truncate font-mono text-xs'>
            {TARGET_SOURCES[activeTarget]}
          </span>
          {showCreate ? (
            <Button
              size='sm'
              onClick={handleCreateKey}
              disabled={busy === 'create'}
            >
              {busy === 'create' ? (
                <Loader2 className='animate-spin' data-icon='inline-start' />
              ) : (
                <Plus data-icon='inline-start' />
              )}
              {t('Create API Key')}
            </Button>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              onClick={handleCopySnippet}
              disabled={busy === 'copy' || props.keysLoading}
            >
              {busy === 'copy' && (
                <Loader2 className='animate-spin' data-icon='inline-start' />
              )}
              {busy !== 'copy' && copied === 'copy' && (
                <Check className='text-success' data-icon='inline-start' />
              )}
              {busy !== 'copy' && copied !== 'copy' && (
                <Copy data-icon='inline-start' />
              )}
              {t('Copy')}
            </Button>
          )}
        </div>
        <pre
          className='overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed'
          aria-label={t('Configuration snippet')}
        >
          <code>{snippet}</code>
        </pre>
        {selectedKey && (
          <p className='text-muted-foreground border-t px-4 py-1.5 text-xs'>
            {t('The key is masked here. The Copy button copies the full key.')}
          </p>
        )}
      </div>

      {(activeTarget === 'cc-switch' || activeTarget === 'codex-cc-switch') &&
        selectedKey && (
          <Button
            className='self-start'
            size='sm'
            onClick={() =>
              handleOpenCCSwitch(
                activeTarget === 'codex-cc-switch' ? 'codex' : 'claude'
              )
            }
            disabled={busy === 'cc-switch'}
          >
            {busy === 'cc-switch' ? (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            ) : (
              <ArrowRightLeft data-icon='inline-start' />
            )}
            {t('Import to CC Switch')}
          </Button>
        )}
      {deepLinkOpened === 'cc-switch' &&
        (activeTarget === 'cc-switch' ||
          activeTarget === 'codex-cc-switch') && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Nothing happened? Install CC Switch first, or copy the config instead.'
            )}
          </p>
        )}

      {(activeTarget === 'magpie' || activeTarget === 'codex-magpie') &&
        selectedKey && (
          <Button
            className='self-start'
            size='sm'
            onClick={handleOpenMagpie}
            disabled={busy === 'magpie'}
          >
            {busy === 'magpie' ? (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            ) : (
              <ArrowRightLeft data-icon='inline-start' />
            )}
            {t('Add to Magpie')}
          </Button>
        )}
      {deepLinkOpened === 'magpie' &&
        (activeTarget === 'magpie' || activeTarget === 'codex-magpie') && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Nothing happened? Install Magpie first, or copy the config instead.'
            )}
          </p>
        )}

      {showCreate && (
        <div className='bg-primary/5 border-primary/20 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3'>
          <p className='text-sm'>
            {t(
              'Create an API key and it fills in here automatically. Name, group and limits can be changed later.'
            )}
          </p>
          <Button variant='outline' size='sm' render={<Link to='/keys' />}>
            <KeyRound data-icon='inline-start' />
            {t('Create with custom settings')}
          </Button>
        </div>
      )}

      <div className='flex flex-col gap-2.5 border-t pt-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5'>
          <span className='text-muted-foreground shrink-0 text-xs'>
            {t('Check the connection')}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={handleCopyVerify}
            className='bg-muted/40 max-w-full min-w-0 font-mono text-xs'
            aria-label={`${t('Copy')}: ${verifyCommand}`}
          >
            <span className='truncate'>{verifyCommand}</span>
            {copied === 'verify' ? (
              <Check className='text-success' data-icon='inline-end' />
            ) : (
              <Copy className='text-muted-foreground' data-icon='inline-end' />
            )}
          </Button>
        </div>
        {activeClient === 'claude-code' && (
          <p className='text-muted-foreground flex items-start gap-1.5 text-xs leading-relaxed text-pretty'>
            <TriangleAlert
              className='text-warning mt-0.5 size-3.5 shrink-0'
              aria-hidden
            />
            {t(
              'Unset ANTHROPIC_API_KEY and run /logout first if you signed in to claude.ai.'
            )}
          </p>
        )}
      </div>
    </div>
  )
}
