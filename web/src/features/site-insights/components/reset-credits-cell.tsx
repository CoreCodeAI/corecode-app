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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Ticket } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { TapTooltip, TapTooltipTrigger } from '@/components/tap-tooltip'
import { Button } from '@/components/ui/button'
import { TooltipContent } from '@/components/ui/tooltip'
import { getServerErrorSources } from '@/lib/server-error-message'

import { consumeResetCredit } from '../api'
import type { EngineAccount, EngineResetCredit } from '../types'

type ResetKind = 'full' | 'partial' | ''

type ResetCreditGroup = {
  kind: ResetKind
  count: number
  /** Expiry in ms (0 without one) to the number of credits that end then. */
  expiries: [number, number][]
}

/** Groups an account's credits by kind, full first; unclassified credits last. */
function groupResetCredits(
  credits: EngineResetCredit[] | undefined
): ResetCreditGroup[] {
  const order: ResetKind[] = ['full', 'partial', '']
  return order
    .map((kind) => {
      const matched = (credits ?? []).filter(
        (credit) => (credit.kind || '') === kind
      )
      const expiries = new Map<number, number>()
      for (const credit of matched) {
        const at = credit.expires_at_ms ?? 0
        expiries.set(at, (expiries.get(at) ?? 0) + 1)
      }
      return { kind, count: matched.length, expiries: [...expiries] }
    })
    .filter((group) => group.count > 0)
}

const LABELS: Record<ResetKind, string> = {
  full: 'Full reset',
  partial: 'Partial reset',
  '': 'Reset',
}

const CLEARS: Record<ResetKind, string> = {
  full: 'Clears the 5-hour and weekly limits.',
  partial:
    'Clears the 5-hour and model weekly limits, not the overall weekly limit.',
  '': 'The provider does not say which limits it clears.',
}

const CONFIRMATIONS: Record<ResetKind, string> = {
  full: "Uses the account's earliest-expiring full reset credit, which clears its 5-hour and weekly limits. This cannot be undone.",
  partial:
    "Uses the account's earliest-expiring partial reset credit, which clears its 5-hour and model weekly limits; the overall weekly limit stays. This cannot be undone.",
  '': "Uses one of the account's reset credits. This cannot be undone.",
}

/** True when the engine could not say whether the credit was used. */
function outcomeUnknown(error: unknown) {
  return getServerErrorSources(error).some(
    (source) => source.code === 'RESET_CREDIT_OUTCOME_UNKNOWN'
  )
}

/**
 * The account's reset credits, one button per kind. Each redemption asks for
 * confirmation and keeps its idempotency key until the engine has answered,
 * so a retry after an unknown outcome checks the same redemption.
 */
export function ResetCreditsCell(props: {
  row: EngineAccount
  at: (ms: number) => string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<ResetKind | null>(null)
  const keys = useRef(new Map<ResetKind, string>())
  const groups = groupResetCredits(props.row.reset_credits)
  const consume = useMutation({
    mutationFn: (kind: ResetKind) => {
      let key = keys.current.get(kind)
      if (!key) {
        key = crypto.randomUUID()
        keys.current.set(kind, key)
      }
      return consumeResetCredit({
        groupId: props.row.group_id,
        credentialId: props.row.credential_id,
        kind,
        idempotencyKey: key,
      })
    },
    onSuccess: (result, kind) => {
      keys.current.delete(kind)
      setPending(null)
      toast.success(
        result.observation_pending
          ? t('Quota reset; the new reading follows shortly.')
          : t('Quota reset')
      )
      queryClient.invalidateQueries({ queryKey: ['site-insights', 'pool'] })
    },
    onError: (error, kind) => {
      if (!outcomeUnknown(error)) {
        keys.current.delete(kind)
        setPending(null)
      }
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })
  if (!groups.length) {
    return <span className='text-muted-foreground'>-</span>
  }
  const label = (kind: ResetKind) => t(LABELS[kind])
  return (
    <span className='flex flex-wrap justify-end gap-1'>
      {groups.map((group) => (
        <TapTooltip key={group.kind || 'other'}>
          <TapTooltipTrigger
            render={
              <Button
                variant='outline'
                size='xs'
                disabled={consume.isPending}
                onClick={() => setPending(group.kind)}
              />
            }
          >
            <Ticket />
            {label(group.kind)} {group.count}
          </TapTooltipTrigger>
          <TooltipContent className='block min-w-52 py-2'>
            <p className='mb-1.5 font-semibold'>{label(group.kind)}</p>
            <p className='mb-1.5 max-w-64 opacity-80'>
              {t(CLEARS[group.kind])}
            </p>
            <ul className='grid gap-0.5 tabular-nums'>
              {group.expiries.map(([expiresAt, count]) => (
                <li key={expiresAt}>
                  {expiresAt
                    ? t('Expires {{time}}', { time: props.at(expiresAt) })
                    : t('No expiry')}
                  {count > 1 && ` ×${count}`}
                </li>
              ))}
            </ul>
          </TooltipContent>
        </TapTooltip>
      ))}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !consume.isPending) setPending(null)
        }}
        title={t('{{kind}} for #{{id}} {{email}}', {
          kind: label(pending ?? ''),
          id: props.row.credential_id,
          email: props.row.email_mask,
        })}
        desc={t(CONFIRMATIONS[pending ?? ''])}
        confirmText={t('Use reset credit')}
        isLoading={consume.isPending}
        handleConfirm={() => pending !== null && consume.mutate(pending)}
      />
    </span>
  )
}
