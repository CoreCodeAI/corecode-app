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
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, Gift, Loader2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyFromUSD } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'

import {
  checkChainDeposit,
  getChainDepositAddress,
  getChainDepositQuote,
  isApiSuccess,
} from '../../api'
import { bonusRateToPercent } from '../../lib/bonus'
import {
  chainDepositTokenUrl,
  splitDepositAddress,
  usableChainDepositNetworks,
} from '../../lib/chain-deposit'
import { formatChargeMoney } from '../../lib/format'

// What the server answers to a refused check. The console translates a server
// message by its text, so the texts are named here, in the wallet's own chunk,
// rather than loaded with every core page.
const CHAIN_DEPOSIT_CHECK_REFUSALS = [
  'No deposit address yet. Open the deposit address first.',
  'Checked a moment ago. Try again in a few seconds.',
] as const

interface ChainDepositDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The amount picked in the wallet, priced as an estimate */
  amount: number
  /** Called after the deposit service has read the address, to refresh the balance */
  onChecked?: () => void
}

/**
 * The customer's own deposit address, the networks and tokens it accepts, and
 * the "I've sent it" button. It asks for no amount: whatever arrives is
 * credited. The amount picked in the wallet is shown as an estimate of what to
 * send, with the least transfer that keeps its bonus.
 */
