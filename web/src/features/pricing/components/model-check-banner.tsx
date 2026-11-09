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
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

// CoreCode fork: corecode-infra's model-trace.py fingerprints every Claude model
// every 3 days and writes this summary of the newest run beside the static docs.
const LATEST_CHECK_URL = '/docs/verify/model-trace/latest.json'

type CheckedModel = {
  model: string
  /** Mean probability, from 0 to 1, that the answers came from a Claude model. */
  claude: number
}

type LatestCheck = { date: string; models: CheckedModel[] }

function isCheckedModel(value: unknown): value is CheckedModel {
  const entry = value as Partial<CheckedModel> & { rounds?: unknown }
  return (
    typeof entry?.model === 'string' &&
    typeof entry.claude === 'number' &&
    typeof entry.rounds === 'number' &&
    entry.rounds > 0
  )
}

/** The newest check, or null when the file is missing or not the shape corecode-infra writes. */
async function getLatestCheck(): Promise<LatestCheck | null> {
  const res = await fetch(LATEST_CHECK_URL, { cache: 'no-cache' })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    date?: unknown
    models?: unknown
  } | null
  if (typeof data?.date !== 'string' || !Array.isArray(data.models)) {
    return null
  }
  const models = data.models.filter(isCheckedModel)
  return models.length > 0 ? { date: data.date, models } : null
}

/**
 * The latest ModelTrace fingerprint check of the Claude models, with a link to
 * the full report. Without a readable summary it keeps only the description
 * and the link.
 */
export function ModelCheckBanner(props: { className?: string }) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language
  const locale = toIntlLocale(language)
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const reportUrl = language.startsWith('zh')
    ? '/docs/verify/#trace'
    : '/docs/en/verify/#trace'
  const { data } = useQuery({
    queryKey: ['pricing', 'model-check'],
    queryFn: getLatestCheck,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })

  return (
    <section
      aria-label={t('Model check')}
      className={cn(
        'bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm',
        props.className
      )}
    >
      <span className='flex items-center gap-1.5 font-medium'>
        <ShieldCheck
          className='size-4 text-emerald-600 dark:text-emerald-400'
          aria-hidden
        />
        {t('Model check')}
      </span>
      {data ? (
        <>
          <span className='text-muted-foreground'>
            {t(
              'Fingerprinted with the open-source ModelTrace every 3 days. Probability each model is Claude on {{date}}:',
              // Non-breaking hyphens keep the date on one line at phone widths.
              { date: data.date.replaceAll('-', '\u2011') }
            )}
          </span>
          <ul className='flex flex-wrap gap-x-3 gap-y-1'>
            {data.models.map((entry) => (
              <li
                key={entry.model}
                className='inline-flex items-center gap-1.5'
              >
                <code className='font-mono text-xs'>{entry.model}</code>
                <span className='font-mono font-semibold tabular-nums'>
                  {percent.format(entry.claude)}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <span className='text-muted-foreground'>
          {t(
            'Every 3 days we fingerprint each Claude model with the open-source ModelTrace and publish the results.'
          )}
        </span>
      )}
      <a
        href={reportUrl}
        className='text-primary ml-auto inline-flex items-center gap-1 font-medium hover:underline'
      >
        {t('View report')}
        <ArrowRight className='size-4' aria-hidden />
      </a>
    </section>
  )
}
