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
import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useStatus } from '@/hooks/use-status'
import { formatQuota } from '@/lib/format'

import { useAffiliate } from '../hooks/use-affiliate'
import type { UserWalletData } from '../types'
import { AffiliateRecordsDialog } from './dialogs/affiliate-records-dialog'
import { TransferDialog } from './dialogs/transfer-dialog'
import { WithdrawDialog } from './dialogs/withdraw-dialog'

interface AffiliateRewardsCardProps {
  user: UserWalletData | null
  complianceConfirmed?: boolean
  /** Called after quota moved into the wallet balance. */
  onBalanceChange?: () => void
}

type Stat = readonly [label: string, value: string]

function CardShell(props: { children: React.ReactNode }) {
  return (
    <Card data-card-hover='false' className='bg-muted/20 py-0'>
      <CardContent className='grid gap-3 p-3 sm:gap-4 sm:p-4'>
        {props.children}
      </CardContent>
    </Card>
  )
}

function CardTitle(props: {
  title: string
  desc: string
  badges?: React.ReactNode
}) {
  return (
    <div className='flex min-w-0 items-center gap-2.5'>
      <IconBadge tone='chart-3'>
        <Share2 />
      </IconBadge>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <h3 className='truncate text-sm font-semibold'>{props.title}</h3>
          {props.badges}
        </div>
        <p className='text-muted-foreground text-xs'>{props.desc}</p>
      </div>
    </div>
  )
}

