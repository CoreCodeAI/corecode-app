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
import { Calculator } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { toIntlLocale } from '@/i18n/languages'
import { cn } from '@/lib/utils'

import { tierDisplayLabel } from '../lib/billing-expr'
import {
  DEFAULT_WORKLOAD,
  estimateClaudeCodeCost,
  type ClaudeCodeWorkload,
} from '../lib/claude-code-estimate'
import { CLAUDE_VENDOR, modelVendor } from '../lib/group-vendors'
import { isTokenBasedModel } from '../lib/model-helpers'
import type { PricingModel } from '../types'

const DAYS_PER_MONTH = 30

function WorkloadNumber(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <Label htmlFor={id} className='text-muted-foreground text-xs font-normal'>
        {props.label}
      </Label>
      <Input
        id={id}
        type='number'
        inputMode='numeric'
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) {
            props.onChange(Math.min(Math.max(next, props.min), props.max))
          }
        }}
        className='font-mono tabular-nums'
      />
    </div>
  )
}

/**
 * What a Claude Code workload costs per turn, day and month, and how much of
 * it the prompt cache saves. Pass one model to fix it, or several to choose.
 */
export function ClaudeCodeEstimator(props: {
  models: PricingModel[]
  /** CNY recharged for $1 of credit; the estimate is shown in CNY. */
  priceRate: number
  selectedGroup?: string
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const hitRateId = useId()
  // Claude Code calls Claude only; other pools and aliases into them do not apply.
  const models = props.models.filter(
    (item) =>
      isTokenBasedModel(item) &&
      !item.model_name.includes('/') &&
      modelVendor(item)?.name === CLAUDE_VENDOR
  )
  const [modelName, setModelName] = useState<string | null>(null)
  const [workload, setWorkload] = useState<ClaudeCodeWorkload>(DEFAULT_WORKLOAD)

  const model =
    models.find((item) => item.model_name === modelName) ??
    models.find((item) => item.model_name.includes('sonnet')) ??
    models[0]
  if (!model) return null

  const estimate = estimateClaudeCodeCost(model, workload, props.selectedGroup)
  if (!estimate) return null

  const update = (patch: Partial<ClaudeCodeWorkload>) =>
    setWorkload((current) => ({ ...current, ...patch }))
  const saved = estimate.perDayWithoutCache - estimate.perDay
  const savedShare =
    estimate.perDayWithoutCache > 0 ? saved / estimate.perDayWithoutCache : 0
  const yuan = (usd: number) => {
    const value = usd * props.priceRate
    return `¥${value.toLocaleString('en-US', {
      maximumFractionDigits: Math.abs(value) >= 1 ? 2 : 4,
    })}`
  }
  const percent = (value: number) =>
    Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 0,
    }).format(value)

  return (
    <section
      aria-labelledby={`${hitRateId}-title`}
      className={cn(
        'bg-card rounded-2xl border p-4 shadow-xs sm:p-5',
        props.className
      )}
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-3'>
          <span className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl'>
            <Calculator className='size-4' aria-hidden />
          </span>
          <div className='min-w-0'>
            <h2 id={`${hitRateId}-title`} className='text-lg leading-tight'>
              {t('Claude Code cost estimate')}
            </h2>
            <p className='text-muted-foreground mt-0.5 text-sm text-pretty'>
              {t(
                'Each turn resends the context. Cached context is billed as cache reads; the new part is written to the cache.'
              )}
            </p>
          </div>
        </div>
        {models.length > 1 && (
          <Select
            value={model.model_name}
            onValueChange={(value) => setModelName(value as string)}
          >
            <SelectTrigger aria-label={t('Model')} className='w-52 font-mono'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {models.map((item) => (
                  <SelectItem
                    key={item.model_name}
                    value={item.model_name}
                    className='font-mono'
                  >
                    {item.model_name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className='mt-5 grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4'>
        <WorkloadNumber
          label={t('Context per turn (tokens)')}
          value={workload.contextTokens}
          min={0}
          max={1_000_000}
          step={1_000}
          onChange={(contextTokens) => update({ contextTokens })}
        />
        <WorkloadNumber
          label={t('Output per turn (tokens)')}
          value={workload.outputTokens}
          min={0}
          max={128_000}
          step={100}
          onChange={(outputTokens) => update({ outputTokens })}
        />
        <WorkloadNumber
          label={t('Turns per day')}
          value={workload.turnsPerDay}
          min={0}
          max={100_000}
          step={10}
          onChange={(turnsPerDay) => update({ turnsPerDay })}
        />
        <div className='flex min-w-0 flex-col gap-1.5'>
          <div className='flex items-baseline justify-between gap-2'>
            <Label
              htmlFor={hitRateId}
              className='text-muted-foreground text-xs font-normal'
            >
              {t('Cache hit rate')}
            </Label>
            <span className='font-mono text-xs tabular-nums'>
              {percent(workload.cacheHitRate)}
            </span>
          </div>
          <Slider
            id={hitRateId}
            className='py-3'
            min={0}
            max={100}
            step={5}
            value={[Math.round(workload.cacheHitRate * 100)]}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next
              update({ cacheHitRate: Number(value) / 100 })
            }}
          />
        </div>
      </div>

      <dl className='bg-border mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border'>
        {[
          { label: t('Per turn'), value: estimate.perTurn },
          { label: t('Per day'), value: estimate.perDay },
          { label: t('Per 30 days'), value: estimate.perDay * DAYS_PER_MONTH },
        ].map((item) => (
          <div
            key={item.label}
            className='bg-muted/40 min-w-0 px-3 py-3 sm:px-4'
          >
            <dt className='text-muted-foreground text-xs'>{item.label}</dt>
            <dd className='mt-1 truncate text-lg font-semibold tabular-nums sm:text-xl'>
              {yuan(item.value)}
            </dd>
          </div>
        ))}
      </dl>

      {estimate.tier && (
        <p className='text-muted-foreground mt-3 text-sm'>
          {t('This context is billed at the {{tier}} tier.', {
            tier: tierDisplayLabel(estimate.tier, t),
          })}
        </p>
      )}

      {saved > 0 && (
        <p className='text-muted-foreground mt-1.5 text-sm' aria-live='polite'>
          {t(
            'Without the cache this would be {{amount}} a day. The cache saves {{share}}.',
            {
              amount: yuan(estimate.perDayWithoutCache),
              share: percent(savedShare),
            }
          )}
        </p>
      )}
    </section>
  )
}
