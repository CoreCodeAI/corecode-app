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
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { OfficialComponentStatus, OfficialStatus } from '../types'

/** Each vendor page's key in the platform filter, and its logo. */
const OFFICIAL_VENDOR: Record<
  OfficialStatus['vendor'],
  { key: string; icon: string }
> = {
  anthropic: { key: 'Anthropic', icon: 'Claude.Color' },
  openai: { key: 'OpenAI', icon: 'OpenAI.Color' },
}

const STATE_VARIANT: Record<OfficialStatus['state'], StatusVariant> = {
  ok: 'success',
  maintenance: 'warning',
  degraded: 'warning',
  outage: 'danger',
}

const COMPONENT_DOT: Record<OfficialComponentStatus, string> = {
  operational: 'bg-success',
  under_maintenance: 'bg-warning',
  degraded_performance: 'bg-warning',
  partial_outage: 'bg-destructive',
  major_outage: 'bg-destructive',
}

function OfficialLink(props: { href: string }) {
  const { t } = useTranslation()
  return (
    <a
      href={props.href}
      target='_blank'
      rel='noopener noreferrer'
      className='inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap hover:underline'
    >
      {t('View official status')}
      <ExternalLink className='size-3' aria-hidden />
    </a>
  )
}

/**
 * The vendors' own status pages: a banner for each one in trouble, so a
 * customer can tell an upstream fault from ours, and a row with each
 * vendor's state. Nothing shows while every vendor is normal. `vendor` is
 * the platform filter's key, or null for all.
 */
export function OfficialStatusPanel(props: {
  entries: OfficialStatus[]
  vendor: string | null
}) {
  const { t } = useTranslation()
  const entries = props.entries.filter(
    (entry) => OFFICIAL_VENDOR[entry.vendor] && STATE_VARIANT[entry.state]
  )
  if (entries.every((entry) => entry.state === 'ok')) return null
  const stateLabel: Record<OfficialStatus['state'], string> = {
    ok: t('Normal'),
    maintenance: t('Maintenance'),
    degraded: t('Degraded'),
    outage: t('Outage'),
  }
  const componentLabel: Record<OfficialComponentStatus, string> = {
    operational: t('Normal'),
    under_maintenance: t('Under maintenance'),
    degraded_performance: t('Degraded performance'),
    partial_outage: t('Partial outage'),
    major_outage: t('Major outage'),
  }
  const alerts = entries.filter(
    (entry) =>
      entry.state !== 'ok' &&
      (props.vendor === null ||
        OFFICIAL_VENDOR[entry.vendor].key === props.vendor)
  )

  return (
    <section
      aria-label={t('Official upstream status')}
      className='flex flex-col gap-3'
    >
      {alerts.length > 0 && (
        <div role='status' className='flex flex-col gap-3'>
          {alerts.map((entry) => {
            const incident = entry.incidents[0]
            const broken = entry.components
              .filter((component) => component.status !== 'operational')
              .map(
                (component) =>
                  `${component.name} ${componentLabel[component.status] ?? component.status}`
              )
            const detail =
              [broken.join(t(', ')), incident?.name]
                .filter(Boolean)
                .join(' · ') || entry.description
            return (
              <div
                key={entry.vendor}
                className={cn(
                  'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-3',
                  entry.state === 'outage'
                    ? 'border-destructive/30 bg-destructive/10 text-destructive'
                    : 'border-warning/30 bg-warning/10 text-warning'
                )}
              >
                <span aria-hidden className='flex shrink-0'>
                  {getLobeIcon(OFFICIAL_VENDOR[entry.vendor].icon, 20)}
                </span>
                <p className='min-w-0 flex-1 basis-60 text-sm leading-relaxed'>
                  <span className='font-semibold'>
                    {t(
                      '{{vendor}} official status is abnormal (not a CoreCode issue):',
                      { vendor: entry.name }
                    )}
                  </span>{' '}
                  <span className='text-foreground/80'>{detail}</span>
                </p>
                <OfficialLink href={incident?.url || entry.url} />
              </div>
            )
          })}
        </div>
      )}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        {entries.map((entry) => (
          <div
            key={entry.vendor}
            className='bg-card flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-4 py-3'
          >
            <span aria-hidden className='flex shrink-0'>
              {getLobeIcon(OFFICIAL_VENDOR[entry.vendor].icon, 20)}
            </span>
            <div className='flex min-w-0 flex-1 basis-48 flex-col gap-1'>
              <div className='flex items-center gap-2 text-sm font-semibold'>
                {entry.name}
                <StatusBadge
                  label={stateLabel[entry.state]}
                  variant={STATE_VARIANT[entry.state]}
                  showDot
                  copyable={false}
                />
              </div>
              <ul className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs'>
                {entry.components.map((component) => (
                  <li
                    key={component.name}
                    className='flex items-center gap-1.5'
                    title={componentLabel[component.status]}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        COMPONENT_DOT[component.status] ?? 'bg-warning'
                      )}
                    />
                    {component.name}
                  </li>
                ))}
              </ul>
            </div>
            <span className='text-muted-foreground flex'>
              <OfficialLink href={entry.url} />
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
