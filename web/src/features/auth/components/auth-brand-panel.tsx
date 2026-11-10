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
import { Link } from '@tanstack/react-router'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { BrandWordmark } from '@/components/brand-wordmark'
import { SignatureMark } from '@/components/signature-mark'
import { Skeleton } from '@/components/ui/skeleton'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

type AuthBrandMarkProps = {
  className?: string
}

export function AuthBrandMark(props: AuthBrandMarkProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading } = useSystemConfig()

  return (
    <Link
      to='/'
      className={cn(
        'flex w-fit items-center gap-2.5 transition-opacity hover:opacity-80',
        props.className
      )}
    >
      {loading ? (
        <Skeleton className='size-8 rounded-full' />
      ) : (
        <img
          src={logo}
          alt={t('Logo')}
          className='size-8 rounded-full object-cover'
        />
      )}
      {loading ? (
        <Skeleton className='h-6 w-24' />
      ) : (
        <BrandWordmark name={systemName} className='text-xl' />
      )}
    </Link>
  )
}

// Phones never see the brand panel, so this one line carries its promise.
export function AuthMobileTagline({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <p className={cn('text-muted-foreground text-sm', className)}>
      <span>{t('Pure Claude,')}</span> <span>{t('nothing mixed in.')}</span>
    </p>
  )
}

// The same promises as the home page, so a customer arriving from it reads the
// product they just chose rather than an empty form.
export function AuthBrandPanel() {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()

  const points = [
    {
      title: t('Only official Claude'),
      description: t('You pick Opus, Opus answers. No other model stands in.'),
    },
    {
      title: t('Prompt cache that keeps hitting'),
      description: t(
        'Each Claude Code session stays on one account, so long tasks cost less as they run.'
      ),
    },
    {
      title: t('Pay for what you use'),
      description: t(
        "Every request's usage and cost is listed in the console."
      ),
    },
  ]

  return (
    <aside className='bg-foreground text-background dark:bg-sidebar dark:text-sidebar-foreground relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:gap-12 lg:p-12 xl:p-16'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute -top-48 -right-48 size-[560px] rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--chart-1)_32%,transparent),transparent)]'
      />
      {/* The home page's mark, behind the copy: the same C, in signatures. */}
      <SignatureMark className='absolute top-4 -right-12 h-full max-h-96 rounded-full opacity-50' />

      <AuthBrandMark className='relative' />

      <div className='relative max-w-lg space-y-8'>
        <div className='space-y-5'>
          <p className='text-chart-1 font-mono text-xs tracking-[0.2em] uppercase'>
            {systemName} · {t('Claude Code relay')}
          </p>
          <p className='font-serif text-5xl leading-[1.12] font-medium tracking-tight'>
            {t('Pure Claude,')}
            <br />
            <span className='text-chart-1'>{t('nothing mixed in.')}</span>
          </p>
          <p className='text-base leading-relaxed opacity-70'>
            {t(
              'Every request is answered by an official Anthropic Claude account. No model swaps, nothing from anyone else.'
            )}
          </p>
        </div>

        <ul className='grid gap-4'>
          {points.map((point) => (
            <li key={point.title} className='flex gap-3'>
              <Check
                aria-hidden='true'
                className='text-chart-1 mt-0.5 size-4 shrink-0'
              />
              <div className='space-y-0.5'>
                <p className='text-sm font-medium'>{point.title}</p>
                <p className='text-sm opacity-60'>{point.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div
        aria-hidden='true'
        className='relative max-w-lg overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] font-mono text-[13px] leading-6'
      >
        <div className='flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5'>
          <span className='size-2.5 rounded-full bg-white/15' />
          <span className='size-2.5 rounded-full bg-white/15' />
          <span className='size-2.5 rounded-full bg-white/15' />
          <span className='ms-3 text-xs opacity-50'>~/project — claude</span>
        </div>
        <div className='px-4 py-3'>
          <p className='truncate'>
            <span className='opacity-40'>$ </span>export{' '}
            <span className='text-chart-1'>ANTHROPIC_BASE_URL</span>=
            {window.location.origin}
          </p>
          <p>
            <span className='opacity-40'>$ </span>export{' '}
            <span className='text-chart-1'>ANTHROPIC_AUTH_TOKEN</span>
            =sk-••••••••
          </p>
          <p>
            <span className='opacity-40'>$ </span>claude
          </p>
        </div>
      </div>
    </aside>
  )
}
