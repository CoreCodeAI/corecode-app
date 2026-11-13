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
import { CircleHelp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { groupText } from '@/lib/group-text'
import { cn } from '@/lib/utils'

import {
  getBillingDiscount,
  getDiscountKind,
  getOfficialPriceMarkup,
  hasMarkup,
} from '../lib/billing-discount'
import {
  getConfiguredGroupRatio,
  isTokenBasedModel,
} from '../lib/model-helpers'
import { calculateTokenPrice } from '../lib/price'
import type { PricingModel, PriceType } from '../types'

const PRICE = { digitsLarge: 4, digitsSmall: 6, abbreviate: false }
const SAMPLE_PRICES: { type: PriceType; label: string }[] = [
  { type: 'input', label: 'Input' },
  { type: 'output', label: 'Output' },
  { type: 'cache', label: 'Cache Read' },
  { type: 'create_cache', label: 'Cache write' },
]

function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}

function modelGroups(model: PricingModel): string[] {
  return Array.isArray(model.enable_groups) ? model.enable_groups : []
}

function cheapestGroup(model: PricingModel): string | undefined {
  const groupRatio = model.group_ratio || {}
  return [...modelGroups(model)].sort(
    (a, b) =>
      getConfiguredGroupRatio(groupRatio, a) -
      getConfiguredGroupRatio(groupRatio, b)
  )[0]
}

function StepLabel(props: { index: number; title: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-3'>
      <div className='flex min-w-0 items-baseline gap-2'>
        <span className='text-muted-foreground font-mono text-xs tabular-nums'>
          {String(props.index).padStart(2, '0')}
        </span>
        <span className='font-medium'>{props.title}</span>
      </div>
      <span className='shrink-0 font-mono text-sm font-medium tabular-nums'>
        {props.value}
      </span>
    </div>
  )
}

/**
 * The model square's billing explanation: the formula on one side, the same
 * formula worked through one model and group on the other. Every number
 * comes from the live recharge price, exchange rate and group ratios.
 */
