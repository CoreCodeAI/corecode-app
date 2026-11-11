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
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { submitPaymentForm } from '@/features/wallet/lib/payment'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import { submitInvoice } from '../api'
import { INVOICE_TAX_METHOD_LABEL } from '../constants'
import {
  formatInvoiceAmount,
  invoiceTaxCents,
  invoiceTaxQuota,
} from '../lib/amount'
import { invoiceFormSchema, type InvoiceFormValues } from '../lib/schema'
import type {
  InvoiceConfig,
  InvoiceTaxMethod,
  InvoiceTitleType,
  InvoiceableOrder,
} from '../types'

/** The title, recipient and tax payment of an application. */
export function InvoiceForm(props: {
  config: InvoiceConfig
  orders: InvoiceableOrder[]
  defaultEmail: string
  balance: number
  onSubmitted: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [submitting, setSubmitting] = useState(false)
  const form = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      title_type: 'company',
      title: '',
      tax_no: '',
      category: props.config.categories[0] ?? '',
      email: props.defaultEmail,
      payment_method: 'balance',
    },
  })
  const titleType = form.watch('title_type')
  const method = form.watch('payment_method')

  const orderCents = props.orders.reduce(
    (sum, order) => sum + order.amount_cents,
    0
  )
  const taxCents = invoiceTaxCents(orderCents, props.config.tax_rate)
  const taxQuota = invoiceTaxQuota(taxCents, props.config.quota_per_yuan)
  const hasTax = taxCents > 0
  const shortOfBalance =
    hasTax && method === 'balance' && props.balance < taxQuota
  const methods: InvoiceTaxMethod[] = ['balance', ...props.config.pay_methods]
  const canSubmit = props.orders.length > 0 && !submitting && !shortOfBalance

  async function onSubmit(values: InvoiceFormValues) {
    if (props.orders.length === 0) {
      toast.error(t('Select at least one order'))
      return
    }
    setSubmitting(true)
    try {
      const result = await submitInvoice({
        ...values,
        tax_no: values.title_type === 'company' ? values.tax_no : '',
        orders: props.orders.map((order) => ({
          order_type: order.order_type,
          order_id: order.order_id,
        })),
      })
      if (result.url && result.params) {
        submitPaymentForm(result.url, result.params)
        toast.success(
          t('Application submitted. Pay the tax to send it for review.')
        )
      } else {
        toast.success(t('Application submitted for review'))
      }
      props.onSubmitted()
    } catch (error) {
      handleServerError(error, t('Failed to submit the application'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Invoice details')}</CardTitle>
        <CardDescription>
          {t('{{count}} orders selected', { count: props.orders.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex flex-col gap-4'
            noValidate
          >
            <FormItem>
              <FormLabel>{t('Invoice type')}</FormLabel>
              <p className='text-sm'>{t('General VAT invoice')}</p>
            </FormItem>
            <FormField
              control={form.control}
              name='title_type'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Title type')}</FormLabel>
                  <ToggleGroup
                    value={[field.value]}
                    onValueChange={(values) => {
                      const next = values.find((value) => value !== field.value)
                      if (next) field.onChange(next as InvoiceTitleType)
                    }}
                    aria-label={t('Title type')}
                    variant='outline'
                    size='sm'
                    spacing={2}
                    className='grid w-full grid-cols-2 gap-2'
                  >
                    <ToggleGroupItem value='company' className='w-full'>
                      {t('Company')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value='personal' className='w-full'>
                      {t('Individual')}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {titleType === 'company'
                      ? t('Company name')
                      : t('Individual name')}{' '}
                    *
                  </FormLabel>
                  <FormControl>
                    <Input maxLength={100} autoComplete='off' {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {titleType === 'company' && (
              <FormField
                control={form.control}
                name='tax_no'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('Taxpayer identification number')} *
                    </FormLabel>
                    <FormControl>
                      <Input
                        maxLength={20}
                        autoComplete='off'
                        className='font-mono uppercase'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name='category'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Product category')} *</FormLabel>
                  <FormControl>
                    <NativeSelect className='w-full' {...field}>
                      {props.config.categories.map((category) => (
                        <NativeSelectOption key={category} value={category}>
                          {category}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Email for the invoice')} *</FormLabel>
                  <FormControl>
                    <Input
                      type='email'
                      maxLength={100}
                      autoComplete='email'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Separator />
            <dl className='flex flex-col gap-1.5 text-sm'>
              <div className='flex justify-between'>
                <dt className='text-muted-foreground'>{t('Invoice amount')}</dt>
                <dd className='tabular-nums'>
                  {formatInvoiceAmount(orderCents, locale)}
                </dd>
              </div>
              <div className='flex justify-between'>
                <dt className='text-muted-foreground'>
                  {t('Tax ({{rate}}%)', { rate: props.config.tax_rate })}
                </dt>
                <dd className='tabular-nums'>
                  {formatInvoiceAmount(taxCents, locale)}
                </dd>
              </div>
              <div className='flex justify-between font-semibold'>
                <dt>{t('Amount to pay')}</dt>
                <dd className='tabular-nums'>
                  {formatInvoiceAmount(taxCents, locale)}
                </dd>
              </div>
            </dl>
            {hasTax && (
              <FormField
                control={form.control}
                name='payment_method'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Pay the tax with')}</FormLabel>
                    <ToggleGroup
                      value={[field.value]}
                      onValueChange={(values) => {
                        const next = values.find(
                          (value) => value !== field.value
                        )
                        if (next) field.onChange(next as InvoiceTaxMethod)
                      }}
                      aria-label={t('Pay the tax with')}
                      variant='outline'
                      size='sm'
                      spacing={2}
                      className='grid w-full grid-cols-3 gap-2'
                    >
                      {methods.map((value) => (
                        <ToggleGroupItem
                          key={value}
                          value={value}
                          className='w-full'
                        >
                          {value === 'balance' && <Wallet aria-hidden='true' />}
                          {t(INVOICE_TAX_METHOD_LABEL[value])}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    {method === 'balance' ? (
                      <p
                        className={cn(
                          'text-xs',
                          shortOfBalance
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        )}
                      >
                        {t(
                          'Deducts {{quota}} from your balance of {{balance}}.',
                          {
                            quota: formatQuotaWithCurrency(taxQuota),
                            balance: formatQuotaWithCurrency(props.balance),
                          }
                        )}
                        {shortOfBalance && ` ${t('Insufficient balance')}`}
                      </p>
                    ) : (
                      <p className='text-muted-foreground text-xs'>
                        {t(
                          'The application goes to review after the tax is paid. Unpaid applications are cancelled after {{minutes}} minutes.',
                          { minutes: props.config.payment_timeout_minutes }
                        )}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            )}
            <Button type='submit' disabled={!canSubmit}>
              {submitting && (
                <Loader2 className='animate-spin' aria-hidden='true' />
              )}
              {hasTax ? t('Submit and pay tax') : t('Submit application')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
