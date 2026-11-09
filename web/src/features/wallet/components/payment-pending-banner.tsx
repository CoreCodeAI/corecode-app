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
import { Loader2, Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import type { PaymentWaitStatus } from '../hooks/use-payment-confirmation'

interface PaymentPendingBannerProps {
  status: PaymentWaitStatus
  onOpenBilling: () => void
  onDismiss: () => void
}

/** Shown after a payment is handed off, until credit arrives or the wait ends. */
export function PaymentPendingBanner(props: PaymentPendingBannerProps) {
  const { t } = useTranslation()
  if (props.status === 'idle') return null
  const waiting = props.status === 'waiting'

  return (
    <Alert role='status' aria-live='polite'>
      {waiting ? (
        <Loader2 className='animate-spin' aria-hidden />
      ) : (
        <Receipt aria-hidden />
      )}
      <AlertTitle>
        {waiting
          ? t('Waiting for your payment')
          : t('Still waiting for your payment?')}
      </AlertTitle>
      <AlertDescription>
        <p>
          {waiting
            ? t(
                'Finish paying in the other tab. Your balance updates here as soon as the payment arrives.'
              )
            : t(
                'Some payments take a few minutes to arrive. Check Order History for its status; your balance updates on its own once it is credited.'
              )}
        </p>
        <div className='mt-2 flex flex-wrap gap-2'>
          {!waiting && (
            <Button size='sm' variant='outline' onClick={props.onOpenBilling}>
              {t('Open Order History')}
            </Button>
          )}
          <Button size='sm' variant='ghost' onClick={props.onDismiss}>
            {t('Dismiss')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