export function BillingExplainer(props: {
  models: PricingModel[]
  priceRate: number
  usdExchangeRate: number
  selectedGroup?: string
}) {
  const { t } = useTranslation()
  const models = props.models.filter(isTokenBasedModel)
  const [modelName, setModelName] = useState<string | null>(null)
  const [groupName, setGroupName] = useState<string | null>(null)

  const model =
    models.find((item) => item.model_name === modelName) ??
    models.find((item) => item.model_name.includes('sonnet')) ??
    models[0]
  if (!model) return null

  const groups = modelGroups(model)
  const group =
    [groupName, props.selectedGroup].find(
      (name): name is string => !!name && groups.includes(name)
    ) ?? cheapestGroup(model)
  const groupRatio = group
    ? getConfiguredGroupRatio(model.group_ratio || {}, group)
    : 1
  const discount = getBillingDiscount({
    price: props.priceRate,
    usdExchangeRate: props.usdExchangeRate,
    groupRatio,
    markup: getOfficialPriceMarkup(model),
  })
  const kind = getDiscountKind(discount.combined)
  const price = trimNumber(props.priceRate, 2)
  const rate = trimNumber(props.usdExchangeRate, 2)
  const verdicts = {
    discount: t('{{tenths}} of official price', {
      tenths: trimNumber(discount.combined * 10, 1),
      percent: `${Math.round(discount.combined * 100)}%`,
    }),
    markup: t('{{ratio}}× official price', {
      ratio: trimNumber(discount.combined, 2),
    }),
    same: t('Same as official price'),
  }
  const verdict = verdicts[kind]

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-8 gap-1.5 px-2.5 text-xs'
          />
        }
      >
        <CircleHelp className='size-3.5' aria-hidden />
        {t('How billing works')}
      </DialogTrigger>
      <DialogContent className='gap-5 sm:max-w-4xl sm:p-6'>
        <DialogHeader>
          <DialogTitle>{t('How billing works')}</DialogTitle>
          <DialogDescription>
            {t(
              'What you pay relative to the official price is the exchange-rate factor times the group ratio. The right side works one model through the same formula.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-6 md:grid-cols-2'>
          <section className='flex flex-col gap-3'>
            <h3 className='text-muted-foreground text-xs font-medium'>
              {t('Formula')}
            </h3>
            <div className='bg-muted/40 rounded-xl border p-4'>
              <StepLabel
                index={1}
                title={t('Exchange-rate factor')}
                value={t('Recharge price ÷ exchange rate')}
              />
              <p className='text-muted-foreground mt-2 text-pretty'>
                {t(
                  '¥{{price}} recharged buys $1 of credit; the reference rate is $1 = ¥{{rate}}.',
                  { price, rate }
                )}
              </p>
            </div>
            <div className='bg-muted/40 rounded-xl border p-4'>
              <StepLabel
                index={2}
                title={t('Group Ratio')}
                value={t('× ratio')}
              />
              <p className='text-muted-foreground mt-2 text-pretty'>
                {t(
                  'Prices on the model cards are official prices multiplied by the group ratio.'
                )}
              </p>
            </div>
            <div className='border-primary/30 bg-primary/5 rounded-xl border p-4'>
              <StepLabel
                index={3}
                title={t('Combined factor')}
                value={t('Exchange-rate factor × group ratio')}
              />
              <p className='text-muted-foreground mt-2 text-pretty'>
                {t('What you pay relative to the official price.')}
              </p>
            </div>
          </section>

          <section className='flex min-w-0 flex-col gap-3'>
            <h3 className='text-muted-foreground text-xs font-medium'>
              {t('Example')}
            </h3>
            <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
              <Select
                value={model.model_name}
                onValueChange={(value) => {
                  setModelName(value as string)
                  setGroupName(null)
                }}
              >
                <SelectTrigger
                  aria-label={t('Model')}
                  className='w-full min-w-0 font-mono'
                >
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
              {groups.length > 0 && group && (
                <Select
                  value={group}
                  onValueChange={(value) => setGroupName(value as string)}
                >
                  <SelectTrigger aria-label={t('Group')} className='max-w-48'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {groups.map((item) => (
                        <SelectItem key={item} value={item}>
                          {groupText(t, item)} · ×
                          {trimNumber(
                            getConfiguredGroupRatio(
                              model.group_ratio || {},
                              item
                            ),
                            2
                          )}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
            </div>

            <dl className='bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border'>
              {SAMPLE_PRICES.map((item) => {
                const usd = calculateTokenPrice(model, item.type, groupRatio)
                if (!Number.isFinite(usd)) return null
                return (
                  <div key={item.type} className='bg-card min-w-0 px-3 py-2.5'>
                    <dt className='text-muted-foreground text-xs'>
                      {t(item.label)}
                    </dt>
                    <dd className='mt-0.5 truncate font-mono font-medium tabular-nums'>
                      {formatBillingCurrencyFromUSD(usd, PRICE)}/M
                    </dd>
                  </div>
                )
              })}
            </dl>

            <div className='rounded-xl border p-4'>
              <div className='flex flex-col gap-3'>
                <div>
                  <StepLabel
                    index={1}
                    title={t('Exchange-rate factor')}
                    value={`≈ ${trimNumber(discount.exchange, 3)}`}
                  />
                  <p className='text-muted-foreground mt-1 pl-7 font-mono text-xs'>
                    {price} ÷ {rate}
                  </p>
                </div>
                <div>
                  <StepLabel
                    index={2}
                    title={t('Group Ratio')}
                    value={`× ${trimNumber(discount.group, 2)}`}
                  />
                  {group && (
                    <p className='text-muted-foreground mt-1 pl-7 text-xs'>
                      {groupText(t, group)}
                    </p>
                  )}
                </div>
                {hasMarkup(discount.markup) && (
                  <div>
                    <StepLabel
                      index={3}
                      title={t('Model markup')}
                      value={`× ${trimNumber(discount.markup, 2)}`}
                    />
                    <p className='text-muted-foreground mt-1 pl-7 text-xs text-pretty'>
                      {t(
                        'This model costs more to serve, so it is priced at {{markup}}× the official price before the group discount.',
                        { markup: trimNumber(discount.markup, 2) }
                      )}
                    </p>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  'mt-4 flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2.5',
                  kind === 'discount'
                    ? 'border-primary/30 bg-primary/5'
                    : 'bg-muted/40'
                )}
                aria-live='polite'
              >
                <span className='text-muted-foreground'>
                  = {t('Combined factor')}
                </span>
                <span className='font-mono font-semibold tabular-nums'>
                  ≈ {trimNumber(discount.combined, 3)} →{' '}
                  <span className={cn(kind === 'discount' && 'text-primary')}>
                    {verdict}
                  </span>
                </span>
              </div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
