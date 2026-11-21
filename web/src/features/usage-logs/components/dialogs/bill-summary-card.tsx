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

import { toIntlLocale } from '@/i18n/languages'
import { formatLogQuota } from '@/lib/format'

import { getCacheWriteTtl, type ZeroOutputReason } from '../../lib/bill-explain'
import type { CostCheck, CostLine, CostLineKind } from '../../lib/cost-check'
import type { LogOtherData } from '../../types'
import { getZeroOutputText } from '../zero-output-text'
import { DetailSection } from './log-detail-layout'

const CACHE_WRITE_TTL_LABELS: Partial<Record<CostLineKind, string>> = {
  'cache-write-5m': '5-minute cache',
  'cache-write-1h': '1-hour cache',
  'cache-write-12h': '12-hour cache',
}

/**
 * The top of a per-token log's detail: where the charge came from, in the
 * words a customer uses. Each row is a line of the cost check, so the amounts
 * add up to what the table below shows.
 */
export function BillSummaryCard(props: {
  check: CostCheck
  other: LogOtherData | null
  zeroOutput?: ZeroOutputReason | null
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const tokens = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  })
  const multiples = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const percents = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const inputPrice =
    props.check.lines.find((line) => line.kind === 'input')?.unitPriceUSD ?? 0
  const ttl = getCacheWriteTtl(props.other)

  const describe = (line: CostLine): string => {
    const count = tokens.format(line.tokens)
    const relative = inputPrice > 0 ? line.unitPriceUSD / inputPrice : 0
    switch (line.kind) {
      case 'input':
        return t('New input: {{tokens}} tokens at the full input price', {
          tokens: count,
        })
      case 'cache-read':
        return t(
          '{{tokens}} tokens hit the cache, billed at about {{percent}} of the input price',
          { tokens: count, percent: percents.format(relative) }
        )
      case 'output':
        return line.tokens > 0
          ? t('{{tokens}} output tokens', { tokens: count })
          : t('No output, so no output fee')
      default: {
        const lifetime = CACHE_WRITE_TTL_LABELS[line.kind]
        const values = { tokens: count, multiple: multiples.format(relative) }
        return lifetime
          ? t(
              '{{tokens}} tokens newly written to the cache ({{ttl}}), billed at about {{multiple}}× the input price',
              { ...values, ttl: t(lifetime) }
            )
          : t(
              '{{tokens}} tokens newly written to the cache, billed at about {{multiple}}× the input price',
              values
            )
      }
    }
  }

  // Input and output stay when empty so the table adds up; an empty input
  // line has nothing to explain.
  const lines = props.check.lines.filter(
    (line) => line.tokens > 0 || line.kind === 'output'
  )

  return (
    <DetailSection label={t('Why this price')}>
      {props.zeroOutput && (
        <p className='text-xs font-medium'>
          {getZeroOutputText(t, props.zeroOutput)}
          {props.zeroOutput.kind === 'refusal' && (
            <>
              {' '}
              <a
                href='/docs/errors/'
                target='_blank'
                rel='noopener noreferrer'
                className='font-normal underline underline-offset-2'
              >
                {t('Learn more')}
              </a>
            </>
          )}
        </p>
      )}
      <ul className='space-y-1'>
        {lines.map((line) => (
          <li
            key={line.kind}
            className='flex items-start justify-between gap-3 text-xs'
          >
            <span className='min-w-0'>{describe(line)}</span>
            <span className='shrink-0 font-mono tabular-nums'>
              {formatLogQuota(line.subtotal)}
            </span>
          </li>
        ))}
      </ul>
      <div className='border-border/70 flex items-start justify-between gap-3 border-t pt-1.5 text-xs font-semibold'>
        <span>{t('Total Cost')}</span>
        <span className='font-mono tabular-nums'>
          {formatLogQuota(props.check.actual)}
        </span>
      </div>
      {(ttl === '1h' || ttl === 'mixed') && (
        <p className='text-muted-foreground text-xs'>
          {t('Want a 5-minute cache instead? Request header:')}{' '}
          <code className='font-mono'>X-CoreCode-Cache-TTL: 5m</code>{' '}
          <a
            href='/docs/cache/#ttl'
            target='_blank'
            rel='noopener noreferrer'
            className='underline underline-offset-2'
          >
            {t('Learn more')}
          </a>
        </p>
      )}
    </DetailSection>
  )
}