function Stats(props: { stats: Stat[] }) {
  return (
    <div className='grid grid-cols-3 gap-1.5 text-center'>
      {props.stats.map(([label, value]) => (
        <div key={label}>
          <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
            {label}
          </div>
          <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

function LegacyRow(props: {
  quota: number
  disabled: boolean
  onTransfer: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <span className='text-muted-foreground text-xs'>
        {t('Earlier referral rewards: {{quota}}', {
          quota: formatQuota(props.quota),
        })}
      </span>
      <Button
        size='sm'
        variant='outline'
        disabled={props.disabled}
        onClick={props.onTransfer}
      >
        {t('Transfer to Balance')}
      </Button>
    </div>
  )
}

export function AffiliateRewardsCard(props: AffiliateRewardsCardProps) {
  const { t } = useTranslation()
  const aff = useAffiliate()
  const { status } = useStatus()
  const [transferOpen, setTransferOpen] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)

  if (aff.loading) {
    return (
      <CardShell>
        <Skeleton className='h-5 w-40' />
        <Skeleton className='h-10 rounded-lg' />
      </CardShell>
    )
  }

  const summary = aff.summary
  const legacyQuota = props.user?.aff_quota ?? 0
  const compliant = props.complianceConfirmed !== false
  const legacyRow =
    legacyQuota > 0 ? (
      <LegacyRow
        quota={legacyQuota}
        disabled={!compliant}
        onTransfer={() => setLegacyOpen(true)}
      />
    ) : null

  const legacyDialog = (
    <TransferDialog
      open={legacyOpen}
      onOpenChange={setLegacyOpen}
      onConfirm={async (quota) => {
        const ok = await aff.transferLegacy(quota)
        if (ok) props.onBalanceChange?.()
        return ok
      }}
      availableQuota={legacyQuota}
      transferring={aff.legacyTransferring}
    />
  )

  // Program closed (or unreachable): only earlier rewards still matter.
  if (!summary?.enabled) {
    if (!legacyRow) return null
    return (
      <CardShell>
        <CardTitle
          title={t('Referral Program')}
          desc={t('Transfer accumulated rewards to your balance anytime.')}
        />
        {legacyRow}
        {legacyDialog}
      </CardShell>
    )
  }

  // Every customer has the default rate while the program is on; no account
  // means the default rate is 0, so the card only explains that.
  const account = summary.affiliate
  if (!account) {
    return (
      <CardShell>
        <CardTitle
          title={t('Invitation commission')}
          desc={t('Invitations are not available for your account.')}
        />
        {legacyRow}
        {legacyDialog}
      </CardShell>
    )
  }

  const canInvite = account.rate > 0 && summary.aff_code !== ''
  // On the bonus reward both sides receive a fixed bonus in the wallet;
  // commission from before stays visible while any is left or was earned.
  const onBonus = account.reward === 'bonus'
  const showCommission = !onBonus || account.earned > 0
  // Payouts are priced like top-ups: one display unit of quota costs `price`.
  const moneyPerQuota =
    ((status?.price as number) || 1) /
    ((status?.quota_per_unit as number) || 500000)
  const stats: Stat[] = [[t('Invites'), String(summary.invitee_count)]]
  if (onBonus) {
    stats.push([
      t('Invite bonuses earned'),
      formatQuota(summary.invite_bonus_earned ?? 0),
    ])
  }
  if (showCommission) {
    stats.push(
      [t('Commission balance'), formatQuota(account.balance)],
      [t('Total Earned'), formatQuota(account.earned)]
    )
  }
  const bonus = formatQuota(summary.invite_bonus_quota ?? 0)
  let desc = t('You earn {{rate}}% of what your invitees pay for and use.', {
    rate: account.rate,
  })
  if (onBonus) {
    desc = t(
      'Friends who sign up with your link get {{bonus}}, and you get {{bonus}} after their first payment.',
      { bonus }
    )
  } else if (account.tier === 'distributor') {
    desc = t(
      'You earn {{rate}}% from your invitees and {{second}}% from the users they invite.',
      { rate: account.rate, second: summary.second_level_rate }
    )
  }

  return (
    <CardShell>
      <CardTitle
        title={t('Invitation commission')}
        desc={
          canInvite
            ? desc
            : t('Invitations are not available for your account.')
        }
        badges={
          <>
            {canInvite && !onBonus && (
              <StatusBadge
                label={t('Rate {{rate}}%', { rate: account.rate })}
                variant='success'
                copyable={false}
              />
            )}
            {canInvite && onBonus && (
              <StatusBadge
                label={t('{{bonus}} each', { bonus })}
                variant='success'
                copyable={false}
              />
            )}
            {account.channel && (
              <StatusBadge
                label={t('Promotion channel')}
                variant='purple'
                copyable={false}
              />
            )}
          </>
        }
      />

      {canInvite && (
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
        </div>
      )}

      <Stats stats={stats} />

      {showCommission && (
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            disabled={!compliant || account.balance <= 0}
            onClick={() => setTransferOpen(true)}
          >
            {t('Transfer to balance')}
          </Button>
          {account.channel && (
            <Button
              size='sm'
              variant='outline'
              disabled={account.balance <= 0}
              onClick={() => setWithdrawOpen(true)}
            >
              {t('Withdraw')}
            </Button>
          )}
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setRecordsOpen(true)}
          >
            {t('Commission records')}
          </Button>
        </div>
      )}
      {!compliant && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Referral reward transfer is disabled until the administrator confirms compliance terms.'
          )}
        </p>
      )}
      {legacyRow}

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        onConfirm={async (quota) => {
          const ok = await aff.transferCommission(quota)
          if (ok) props.onBalanceChange?.()
          return ok
        }}
        availableQuota={account.balance}
        transferring={aff.transferring}
        title={t('Transfer commission')}
        description={t('Move commission to your wallet balance')}
        availableLabel={t('Available commission')}
      />
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        onConfirm={aff.withdraw}
        balance={account.balance}
        moneyPerQuota={moneyPerQuota}
        minMoney={summary.min_withdrawal}
        submitting={aff.withdrawing}
      />
      <AffiliateRecordsDialog
        open={recordsOpen}
        onOpenChange={setRecordsOpen}
        showWithdrawals={account.channel}
      />
      {legacyDialog}
    </CardShell>
  )
}
