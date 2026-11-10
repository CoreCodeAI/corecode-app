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
import { Check, CircleHelp, ReceiptText, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import { EXCLUDED_GROUPS, QUOTA_TYPE_VALUES } from '../constants'
import {
  getBillingDiscount,
  getDiscountKind,
  getOfficialPriceMarkup,
  hasMarkup,
} from '../lib/billing-discount'
import {
  BOARD_SORTS,
  getExpressionPrice,
  getOfficialImageYuan,
  getOfficialSecondYuan,
  matchesModelSearch,
  sortBoardRows,
  type BoardRow,
  type BoardSort,
} from '../lib/board-rows'
import { isDynamicPricingModel } from '../lib/dynamic-price'
import {
  CLAUDE_VENDOR,
  groupVendor,
  modelVendor,
  orderGroups,
  type GroupVendor,
} from '../lib/group-vendors'
import { getConfiguredGroupRatio } from '../lib/model-helpers'
import {
  formatYuan,
  getBaseUnitPrices,
  UNIT_PRICE_KEYS,
  type UnitPriceKey,
} from '../lib/unit-prices'
import type { PricingModel } from '../types'
import { BillingExplainer } from './billing-explainer'

const COLUMN_LABEL: Record<UnitPriceKey, string> = {
  input: 'Input price',
  output: 'Output price',
  cacheWrite: 'Cache Creation',
  cacheRead: 'Cache Read',
}

const SORT_LABEL: Record<BoardSort, string> = {
  input: 'Input price: low to high',
  output: 'Output price: low to high',
  savings: 'Biggest savings first',
}

// What a cache column means, for the customer who sees the four prices side by side.
const COLUMN_HELP: Partial<Record<UnitPriceKey, string>> = {
  cacheWrite:
    'Cache write: the one-off price of storing a prompt prefix so later requests can reuse it. Claude Code pays it when a conversation grows.',
  cacheRead:
    'Cache read: the price of reusing a prefix that is already cached. It is far below the input price, and Claude Code pays it on most turns.',
}

// Opens quickly on hover, and stays long enough to move the pointer onto it.
const MARKUP_HELP_DELAY = 150

const SAVE_CHIP_CLASS =
  'inline-flex shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400'

function trimNumber(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}

/** Groups where at least one model is priced by tokens. */
function tokenPricedGroups(models: PricingModel[]): Set<string> {
  const names = new Set<string>()
  for (const model of models) {
    if (getBaseUnitPrices(model)) {
      for (const group of model.enable_groups ?? []) names.add(group)
    }
  }
  return names
}

/** Groups any listed model is enabled in: Claude first, cheapest first within. */
function listGroups(
  models: PricingModel[],
  groupRatio: Record<string, number>,
  usableGroup: Record<string, unknown>
): { groups: string[]; vendors: Map<string, GroupVendor | null> } {
  const names = new Set<string>()
  for (const model of models) {
    for (const group of model.enable_groups ?? []) {
      if (!EXCLUDED_GROUPS.includes(group) && group in usableGroup) {
        names.add(group)
      }
    }
  }
  const vendors = new Map(
    [...names].map((name) => [name, groupVendor(models, name)])
  )
  const groups = orderGroups([...names], vendors, (name) =>
    getConfiguredGroupRatio(groupRatio, name)
  )
  return { groups, vendors }
}

function VendorIcon(props: { icon?: string; size: number }) {
  if (!props.icon) return null
  return (
    <span className='flex shrink-0 items-center' aria-hidden>
      {getLobeIcon(props.icon, props.size)}
    </span>
  )
}

/** A column heading that explains itself in a popover when the column has help text. */
function ColumnHeading(props: { column: UnitPriceKey }) {
  const { t } = useTranslation()
  const label = t(COLUMN_LABEL[props.column])
  const help = COLUMN_HELP[props.column]
  if (!help) return <span>{label}</span>
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={MARKUP_HELP_DELAY}
        closeDelay={MARKUP_HELP_DELAY}
        render={
          <button
            type='button'
            aria-label={`${label}: ${t(help)}`}
            className='focus-visible:ring-ring/50 inline-flex cursor-help items-center gap-1 rounded outline-none focus-visible:ring-2'
          />
        }
      >
        {label}
        <CircleHelp className='size-3.5' aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side='top'
        className='text-muted-foreground w-auto max-w-64 p-3 text-xs leading-relaxed'
      >
        {t(help)}
      </PopoverContent>
    </Popover>
  )
}

