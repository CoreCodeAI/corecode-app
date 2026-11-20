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
 * CoreCode fork: each transfer the deposit service has seen, followed from
 * detected to confirmed to credited while the dialog is open.
 */
import {
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { formatCurrencyFromUSD } from '@/lib/currency'
import { cn } from '@/lib/utils'

import {
  chainDepositSteps,
  chainDepositTxUrl,
  type ChainDepositStepState,
} from '../../lib/chain-deposit'
import type { ChainDepositNetwork, ChainDepositTransfer } from '../../types'

const STEP_IDS = ['detected', 'confirmed', 'credited'] as const

interface ChainDepositProgressProps {
  transfers: ChainDepositTransfer[]
  networks: ChainDepositNetwork[]
}

export function ChainDepositProgress({
  transfers,
  networks,
}: ChainDepositProgressProps) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('Deposit progress')} className='space-y-2'>
      {transfers.map((transfer, index) => (
        <TransferProgress
          key={`${transfer.network}:${transfer.tx_hash}:${transfer.token}:${transfer.amount}`}
          transfer={transfer}
          chainId={
            networks.find((network) => network.network === transfer.network)
              ?.chain_id
          }
          announce={index === 0}
        />
      ))}
    </section>
  )
}

function TransferProgress({
  transfer,
  chainId,
  announce,
}: {
  transfer: ChainDepositTransfer
  chainId: number | undefined
  /** The newest transfer's stage is read out as it changes */
  announce: boolean
}) {
  const { t } = useTranslation()
  const states = chainDepositSteps(transfer.stage)
  const txUrl = chainId ? chainDepositTxUrl(chainId, transfer.tx_hash) : null
  const credited = transfer.stage === 'credited'
  const labels = [
    t('Transfer detected'),
    states[1] === 'done' ? t('Confirmed on chain') : t('Confirming on chain'),
    credited ? t('Credited to your wallet') : t('Crediting to your wallet'),
  ]
  let current = labels[2]
  if (states[1] === 'active') current = labels[1]

  let note: string | null = null
  if (transfer.stage === 'waiting') {
    note = t('Under 1 USD: credited once your deposits add up to 1 USD.')
    current = note
  } else if (credited && transfer.credited) {
    note = transfer.bonus
      ? t('Credited {{amount}} + bonus {{bonus}}', {
          amount: formatCurrencyFromUSD(transfer.credited),
          bonus: formatCurrencyFromUSD(transfer.bonus),
        })
      : t('Credited {{amount}}', {
          amount: formatCurrencyFromUSD(transfer.credited),
        })
  } else if (!credited) {
    note = t('Usually takes a few seconds')
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        credited ? 'border-success/40' : 'border-primary/40'
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <div className='min-w-0 text-sm'>
          <span className='font-semibold tabular-nums'>
            {transfer.amount} {transfer.token}
          </span>
          <span className='text-muted-foreground'>
            {' · '}
            {transfer.network_name}
          </span>
        </div>
        {txUrl && (
          <a
            href={txUrl}
            target='_blank'
            rel='noopener noreferrer'
            title={t('View the transaction on the block explorer')}
            aria-label={t('View the transaction on the block explorer')}
            className='text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 font-mono text-xs transition-colors'
          >
            {transfer.tx_hash.slice(0, 6)}…{transfer.tx_hash.slice(-4)}
            <ExternalLink className='h-3 w-3' aria-hidden />
          </a>
        )}
      </div>
      <ol className='mt-3 grid grid-cols-3 gap-2'>
        {labels.map((label, step) => (
          <li
            key={STEP_IDS[step]}
            className='flex flex-col items-center gap-1 text-center'
          >
            <StepIcon state={states[step]} />
            <span
              className={cn(
                'text-xs',
                states[step] === 'pending'
                  ? 'text-muted-foreground'
                  : 'font-medium'
              )}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>
      {note && (
        <div
          className={cn(
            'mt-2 border-t pt-2 text-center text-xs tabular-nums',
            credited ? 'text-success font-medium' : 'text-muted-foreground'
          )}
        >
          {note}
        </div>
      )}
      {announce && (
        <p role='status' aria-atomic='true' className='sr-only'>
          {`${transfer.amount} ${transfer.token}: ${current}`}
        </p>
      )}
    </div>
  )
}

function StepIcon({ state }: { state: ChainDepositStepState }) {
  switch (state) {
    case 'done':
      return <CheckCircle2 className='text-success h-5 w-5' aria-hidden />
    case 'active':
      return (
        <Loader2 className='text-primary h-5 w-5 animate-spin' aria-hidden />
      )
    case 'held':
      return <Clock className='text-muted-foreground h-5 w-5' aria-hidden />
    case 'pending':
      return <Circle className='text-muted-foreground h-5 w-5' aria-hidden />
  }
}
