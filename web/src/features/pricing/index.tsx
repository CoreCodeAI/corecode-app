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
import { ArrowRight } from 'lucide-react'
import { lazy, Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { getLobeIcon } from '@/lib/lobe-icon'

import {
  LoadingSkeleton,
  ClaudeCodeEstimator,
  ModelCheckBanner,
  PriceBoard,
} from './components'
import { VIEW_MODES } from './constants'
import { usePricingData } from './hooks/use-pricing-data'
import { usePricingUrlState } from './hooks/use-pricing-url-state'

// The drawer opens on a model click; its code stays out of the page's first load.
const ModelDetailsDrawer = lazy(() =>
  import('./components/model-details').then((m) => ({
    default: m.ModelDetailsDrawer,
  }))
)

export function Pricing() {
  const { t } = useTranslation()
  useDocumentTitle(t('Model Pricing'))
  const url = usePricingUrlState()
  const selectedModelName = url.model

  const {
    models,
    groupRatio,
    usableGroup,
    endpointMap,
    autoGroups,
    isLoading,
    priceRate,
    usdExchangeRate,
  } = usePricingData()

  const selectedModel = useMemo(
    () =>
      selectedModelName
        ? (models || []).find(
            (model) => model.model_name === selectedModelName
          ) || null
        : null,
    [models, selectedModelName]
  )

  if (isLoading) {
    return (
      <PublicLayout showMainContainer={false}>
        <div className='mx-auto w-full max-w-[1400px] px-3 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10 xl:px-8'>
          <LoadingSkeleton viewMode={VIEW_MODES.TABLE} />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <div className='relative'>
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[600px] opacity-20 dark:opacity-[0.10]'
          style={{
            // CoreCode fork: warm brand tints instead of upstream's blue.
            background: [
              'radial-gradient(ellipse 60% 50% at 20% 20%, color-mix(in oklab, var(--primary) 70%, transparent) 0%, transparent 70%)',
              'radial-gradient(ellipse 50% 40% at 80% 15%, color-mix(in oklab, var(--chart-2) 55%, transparent) 0%, transparent 70%)',
              'radial-gradient(ellipse 40% 35% at 50% 70%, color-mix(in oklab, var(--chart-3) 35%, transparent) 0%, transparent 70%)',
            ].join(', '),
            maskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, black 40%, transparent 100%)',
          }}
        />
        <PageTransition className='relative mx-auto w-full max-w-[1400px] px-3 pt-16 pb-8 sm:px-6 sm:pt-20 sm:pb-10 xl:px-8'>
          <header className='mx-auto mb-6 max-w-3xl pt-5 text-center sm:mb-10 sm:pt-10'>
            <h1 className='text-[clamp(2rem,5.5vw,3.5rem)] leading-[1.15] font-bold tracking-tight'>
              {t('Model Pricing')}
            </h1>
            <p className='text-muted-foreground/80 mt-3 text-sm sm:mt-4 sm:text-base'>
              {t(
                'Official and group prices in CNY, side by side, so the cost is easy to compare.'
              )}
            </p>
            {/* CoreCode fork: Claude Code is the product; lead with it. */}
            <a
              href='/docs/claude-code/'
              className='border-primary/30 bg-primary/5 hover:bg-primary/10 mt-5 inline-flex max-w-full items-center gap-2 rounded-2xl border px-4 py-1.5 text-left text-sm font-medium transition-colors sm:rounded-full'
            >
              <span className='flex shrink-0 items-center' aria-hidden>
                {getLobeIcon('Claude.Color', 18)}
              </span>
              <span className='text-pretty'>
                {t(
                  'Built for Claude Code: full Claude, below the official price'
                )}
              </span>
              <ArrowRight className='size-4 shrink-0' aria-hidden />
            </a>
          </header>

          <main className='flex min-w-0 flex-col gap-4'>
            {/* CoreCode fork: the fingerprint check sits above the prices it vouches for on a
                wide screen, and below them on a phone, where prices come first. */}
            <ModelCheckBanner className='order-last md:order-none' />

            <PriceBoard
              models={models || []}
              groupRatio={groupRatio || {}}
              usableGroup={usableGroup || {}}
              priceRate={priceRate}
              usdExchangeRate={usdExchangeRate}
              search={url.search}
              onSearchChange={url.setSearch}
              sort={url.sort}
              onSortChange={url.setSort}
              onModelClick={url.openModel}
            />

            <ClaudeCodeEstimator models={models || []} priceRate={priceRate} />
          </main>

          {selectedModel && (
            <Suspense fallback={null}>
              <ModelDetailsDrawer
                open={Boolean(selectedModel)}
                onOpenChange={(open) => {
                  if (!open) url.closeModel()
                }}
                shareUrl={`${window.location.origin}/pricing?model=${encodeURIComponent(selectedModel.model_name)}`}
                model={selectedModel}
                groupRatio={groupRatio || {}}
                usableGroup={usableGroup || {}}
                endpointMap={
                  (endpointMap as Record<
                    string,
                    { path?: string; method?: string }
                  >) || {}
                }
                autoGroups={autoGroups || []}
                priceRate={priceRate ?? 1}
                usdExchangeRate={usdExchangeRate ?? 1}
                tokenUnit='M'
              />
            </Suspense>
          )}
        </PageTransition>
      </div>
    </PublicLayout>
  )
}
