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
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAffiliate } from '@/features/wallet/hooks/use-affiliate'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'

import type { InviteeTotals } from '../types'
import { InviteCodeDialog } from './invite-code-dialog'

type InvitationOverviewProps = {
  inviteeCount: number
  totals: InviteeTotals
  loading: boolean
  /** The page also shows second-level commission, so this one is direct */
  secondLevel?: boolean
}

export function InvitationOverview(props: InvitationOverviewProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const aff = useAffiliate()
  const account = aff.summary?.affiliate ?? null

  // On the bonus reward both sides receive a fixed bonus in the wallet, so
  // commission is shown only when some was earned before.
  const onBonus = account?.reward === 'bonus'
  const bonus = formatQuota(aff.summary?.invite_bonus_quota ?? 0)
  const stats: [string, string][] = [
    [t('Invites'), formatNumber(props.inviteeCount, locale)],
    [t('Invitee spend'), formatQuota(props.totals.used_quota)],
  ]
  if (onBonus) {
    stats.push([
      t('Invite bonuses earned'),
      formatQuota(aff.summary?.invite_bonus_earned ?? 0),
    ])
  }
  if (!onBonus || (account?.earned ?? 0) > 0) {
    stats.push(
      [
        props.secondLevel
          ? t('Direct commission')
          : t('Commission from invitees'),
        formatQuota(props.totals.commission),
      ],
      [t('Commission balance'), formatQuota(account?.balance ?? 0)]
    )
  }

  let link: React.ReactNode = (
    <p className='text-muted-foreground text-xs'>
      {t('Invitations are not available for your account.')}
    </p>
  )
  if (aff.loading) {
    link = <Skeleton className='h-9 rounded-lg' />
  } else if (aff.affiliateLink) {
    link = (
      <div className='flex items-center gap-2'>
        <Input
          value={aff.affiliateLink}
          readOnly
          aria-label={t('Referral link')}
          className='border-muted bg-background/70 h-9 min-w-0 flex-1 font-mono text-xs'
        />
        <CopyButton
          value={aff.affiliateLink}
          variant='outline'
          className='bg-background size-9 shrink-0'
          iconClassName='size-4'
          tooltip={t('Copy referral link')}
          aria-label={t('Copy referral link')}
        />
        <InviteCodeDialog code={aff.summary?.aff_code ?? ''} />
      </div>
    )
  }

  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4'>
        {account && account.rate > 0 && (
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge
              label={
                onBonus
                  ? t('{{bonus}} each', { bonus })
                  : t('Rate {{rate}}%', { rate: account.rate })
              }
              variant='success'
              copyable={false}
            />
            {account.channel && (
              <StatusBadge
                label={t('Promotion channel')}
                variant='purple'
                copyable={false}
              />
            )}
          </div>
        )}
        {link}
        {onBonus && account && account.rate > 0 && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Friends who sign up with your link get {{bonus}}, and you get {{bonus}} after their first payment.',
              { bonus }
            )}
          </p>
        )}
        <dl className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
          {stats.map(([label, value]) => (
            <div key={label} className='min-w-0'>
              <dt className='text-muted-foreground truncate text-xs'>
                {label}
              </dt>
              <dd className='mt-0.5 truncate text-base font-semibold tabular-nums'>
                {props.loading ? <Skeleton className='h-6 w-20' /> : value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
