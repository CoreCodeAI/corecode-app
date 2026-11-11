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
import { CircleCheck, Hourglass, ReceiptText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { toIntlLocale } from '@/i18n/languages'

import { formatInvoiceAmount } from '../lib/amount'
import type { InvoiceSummary as Summary } from '../types'

/** What the customer can invoice, has in progress, and has had issued. */
export function InvoiceSummary(props: {
  summary?: Summary
  loading: boolean
  error: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const cards = [
    {
      key: 'available',
      title: t('Invoiceable amount'),
      icon: ReceiptText,
      tone: 'accent-1' as const,
      amount: props.summary?.available,
      description: 'Orders: {{count}}',
    },
    {
      key: 'processing',
      title: t('Processing amount'),
      icon: Hourglass,
      tone: 'accent-2' as const,
      amount: props.summary?.processing,
      description: 'Applications: {{count}}',
    },
    {
      key: 'issued',
      title: t('Invoiced amount'),
      icon: CircleCheck,
      tone: 'accent-3' as const,
      amount: props.summary?.issued,
      description: 'Applications: {{count}}',
    },
  ]
  return (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
      {cards.map((card) => (
        <div
          key={card.key}
          className='bg-card rounded-xl border px-3 py-2.5 sm:p-4'
        >
          <StatCard
            title={card.title}
            value={formatInvoiceAmount(card.amount?.cents ?? 0, locale)}
            description={t(card.description, {
              count: card.amount?.count ?? 0,
            })}
            icon={card.icon}
            tone={card.tone}
            loading={props.loading}
            error={props.error}
            details={[]}
          />
        </div>
      ))}
    </div>
  )
}
