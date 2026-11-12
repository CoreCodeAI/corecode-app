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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useInviteeColumns } from '@/features/invitations/hooks/use-invitee-columns'
import { useCommissionColumns } from '@/features/wallet/components/affiliate-columns'
import { AffiliatePagedTable } from '@/features/wallet/components/affiliate-paged-table'
import { formatPaymentMoney } from '@/features/wallet/lib'
import type { AffiliateTier } from '@/features/wallet/types'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getUserAffiliate,
  getUserAffiliateCommissions,
  getUserAffiliateInvitees,
  updateUserAffiliate,
  updateUserAffiliateAddressExemption,
} from '../../api'
import { UserAffCodeEditor } from './user-aff-code-editor'
import { UserInviterEditor } from './user-inviter-editor'

type UserAffiliateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username: string }
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <div className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
        {props.label}
      </div>
      <div className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

export function UserAffiliateDialog(props: UserAffiliateDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const userId = props.user.id
  const queryKey = ['affiliate', 'admin-user', userId] as const
  const columns = useCommissionColumns()
  const inviteeColumns = useInviteeColumns('')
  const [rate, setRate] = useState('0')
  const [tier, setTier] = useState<AffiliateTier>('')

  const view = useQuery({
    queryKey,
    queryFn: () => getUserAffiliate(userId),
    enabled: props.open,
  })
  const data = view.data

  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRate(String(data.affiliate?.rate ?? 0))
      setTier(data.affiliate?.tier ?? '')
    }
  }, [data])

  const save = useMutation({
    mutationFn: (body: { rate: number; tier: AffiliateTier }) =>
      updateUserAffiliate(userId, body),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      toast.success(t('Invitation settings saved'))
    },
    onError: (error) => handleServerError(error),
  })

  const exemption = useMutation({
    mutationFn: (exempt: boolean) =>
      updateUserAffiliateAddressExemption(userId, exempt),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next)
      toast.success(t('Invitation settings saved'))
    },
    onError: (error) => handleServerError(error),
  })

  const maxRate = data?.max_rate ?? 0
  const parsedRate = Number(rate)
  const rateValid =
    rate.trim() !== '' &&
    Number.isInteger(parsedRate) &&
    parsedRate >= 0 &&
    parsedRate <= maxRate
  const dirty =
    data !== undefined &&
    (parsedRate !== (data.affiliate?.rate ?? 0) ||
      tier !== (data.affiliate?.tier ?? ''))

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Invitation settings')}
      description={props.user.username}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-3xl'
      bodyClassName='space-y-5'
    >
      {data ? (
        <>
          <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
            <Stat
              label={t('Invited by')}
              value={
                data.inviter_id > 0
                  ? `${data.inviter_name} #${data.inviter_id}`
                  : '-'
              }
            />
            <Stat label={t('Invites')} value={String(data.invitee_count)} />
            <Stat
              label={t('Commission balance')}
              value={`${formatQuota(data.affiliate?.balance ?? 0)} (${formatPaymentMoney(data.balance_money)})`}
            />
            <Stat
              label={t('Total Earned')}
              value={`${formatQuota(data.affiliate?.earned ?? 0)} (${formatPaymentMoney(data.earned_money)})`}
            />
          </div>

          <UserAffCodeEditor
            userId={userId}
            view={data}
            onSaved={(next) => queryClient.setQueryData(queryKey, next)}
          />

          <UserInviterEditor
            userId={userId}
            view={data}
            onSaved={(next) => queryClient.setQueryData(queryKey, next)}
          />

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='affiliate-rate'>{t('Commission rate (%)')}</Label>
              <Input
                id='affiliate-rate'
                type='number'
                min={0}
                max={maxRate}
                step={1}
                value={rate}
                aria-invalid={!rateValid}
                onChange={(e) => setRate(e.target.value)}
              />
              <p
                className={
                  rateValid
                    ? 'text-muted-foreground text-xs'
                    : 'text-destructive text-xs'
                }
              >
                {t('Commission rate must be between 0 and {{max}}%', {
                  max: maxRate,
                })}
              </p>
              <p className='text-muted-foreground text-xs'>
                {t('Rate 0 removes invitation rights and blocks re-applying.')}
              </p>
            </div>
            <div className='space-y-2'>
              <Label>{t('Channel type')}</Label>
              <RadioGroup
                value={tier}
                onValueChange={(value) => setTier(value as AffiliateTier)}
              >
                {(
                  [
                    {
                      value: '',
                      label: t('Ordinary inviter'),
                      desc: t(
                        'Commission goes to their own balance. Invitees receive no gift.'
                      ),
                    },
                    {
                      value: 'retail',
                      label: t('Retail channel'),
                      desc: t(
                        'For KOLs and ranking sites. Can withdraw cash; invitees receive the retail gift plan at sign-up. No second-level commission.'
                      ),
                    },
                    {
                      value: 'distributor',
                      label: t('Distributor channel'),
                      desc: t(
                        'For business resellers. Can withdraw cash; invitees receive the distributor gift plan at sign-up; also earns {{rate}}% from users their invitees invite.',
                        { rate: data.second_level_rate }
                      ),
                    },
                  ] as const
                ).map((option) => (
                  <label
                    key={option.value}
                    className='has-data-checked:border-primary flex cursor-pointer items-start gap-3 rounded-lg border p-3'
                  >
                    <RadioGroupItem value={option.value} className='mt-0.5' />
                    <span className='space-y-0.5'>
                      <span className='block text-sm font-medium'>
                        {option.label}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {option.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'>
            <span>
              <span className='block font-medium'>
                {t('Commission from invitees on their network')}
              </span>
              <span
                id='affiliate-address-exemption-description'
                className='text-muted-foreground block'
              >
                {t(
                  'Pays commission on invitees who use the same network as this user, such as their own second account. Leave off unless the discount was agreed.'
                )}
              </span>
            </span>
            <Switch
              checked={data.address_exempt ?? false}
              disabled={exemption.isPending}
              onCheckedChange={(checked) => exemption.mutate(!!checked)}
              aria-label={t('Commission from invitees on their network')}
              aria-describedby='affiliate-address-exemption-description'
            />
          </div>

          <div className='flex justify-end'>
            <Button
              disabled={!rateValid || !dirty || save.isPending}
              onClick={() => save.mutate({ rate: parsedRate, tier })}
            >
              {save.isPending && <Loader2 className='animate-spin' />}
              {t('Save')}
            </Button>
          </div>

          <div className='space-y-2'>
            <h4 className='text-sm font-medium'>{t('Invitees')}</h4>
            <AffiliatePagedTable
              queryKey={['affiliate', 'admin-user-invitees', userId]}
              load={(params) => getUserAffiliateInvitees(userId, params)}
              columns={inviteeColumns}
              emptyTitle={t('No invitees yet')}
              enabled={props.open}
              summary={(page, loading) => (
                <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                  <Stat
                    label={t('Invitee spend')}
                    value={
                      loading ? '-' : formatQuota(page?.totals.used_quota ?? 0)
                    }
                  />
                  <Stat
                    label={t('Commission from invitees')}
                    value={
                      loading ? '-' : formatQuota(page?.totals.commission ?? 0)
                    }
                  />
                </div>
              )}
            />
          </div>

          <div className='space-y-2'>
            <h4 className='text-sm font-medium'>{t('Commission records')}</h4>
            <AffiliatePagedTable
              queryKey={['affiliate', 'admin-user-commissions', userId]}
              load={(params) => getUserAffiliateCommissions(userId, params)}
              columns={columns}
              emptyTitle={t('No commission records yet')}
              enabled={props.open}
            />
          </div>
        </>
      ) : (
        <div className='space-y-3'>
          <Skeleton className='h-10' />
          <Skeleton className='h-24' />
          {view.isError && (
            <p className='text-destructive text-sm'>
              {t('Failed to load invitation settings')}
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}
