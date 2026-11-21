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
import { CircleCheck, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { formatLogQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { CostCheck, CostLineKind } from '../../lib/cost-check'
import { DetailSection } from './log-detail-layout'

const LINE_LABELS: Record<CostLineKind, string> = {
  input: 'Input',
  'cache-read': 'Cache Read',
  'cache-write': 'Cache Write',
  'cache-write-5m': 'Cache Write (5m)',
  'cache-write-1h': 'Cache Write (1h)',
  'cache-write-12h': 'Cache Write (12h)',
  output: 'Output',
}

const PRICE_OPTIONS = { digitsLarge: 4, digitsSmall: 6, abbreviate: false }

/** Line-by-line arithmetic of a per-token charge, ending in charged vs expected. */
export function CostCheckSection(props: { check: CostCheck }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const check = props.check
  const matched = check.status === 'match'
  const difference = check.actual - check.expected
  const groupRatio = Intl.NumberFormat(locale, {
    maximumFractionDigits: 4,
  }).format(check.groupRatio)
  // A ratio of 1 leaves nothing to multiply: the base price is the price.
  const hasRatio = check.groupRatio !== 1 && check.groupRatio > 0

  return (
    <DetailSection label={t('Cost check')}>
      <table className='w-full text-xs tabular-nums'>
        <caption className='sr-only'>{t('Cost check')}</caption>
        <thead className='text-muted-foreground'>
          <tr className='[&>th]:pb-1.5 [&>th]:font-normal'>
            <th scope='col' className='text-left'>
              {t('Item')}
            </th>
            <th scope='col' className='text-right'>
              Tokens
            </th>
            <th scope='col' className='text-right'>
              {t('Price / 1M')}
            </th>
            <th scope='col' className='text-right'>
              {t('Subtotal')}
            </th>
          </tr>
        </thead>
        <tbody className='font-mono [&>tr>*]:py-0.5'>
          {check.lines.map((line) => (
            <tr key={line.kind}>
              <th scope='row' className='text-left font-sans font-normal'>
                {t(LINE_LABELS[line.kind])}
              </th>
              <td className='text-right'>
                {line.tokens.toLocaleString(locale)}
              </td>
              <td className='text-right'>
                {formatBillingCurrencyFromUSD(line.unitPriceUSD, PRICE_OPTIONS)}
                {hasRatio && (
                  <span className='text-muted-foreground block text-[11px]'>
                    {formatBillingCurrencyFromUSD(
                      line.unitPriceUSD / check.groupRatio,
                      PRICE_OPTIONS
                    )}{' '}
                    × {groupRatio}
                  </span>
                )}
              </td>
              <td className='text-right'>{formatLogQuota(line.subtotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className='font-mono [&>tr>*]:pt-1.5'>
          <tr className='border-border/70 border-t'>
            <th
              scope='row'
              colSpan={3}
              className='text-muted-foreground text-left font-sans font-normal'
            >
              {t('Expected at listed prices')}
            </th>
            <td className='text-right'>{formatLogQuota(check.expected)}</td>
          </tr>
          <tr>
            <th
              scope='row'
              colSpan={3}
              className='text-left font-sans font-medium'
            >
              {t('Charged')}
            </th>
            <td className='text-right font-semibold'>
              {formatLogQuota(check.actual)}
            </td>
          </tr>
        </tfoot>
      </table>

      {hasRatio && (
        <p className='text-muted-foreground pt-1 text-xs'>
          {t('Price = base price × group ratio ({{ratio}}×)', {
            ratio: groupRatio,
          })}
        </p>
      )}
      <p
        className={cn(
          'flex items-start gap-1.5 pt-1 text-xs',
          matched ? 'text-success' : 'text-muted-foreground'
        )}
      >
        {matched ? (
          <CircleCheck className='mt-px size-3.5 shrink-0' aria-hidden />
        ) : (
          <Info className='mt-px size-3.5 shrink-0' aria-hidden />
        )}
        <span>
          {matched
            ? t('Matches the listed prices')
            : t(
                'Differs by {{amount}}: the charge includes items this breakdown does not list, such as tool calls.',
                {
                  amount: formatLogQuota(difference),
                }
              )}
        </span>
      </p>
    </DetailSection>
  )
}