function groupDescription(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'desc' in value) {
    return String((value as { desc: unknown }).desc ?? '')
  }
  return ''
}

/**
 * CoreCode fork: the model square as a price list. Each model's four Claude
 * Code prices in CNY at the chosen group, the official price struck through
 * beside them, and the share saved. Every figure comes from the live recharge
 * price, exchange rate, group ratios and each model's markup over the official
 * price; a marked-up model's saving explains itself in a tooltip. A model
 * billed per request, such as an image model, is listed apart with its price
 * per request; there is no official figure to compare it with. A lone group is
 * shown, not offered as a choice.
 */
export function PriceBoard(props: {
  models: PricingModel[]
  groupRatio: Record<string, number>
  usableGroup: Record<string, unknown>
  priceRate: number
  usdExchangeRate: number
  /** The search text; the board keeps its own copy while typing and reports each change. */
  search: string
  onSearchChange: (value: string) => void
  sort: BoardSort
  onSortChange: (value: BoardSort) => void
  onModelClick: (modelName: string) => void
}) {
  const { t } = useTranslation()
  const { groups, vendors } = listGroups(
    props.models,
    props.groupRatio,
    props.usableGroup
  )
  // The group discount compares token prices with the official ones, so a group
  // with none has nothing to claim it for.
  const tokenGroups = tokenPricedGroups(props.models)
  const isClaude = (name: string) => vendors.get(name)?.name === CLAUDE_VENDOR
  const claudeGroups = groups.filter(isClaude)
  const otherGroups = groups.filter((name) => !isClaude(name))
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState(props.search)
  const group = selected && groups.includes(selected) ? selected : groups[0]
  const ratio = group ? getConfiguredGroupRatio(props.groupRatio, group) : 1

  const discountAt = (groupRatio: number) =>
    getBillingDiscount({
      price: props.priceRate,
      usdExchangeRate: props.usdExchangeRate,
      groupRatio,
    }).combined
  const discountLabel = (combined: number) =>
    t('{{tenths}} of official price', {
      tenths: trimNumber(combined * 10, 1),
      percent: `${Math.round(combined * 100)}%`,
    })
  const combined = discountAt(ratio)
  const saving =
    group && tokenGroups.has(group) && getDiscountKind(combined) === 'discount'
      ? 1 - combined
      : 0

  const groupModels = props.models.filter(
    (model) => !group || (model.enable_groups ?? []).includes(group)
  )
  const matchedModels = groupModels.filter((model) =>
    matchesModelSearch(model, query)
  )
  const rows = sortBoardRows(
    matchedModels
      .map((model) => ({
        model,
        base: getBaseUnitPrices(model),
        markup: getOfficialPriceMarkup(model),
      }))
      .filter((row): row is BoardRow => Boolean(row.base)),
    props.sort
  )
  const requestRows = matchedModels
    .filter(
      (model) =>
        model.quota_type === QUOTA_TYPE_VALUES.REQUEST &&
        !isDynamicPricingModel(model) &&
        typeof model.model_price === 'number' &&
        model.model_price >= 0
    )
    .map((model) => ({ model, usd: model.model_price ?? 0 }))
    .sort((a, b) => a.usd - b.usd)

  // Priced by an expression the rows above do not cover: a video billed per
  // second, an image billed by size. A model the board cannot summarise is
  // still listed, with its details one click away, never hidden.
  const rowNames = new Set(rows.map((row) => row.model.model_name))
  const requestNames = new Set(requestRows.map((row) => row.model.model_name))
  const expressionRows = matchedModels
    .filter(
      (model) =>
        isDynamicPricingModel(model) &&
        !rowNames.has(model.model_name) &&
        !requestNames.has(model.model_name)
    )
    .map((model) => ({ model, price: getExpressionPrice(model) }))
  const hasImagePrices = expressionRows.some(
    (row) => row.price?.kind === 'image'
  )
  const hasVideoPrices = expressionRows.some(
    (row) => row.price?.kind === 'second'
  )

  const groupYuan = (usd: number) => usd * ratio * props.priceRate
  const officialYuan = (usd: number, markup: number) =>
    (usd / markup) * props.usdExchangeRate
  const showsDiscount = (name: string, groupCombined: number) =>
    tokenGroups.has(name) && getDiscountKind(groupCombined) === 'discount'
  const description = group ? groupDescription(props.usableGroup[group]) : ''

  const renderPrice = (usd: number, markup: number) => {
    if (!Number.isFinite(usd)) {
      return <span className='text-muted-foreground'>—</span>
    }
    return (
      <>
        <span className='font-mono font-semibold tabular-nums'>
          <span className='text-primary'>{formatYuan(groupYuan(usd))}</span>
          <span className='text-muted-foreground text-xs font-normal'>
            {' '}
            {t('/ 1M tokens')}
          </span>
        </span>
        <span className='text-muted-foreground block font-mono text-xs tabular-nums line-through'>
          {t('Official {{price}}', {
            price: formatYuan(officialYuan(usd, markup)),
          })}
        </span>
      </>
    )
  }
  const savingChip = (markup: number) => {
    const modelCombined = combined * markup
    const chip =
      getDiscountKind(modelCombined) === 'discount' ? (
        <span className={SAVE_CHIP_CLASS}>
          {t('Save {{percent}}', {
            percent: `${Math.round((1 - modelCombined) * 100)}%`,
          })}
        </span>
      ) : (
        <span className='text-muted-foreground'>—</span>
      )
    if (!hasMarkup(markup)) return chip
    // A popover rather than a tooltip: a tooltip opens only on hover, so a
    // click or a tap on a touch screen would show nothing.
    return (
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={MARKUP_HELP_DELAY}
          closeDelay={MARKUP_HELP_DELAY}
          render={
            <button
              type='button'
              className='focus-visible:ring-ring/50 inline-flex cursor-help items-center gap-1 rounded-full outline-none focus-visible:ring-2'
            />
          }
        >
          {chip}
          <CircleHelp className='text-muted-foreground size-3.5' aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          side='top'
          className='text-muted-foreground w-auto max-w-64 p-3 text-xs leading-relaxed'
        >
          {t(
            'This model costs more to serve, so it is priced at {{markup}}× the official price before the group discount.',
            { markup: trimNumber(markup, 2) }
          )}
        </PopoverContent>
      </Popover>
    )
  }
  // What a media model costs here against its official price. Only a real
  // discount earns a chip.
  const mediaChip = (ours: number, official: number | null) => {
    if (official === null || !Number.isFinite(ours)) return null
    const ratio = ours / official
    if (getDiscountKind(ratio) !== 'discount') return null
    return (
      <span className={SAVE_CHIP_CLASS}>
        {t('Save {{percent}}', {
          percent: `${Math.round((1 - ratio) * 100)}%`,
        })}
      </span>
    )
  }
  const officialLine = (text: string, struck: boolean) => (
    <span
      className={cn(
        'text-muted-foreground block font-mono text-xs font-normal tabular-nums',
        struck && 'line-through'
      )}
    >
      {text}
    </span>
  )
  const officialSecondLine = (model: PricingModel, struck: boolean) => {
    const yuan = getOfficialSecondYuan(model, props.usdExchangeRate)
    if (yuan === null) return null
    return officialLine(
      t('Official {{price}} / second', { price: formatYuan(yuan) }),
      struck
    )
  }
  const modelName = (model: PricingModel) => (
    <span className='flex min-w-0 items-center gap-1.5'>
      <VendorIcon icon={modelVendor(model)?.icon} size={16} />
      <button
        type='button'
        onClick={() => props.onModelClick(model.model_name)}
        className='hover:text-primary truncate font-mono font-medium underline-offset-4 hover:underline'
      >
        {model.model_name}
      </button>
      <CopyButton
        value={model.model_name}
        tooltip={t('Copy model name')}
        className='size-6'
        iconClassName='size-3'
      />
    </span>
  )
  const renderGroup = (name: string, featured: boolean) => {
    const groupRatio = getConfiguredGroupRatio(props.groupRatio, name)
    const groupCombined = discountAt(groupRatio)
    const isDiscount = showsDiscount(name, groupCombined)
    const active = name === group
    const forClaudeCode = /claude code/i.test(
      groupDescription(props.usableGroup[name])
    )
    return (
      <button
        key={name}
        type='button'
        role='radio'
        aria-checked={active}
        onClick={() => setSelected(name)}
        className={cn(
          'hover:border-primary/50 flex min-w-0 flex-col gap-1 rounded-lg border text-left transition-colors',
          featured ? 'px-4 py-3.5' : 'px-3 py-2.5',
          active && 'border-primary bg-primary/5'
        )}
      >
        <span className='flex min-w-0 items-center gap-2'>
          <VendorIcon
            icon={vendors.get(name)?.icon}
            size={featured ? 22 : 18}
          />
          <span className={cn('truncate font-medium', featured && 'text-base')}>
            {name}
          </span>
          {isDiscount && (
            <span className='bg-primary/10 text-primary shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold'>
              {discountLabel(groupCombined)}
            </span>
          )}
          {active && (
            <Check
              className='text-primary ml-auto size-4 shrink-0'
              aria-hidden
            />
          )}
        </span>
        <span className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
          {forClaudeCode && (
            <span className='bg-primary text-primary-foreground rounded px-1.5 py-0.5 font-semibold'>
              Claude Code
            </span>
          )}
          <span>
            {t('{{ratio}}x ratio', { ratio: trimNumber(groupRatio, 2) })}
            {isDiscount &&
              ` · ${t('About {{discount}}', {
                discount: discountLabel(groupCombined),
              })}`}
          </span>
        </span>
      </button>
    )
  }
  const tierNote = (
    <span className='text-muted-foreground mt-0.5 block text-xs'>
      {t('Base tier; longer contexts cost more')}
    </span>
  )

  return (
    <div className='flex flex-col gap-4'>
      <section className='bg-card order-last flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm md:order-none'>
        <span className='flex items-center gap-1.5 font-medium'>
          <ReceiptText className='text-primary size-4' aria-hidden />
          {t('Pricing rules')}
        </span>
        <span className='text-muted-foreground'>
          {t(
            'The table shows what you actually pay. Usage is charged in USD at the same discount.'
          )}
        </span>
        <span className='text-muted-foreground'>
          {t('¥{{price}} recharged buys $1 of credit', {
            price: trimNumber(props.priceRate, 2),
          })}
        </span>
        <span className='ml-auto'>
          <BillingExplainer
            models={props.models}
            priceRate={props.priceRate}
            usdExchangeRate={props.usdExchangeRate}
            selectedGroup={group}
          />
        </span>
      </section>

      <section
        aria-label={t('Price list')}
        className='bg-card rounded-xl border'
      >
        <div className='flex flex-col gap-3 p-4'>
          {groups.length === 1 && (
            <div className='border-primary bg-primary/5 mx-auto flex max-w-full items-center gap-3 rounded-xl border px-6 py-4'>
              <VendorIcon icon={vendors.get(group)?.icon} size={22} />
              <span className='truncate text-lg font-semibold'>{group}</span>
              {saving > 0 && (
                <span className='bg-primary/10 text-primary shrink-0 rounded px-2 py-0.5 font-mono text-sm font-semibold'>
                  {discountLabel(combined)}
                </span>
              )}
            </div>
          )}

          {groups.length > 1 && (
            <div className='md:hidden'>
              <Select
                items={groups.map((name) => ({ value: name, label: name }))}
                value={group}
                onValueChange={(value) => setSelected(value)}
              >
                <SelectTrigger className='w-full' aria-label={t('Group')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {groups.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                        {showsDiscount(
                          name,
                          discountAt(
                            getConfiguredGroupRatio(props.groupRatio, name)
                          )
                        ) && (
                          <span className='text-primary ml-2 font-mono text-xs'>
                            {discountLabel(
                              discountAt(
                                getConfiguredGroupRatio(props.groupRatio, name)
                              )
                            )}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}

          {groups.length > 1 && (
            <div
              role='radiogroup'
              aria-label={t('Group')}
              className='hidden flex-col gap-4 md:flex'
            >
              {claudeGroups.length > 0 && (
                <div className='flex flex-col gap-2'>
                  {otherGroups.length > 0 && (
                    <p className='flex items-center gap-2 text-sm font-semibold'>
                      <VendorIcon icon='Claude.Color' size={18} />
                      {t('Claude, made for Claude Code')}
                    </p>
                  )}
                  <div className='grid gap-3 sm:grid-cols-2'>
                    {claudeGroups.map((name) => renderGroup(name, true))}
                  </div>
                </div>
              )}
              {otherGroups.length > 0 && (
                <div className='flex flex-col gap-2'>
                  {claudeGroups.length > 0 && (
                    <p className='text-muted-foreground text-sm font-medium'>
                      {t('More models')}
                    </p>
                  )}
                  <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                    {otherGroups.map((name) => renderGroup(name, false))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
            <div className='relative min-w-0 flex-1'>
              <Search
                className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
                aria-hidden
              />
              <Input
                type='search'
                value={query}
                placeholder={t('Search models')}
                aria-label={t('Search models')}
                className='pl-9'
                onChange={(event) => {
                  setQuery(event.target.value)
                  props.onSearchChange(event.target.value)
                }}
              />
            </div>
            <Select
              items={BOARD_SORTS.map((value) => ({
                value,
                label: t(SORT_LABEL[value]),
              }))}
              value={props.sort}
              onValueChange={(value) => {
                if (value) props.onSortChange(value as BoardSort)
              }}
            >
              <SelectTrigger className='w-full sm:w-56' aria-label={t('Sort')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {BOARD_SORTS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(SORT_LABEL[value])}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {description && (
            <p className='border-primary/20 bg-primary/5 rounded-lg border px-3 py-2 text-sm'>
              <span className='text-primary font-medium'>
                {t('Usage note')}：
              </span>
              {description}
            </p>
          )}

          {rows.length === 0 &&
            requestRows.length === 0 &&
            expressionRows.length === 0 && (
              <p className='text-muted-foreground py-6 text-center text-sm'>
                {t('No models match your search.')}
              </p>
            )}

          {rows.length > 0 && (
            <ul className='flex flex-col gap-3 md:hidden'>
              {rows.map(({ model, base, markup }) => (
                <li key={model.model_name} className='rounded-lg border p-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      {modelName(model)}
                      {base.tiered && tierNote}
                    </div>
                    {savingChip(markup)}
                  </div>
                  <dl className='mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5'>
                    {UNIT_PRICE_KEYS.map((key) => (
                      <div key={key} className='min-w-0'>
                        <dt className='text-muted-foreground text-xs'>
                          <ColumnHeading column={key} />
                        </dt>
                        <dd className='text-sm'>
                          {renderPrice(base.prices[key], markup)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}

          {rows.length > 0 && (
            <div className='hidden overflow-x-auto rounded-lg border md:block'>
              <table className='w-full min-w-[720px] text-sm'>
                <thead className='bg-muted/40 text-muted-foreground text-xs'>
                  <tr>
                    <th
                      scope='col'
                      className='px-4 py-2.5 text-left font-medium'
                    >
                      {t('Model')}
                    </th>
                    {UNIT_PRICE_KEYS.map((key) => (
                      <th
                        key={key}
                        scope='col'
                        className='px-3 py-2.5 text-left font-medium'
                      >
                        <ColumnHeading column={key} />
                      </th>
                    ))}
                    <th
                      scope='col'
                      className='px-4 py-2.5 text-right font-medium'
                    >
                      {t('Savings')}
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {rows.map(({ model, base, markup }) => (
                    <tr key={model.model_name} className='hover:bg-muted/30'>
                      <th
                        scope='row'
                        className='px-4 py-3 text-left font-normal'
                      >
                        {modelName(model)}
                        {base.tiered && tierNote}
                      </th>
                      {UNIT_PRICE_KEYS.map((key) => (
                        <td
                          key={key}
                          className='px-3 py-3 align-top whitespace-nowrap'
                        >
                          {renderPrice(base.prices[key], markup)}
                        </td>
                      ))}
                      <td className='px-4 py-3 text-right'>
                        {savingChip(markup)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {expressionRows.length > 0 && (
            <div className='flex flex-col gap-2'>
              <div className='overflow-x-auto rounded-lg border'>
                <table
                  aria-label={t('Priced by usage')}
                  className='w-full text-sm'
                >
                  <thead className='bg-muted/40 text-muted-foreground text-xs'>
                    <tr>
                      <th
                        scope='col'
                        className='px-4 py-2.5 text-left font-medium'
                      >
                        {t('Model')}
                      </th>
                      <th
                        scope='col'
                        className='px-4 py-2.5 text-right font-medium'
                      >
                        {t('Price')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {expressionRows.map(({ model, price }) => (
                      <tr key={model.model_name} className='hover:bg-muted/30'>
                        <th
                          scope='row'
                          className='px-4 py-3 text-left font-normal'
                        >
                          {modelName(model)}
                        </th>
                        <td className='px-4 py-3 text-right font-mono whitespace-nowrap tabular-nums'>
                          {price?.kind === 'second' && (
                            <>
                              <span className='flex items-center justify-end gap-2'>
                                <span className='text-primary font-semibold'>
                                  {t('{{price}} / second', {
                                    price: formatYuan(groupYuan(price.usd)),
                                  })}
                                </span>
                                {mediaChip(
                                  groupYuan(price.usd),
                                  getOfficialSecondYuan(
                                    model,
                                    props.usdExchangeRate
                                  )
                                )}
                              </span>
                              {officialSecondLine(model, true)}
                            </>
                          )}
                          {price?.kind === 'image' && (
                            <span className='flex flex-wrap items-start justify-end gap-x-4 gap-y-1'>
                              {price.tiers.map((tier) => {
                                const official = getOfficialImageYuan(
                                  model,
                                  tier.size,
                                  props.usdExchangeRate
                                )
                                return (
                                  <span key={tier.size}>
                                    <span className='text-muted-foreground text-xs'>
                                      {tier.size}{' '}
                                    </span>
                                    <span className='text-primary font-semibold'>
                                      {formatYuan(groupYuan(tier.usd))}
                                    </span>
                                    {official !== null &&
                                      officialLine(
                                        t('Official {{price}}', {
                                          price: formatYuan(official),
                                        }),
                                        true
                                      )}
                                  </span>
                                )
                              })}
                              {mediaChip(
                                groupYuan(
                                  price.tiers.find((tier) => tier.size === '1K')
                                    ?.usd ?? Number.NaN
                                ),
                                getOfficialImageYuan(
                                  model,
                                  '1K',
                                  props.usdExchangeRate
                                )
                              )}
                            </span>
                          )}
                          {!price && (
                            <button
                              type='button'
                              onClick={() =>
                                props.onModelClick(model.model_name)
                              }
                              className='text-primary font-sans underline-offset-4 hover:underline'
                            >
                              {t('See pricing details')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasImagePrices && (
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Per image, by output size. Small sizes such as 1024x1024 are 1K and large ones such as 3840x2160 are 4K; every other size, and a request with no size, is billed at 2K.'
                  )}
                </p>
              )}
              {hasVideoPrices && (
                <p className='text-muted-foreground text-xs'>
                  {t('Billed per second of generated video.')}
                </p>
              )}
            </div>
          )}

          {requestRows.length > 0 && (
            <div className='flex flex-col gap-2'>
              <div className='overflow-x-auto rounded-lg border'>
                <table aria-label={t('Per-request')} className='w-full text-sm'>
                  <thead className='bg-muted/40 text-muted-foreground text-xs'>
                    <tr>
                      <th
                        scope='col'
                        className='px-4 py-2.5 text-left font-medium'
                      >
                        {t('Model')}
                      </th>
                      <th
                        scope='col'
                        className='px-4 py-2.5 text-right font-medium'
                      >
                        {t('Per request')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {requestRows.map(({ model, usd }) => (
                      <tr key={model.model_name} className='hover:bg-muted/30'>
                        <th
                          scope='row'
                          className='px-4 py-3 text-left font-normal'
                        >
                          {modelName(model)}
                        </th>
                        <td className='text-primary px-4 py-3 text-right font-mono font-semibold whitespace-nowrap tabular-nums'>
                          {formatYuan(groupYuan(usd))}
                          {officialSecondLine(model, false)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Billed per request: each image counts once, and each video task counts once.'
                )}
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