export function ChainDepositDialog({
  open,
  onOpenChange,
  amount,
  onChecked,
}: ChainDepositDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const addressQuery = useQuery({
    queryKey: ['chain-deposit-address'],
    enabled: open,
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await getChainDepositAddress()
      if (!isApiSuccess(response) || !response.data?.address) {
        handleServerError(response, t('Failed to get the deposit address'))
        throw new Error('no deposit address')
      }
      return response.data
    },
  })

  // An estimate only: a failed quote hides it and leaves the address usable.
  const quoteQuery = useQuery({
    queryKey: ['chain-deposit-quote', amount],
    enabled: open && amount > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const response = await getChainDepositQuote(amount)
      if (!isApiSuccess(response) || !response.data?.usd) {
        throw new Error('no quote')
      }
      return response.data
    },
  })
  const quote = quoteQuery.data

  const check = useMutation({
    mutationFn: async () => {
      const response = await checkChainDeposit()
      if (!isApiSuccess(response)) {
        const refusal = CHAIN_DEPOSIT_CHECK_REFUSALS.find(
          (text) => text === response.data
        )
        handleServerError(
          response,
          refusal ? t(refusal) : t('Failed to check the deposit')
        )
        return false
      }
      return true
    },
    onSuccess: (checked) => {
      if (!checked) return
      toast.success(
        t('Checked. Your balance updates once the transfer is credited.')
      )
      onChecked?.()
    },
  })

  const address = addressQuery.data
  const networks = usableChainDepositNetworks(address?.networks)
  const addressParts = address ? splitDepositAddress(address.address) : null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('On-chain deposit (USDT/USDC)')}
      description={t(
        'Send USDT or USDC to your own deposit address. No amount is needed: whatever arrives is credited.'
      )}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-[520px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      footer={
        <>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('Close')}
          </Button>
          <Button
            onClick={() => check.mutate()}
            disabled={!address || check.isPending}
          >
            {check.isPending && (
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            )}
            {t("I've sent it")}
          </Button>
        </>
      }
    >
      {addressQuery.isPending && (
        <div className='flex items-center justify-center py-10'>
          <Loader2 className='h-5 w-5 animate-spin' />
        </div>
      )}

      {addressQuery.isError && (
        <div className='space-y-3 py-4'>
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Failed to get the deposit address')}
            </AlertDescription>
          </Alert>
          <Button variant='outline' onClick={() => addressQuery.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      )}

      {address && (
        <div className='space-y-4 py-2'>
          {quote && (
            <div className='rounded-lg border p-4'>
              <div className='flex items-center justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <div className='text-muted-foreground text-xs'>
                    {t('Top-up amount')}
                  </div>
                  <div className='text-2xl font-semibold tabular-nums'>
                    {formatChargeMoney(quote.money, locale)}
                  </div>
                  <div className='text-muted-foreground text-xs tabular-nums'>
                    {quote.bonus_rate > 0
                      ? t('Credited {{amount}} + bonus {{bonus}}', {
                          amount: formatCurrencyFromUSD(quote.amount),
                          bonus: formatCurrencyFromUSD(
                            quote.amount * quote.bonus_rate
                          ),
                        })
                      : t('Credited {{amount}}', {
                          amount: formatCurrencyFromUSD(quote.amount),
                        })}
                  </div>
                </div>
                <ArrowRight
                  className='text-muted-foreground h-5 w-5 shrink-0'
                  aria-hidden
                />
                <div className='min-w-0 space-y-1 text-right'>
                  <div className='text-muted-foreground text-xs'>
                    {t('Amount to send')}
                  </div>
                  <div className='text-primary text-2xl font-semibold tabular-nums'>
                    {quote.usd}
                  </div>
                  <div className='text-muted-foreground text-xs'>
                    USDT / USDC
                  </div>
                </div>
              </div>
              <div className='mt-3 space-y-1.5 border-t pt-3 text-xs'>
                {quote.bonus_rate > 0 && quote.bonus_usd && (
                  <div className='flex items-start gap-2'>
                    <Gift
                      className='text-primary mt-0.5 h-3.5 w-3.5 shrink-0'
                      aria-hidden
                    />
                    <span>
                      {quote.lower_rate > 0
                        ? t(
                            'Send at least {{usd}} USDT or USDC in one transfer to get the {{percent}}% bonus. Less than that gets the lower tier, {{lower}}%.',
                            {
                              usd: quote.bonus_usd,
                              percent: bonusRateToPercent(quote.bonus_rate),
                              lower: bonusRateToPercent(quote.lower_rate),
                            }
                          )
                        : t(
                            'Send at least {{usd}} USDT or USDC in one transfer to get the {{percent}}% bonus. Less than that gets no bonus.',
                            {
                              usd: quote.bonus_usd,
                              percent: bonusRateToPercent(quote.bonus_rate),
                            }
                          )}
                    </span>
                  </div>
                )}
                <div className='text-muted-foreground'>
                  {t(
                    'What arrives is counted: when withdrawing from an exchange, add its fee on top.'
                  )}
                </div>
              </div>
            </div>
          )}

          <div className='flex flex-col items-center gap-3'>
            <div className='rounded-lg bg-white p-3'>
              <QRCodeSVG value={address.address} size={160} />
            </div>
            <div className='flex w-full items-center justify-center gap-2'>
              <code className='bg-muted rounded-md px-3 py-2 text-center font-mono text-sm break-all sm:text-base'>
                <span className='text-primary font-semibold'>
                  {addressParts?.head}
                </span>
                <span className='text-muted-foreground'>
                  {addressParts?.middle}
                </span>
                <span className='text-primary font-semibold'>
                  {addressParts?.tail}
                </span>
              </code>
              <CopyButton
                value={address.address}
                variant='outline'
                tooltip={t('Copy address')}
                aria-label={t('Copy address')}
              />
            </div>
          </div>

          <Alert variant='destructive'>
            <AlertDescription>
              <ul className='list-inside list-disc space-y-1'>
                <li>
                  {t(
                    'Send only on BNB Smart Chain (BEP-20) or Arbitrum One. Other networks are not supported.'
                  )}
                </li>
                <li>
                  {t(
                    'Send only the tokens listed below. Tokens on other chains are not credited automatically.'
                  )}
                </li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className='divide-y rounded-lg border text-sm'>
            {networks.map((network) => (
              <div
                key={network.network}
                className='flex items-center justify-between gap-2 px-3 py-2'
              >
                <span className='font-medium'>{network.name}</span>
                <span className='flex flex-wrap justify-end gap-1.5'>
                  {network.tokens.map((token) => {
                    const url = chainDepositTokenUrl(
                      network.chain_id,
                      token.contract
                    )
                    if (!url) {
                      return (
                        <span
                          key={token.contract}
                          className='text-muted-foreground text-xs'
                        >
                          {token.symbol}
                        </span>
                      )
                    }
                    const label = t(
                      'View the {{symbol}} contract on the block explorer',
                      { symbol: token.symbol }
                    )
                    return (
                      <a
                        key={token.contract}
                        href={url}
                        target='_blank'
                        rel='noopener noreferrer'
                        title={label}
                        aria-label={label}
                        className='hover:bg-muted inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors'
                      >
                        {token.symbol}
                        <ExternalLink className='h-3 w-3' aria-hidden />
                      </a>
                    )
                  })}
                </span>
              </div>
            ))}
          </div>

          <ul className='text-muted-foreground list-inside list-disc space-y-1 text-xs'>
            <li>
              {t(
                'Any amount of at least 1 USD is credited at the wallet rate, with the usual top-up bonus. A smaller amount waits until your deposits add up to 1 USD.'
              )}
            </li>
            <li>
              {t(
                'Deposits on both networks are usually credited within a minute of the transfer.'
              )}
            </li>
            <li>
              {t(
                'After sending, press the button below to have the address checked right away.'
              )}
            </li>
          </ul>
        </div>
      )}
    </Dialog>
  )
}
