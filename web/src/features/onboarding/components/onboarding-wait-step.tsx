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
 * CoreCode fork: step 3 of the onboarding wizard, waiting for the first
 * request. It reads `/api/user/self` every few seconds and turns green when
 * the account's request count rises above what it was when the wizard opened.
 * It stops after ten minutes, and when the wizard closes, which unmounts it.
 *
 * The payload is read directly rather than through `useSelf`: that merges into
 * the auth store, and a store that stops looking like a first run would unmount
 * the overview's wizard host before the customer saw the green state.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Check, Copy, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { buildVerifyCommand } from '@/features/keys/lib/client-setup'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useStatus } from '@/hooks/use-status'
import { getSelf } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { isClaudeCodeClient, type OnboardingClient } from '../lib/onboarding'
import { FundingNotice } from './funding-notice'

export const ONBOARDING_POLL_MS = 4000
export const ONBOARDING_POLL_TIMEOUT_MS = 10 * 60 * 1000

export function OnboardingWaitStep(props: {
  client: OnboardingClient
  /** The account's request count when the wizard opened. */
  baselineRequests: number
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const [round, setRound] = useState(0)
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setExpired(false)
    const timer = window.setTimeout(
      () => setExpired(true),
      ONBOARDING_POLL_TIMEOUT_MS
    )
    return () => window.clearTimeout(timer)
  }, [round])

  const [received, setReceived] = useState(false)
  const poll = useQuery({
    queryKey: ['onboarding', 'request-count', round],
    queryFn: async () => {
      const user = requireServerSuccess(await getSelf()).data as {
        request_count?: number
      }
      return Number(user?.request_count ?? 0)
    },
    refetchInterval: received || expired ? false : ONBOARDING_POLL_MS,
    // The customer is in a terminal while this tab is in the background.
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    meta: { errorToast: false },
  })
  const count = poll.data ?? props.baselineRequests
  const done = received || count > props.baselineRequests
  useEffect(() => {
    if (done) setReceived(true)
  }, [done])

  const docsLink =
    typeof status?.docs_link === 'string' && status.docs_link.trim()
      ? status.docs_link.trim()
      : '/docs/'
  const verifyCommand = isClaudeCodeClient(props.client)
    ? buildVerifyCommand('claude-code', '', t('Reply with ok'))
    : null

  if (done) {
    return (
      <div className='flex flex-col gap-3'>
        <p
          role='status'
          className='bg-success/10 text-success border-border/50 flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm font-medium'
        >
          <Check className='size-4 shrink-0' aria-hidden />
          {t('First request received ✓')}
        </p>
        <p className='text-muted-foreground text-sm'>
          {t(
            'You are connected. Check prices for every model, or read the guides for your tools.'
          )}
        </p>
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' render={<Link to='/pricing' />}>
            {t('See pricing')}
            <ArrowRight data-icon='inline-end' />
          </Button>
          <Button
            size='sm'
            variant='outline'
            render={<a href={docsLink} target='_blank' rel='noreferrer' />}
          >
            <BookOpen data-icon='inline-start' />
            {t('Docs')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <FundingNotice />
      <div
        role='status'
        className='bg-muted/40 flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm'
      >
        {expired ? null : (
          <Loader2
            className='text-muted-foreground mt-0.5 size-4 shrink-0 animate-spin'
            aria-hidden
          />
        )}
        <div className='flex flex-col gap-2'>
          <span className='font-medium'>
            {expired
              ? t('Still no request. Check the config, then keep waiting.')
              : t('Waiting for your first request…')}
          </span>
          <span className='text-muted-foreground text-xs'>
            {verifyCommand
              ? t(
                  'Open a new terminal and run this, or just start Claude Code.'
                )
              : t('Send any message from your client.')}
          </span>
          {verifyCommand && (
            <Button
              variant='outline'
              size='sm'
              className='bg-background max-w-full min-w-0 self-start font-mono text-xs'
              aria-label={`${t('Copy')}: ${verifyCommand}`}
              onClick={async () => {
                if (!(await copyToClipboard(verifyCommand))) return
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1800)
              }}
            >
              <span className='truncate'>{verifyCommand}</span>
              {copied ? (
                <Check className='text-success' data-icon='inline-end' />
              ) : (
                <Copy
                  className='text-muted-foreground'
                  data-icon='inline-end'
                />
              )}
            </Button>
          )}
          {expired && (
            <div className='flex flex-wrap gap-2'>
              <Button size='sm' onClick={() => setRound((value) => value + 1)}>
                {t('Keep waiting')}
              </Button>
              <Button
                size='sm'
                variant='outline'
                render={<a href={docsLink} target='_blank' rel='noreferrer' />}
              >
                {t('Docs')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
