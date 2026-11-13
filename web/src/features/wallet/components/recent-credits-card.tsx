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
 * CoreCode fork: every credit added to the account — a redemption code, a
 * payment, or an operator's top-up — in one short list, so a customer can
 * see that money arrived without opening the usage logs.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CirclePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { PanelWrapper } from '@/features/dashboard/components/ui/panel-wrapper'
import { planTextReader } from '@/features/subscriptions/lib/plan-text'
import { getUserLogs } from '@/features/usage-logs/api'
import { LOG_TYPE_ENUM } from '@/features/usage-logs/constants'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import {
  parseLogOther,
  renderAuditContent,
  renderLogContent,
} from '@/features/usage-logs/lib/format'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative } from '@/lib/format'
import {
  requireServerSuccess,
  translateServerText,
} from '@/lib/server-error-message'

const VISIBLE_CREDITS = 5

export function RecentCreditsCard() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const query = useQuery({
    queryKey: ['wallet', 'recent-credits'],
    queryFn: async () => {
      const result = requireServerSuccess(
        await getUserLogs({
          p: 1,
          page_size: VISIBLE_CREDITS,
          type: LOG_TYPE_ENUM.TOPUP,
        })
      )
      return (result.data?.items ?? []) as UsageLog[]
    },
    staleTime: 30 * 1000,
  })
  const credits = query.data ?? []

  return (
    <PanelWrapper
      title={t('Credit history')}
      description={t('Redemptions, payments and top-ups by the operator.')}
      loading={query.isLoading}
      empty={!query.isLoading && credits.length === 0}
      emptyMessage={t('Credits you add show up here.')}
      height='h-32'
      contentClassName='p-0'
      headerActions={
        <Button
          variant='ghost'
          size='sm'
          render={
            <Link
              to='/usage-logs/$section'
              params={{ section: 'common' }}
              search={{ type: [String(LOG_TYPE_ENUM.TOPUP)] }}
            />
          }
        >
          {t('View all')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      }
    >
      <ul className='divide-border/70 divide-y'>
        {credits.map((log) => {
          const other = parseLogOther(log.other)
          const text =
            renderAuditContent(other, t, planTextReader(t)) ??
            renderLogContent(other, t, planTextReader(t)) ??
            translateServerText(t, log.content)
          return (
            <li
              key={log.id}
              className='flex items-start gap-3 px-4 py-3 sm:px-5'
            >
              <CirclePlus
                className='text-success mt-0.5 size-4 shrink-0'
                aria-hidden
              />
              <span className='min-w-0 flex-1 text-sm break-words'>{text}</span>
              <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                {formatTimestampRelative(log.created_at, 'seconds', locale)}
              </span>
            </li>
          )
        })}
      </ul>
    </PanelWrapper>
  )
}
