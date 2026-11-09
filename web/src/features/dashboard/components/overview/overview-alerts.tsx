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
 * CoreCode fork: the two things a Claude Code customer should act on before
 * they hurt — a balance about to run out (requests then fail with 403), and
 * long requests that paid to rewrite their whole context into the cache.
 */
import { Link } from '@tanstack/react-router'
import { ArrowRight, DatabaseZap, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { BalanceHealth } from '../../hooks/use-balance-status'
import type { RecentUsageSummary } from '../../lib/customer-overview'

export function OverviewAlerts(props: {
  balanceHealth: BalanceHealth
  runwayDays: number | null
  recent: RecentUsageSummary
  /** A first-run account has the checklist instead of a balance alert. */
  firstRun?: boolean
}) {
  const { t } = useTranslation()
  const lowBalance =
    (props.balanceHealth === 'low' || props.balanceHealth === 'empty') &&
    !props.firstRun
  const misses = props.recent.costlyMisses
  // Mostly non-streaming misses point at auto mode's classifier rather than
  // the session-level causes listed by default.
  const mostlyNonStream = props.recent.nonStreamMisses * 2 > misses
  if (!lowBalance && misses === 0) return null

  return (
    <div className='flex flex-col gap-3'>
      {lowBalance && (
        <Alert
          className={cn(
            'border-warning/40 bg-warning/8',
            props.balanceHealth === 'empty' &&
              'border-destructive/40 bg-destructive/8'
          )}
        >
          <WalletCards
            className={cn(
              props.balanceHealth === 'empty'
                ? 'text-destructive'
                : 'text-warning'
            )}
          />
          <AlertTitle>
            {props.balanceHealth === 'empty'
              ? t('Your balance has run out')
              : t('Your balance runs out in about {{days}} days', {
                  days: Math.max(1, Math.floor(props.runwayDays ?? 1)),
                })}
          </AlertTitle>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
            <span>
              {t(
                'Claude Code requests fail with 403 once the balance is empty. Add credits to keep sessions running.'
              )}
            </span>
            <Button size='sm' render={<Link to='/wallet' />}>
              {t('Add credits')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {misses > 0 && (
        <Alert className='border-warning/40 bg-warning/8'>
          <DatabaseZap className='text-warning' />
          <AlertTitle>
            {t(
              '{{count}} long requests missed the cache, charged {{amount}} in total',
              {
                count: misses,
                amount: formatQuota(props.recent.costlyMissQuota),
              }
            )}
          </AlertTitle>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
            <span>
              {mostlyNonStream
                ? t(
                    'Among the last {{count}} requests. Most of these did not stream, which matches Claude Code auto mode: before a tool call, its classifier sends the conversation to the model to decide whether to allow it, and little of that is cached. If auto mode is on (--permission-mode auto or Shift+Tab), this is its normal cost, not a relay fault.',
                    { count: props.recent.requests }
                  )
                : t(
                    'Among the last {{count}} requests. A long context that misses the cache is written again at full price. Usual causes: a new session or switching models mid-session.',
                    { count: props.recent.requests }
                  )}
              {mostlyNonStream && (
                <>
                  {' '}
                  <a
                    href='/docs/cache/#auto-mode'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='underline underline-offset-2'
                  >
                    {t('Learn more')}
                  </a>
                </>
              )}
            </span>
            <Button
              variant='outline'
              size='sm'
              render={
                <Link
                  to='/usage-logs/$section'
                  params={{ section: 'common' }}
                />
              }
            >
              {t('Usage Logs')}
              <ArrowRight data-icon='inline-end' />
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
