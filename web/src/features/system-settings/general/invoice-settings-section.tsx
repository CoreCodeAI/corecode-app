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
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

// Bounds match setting/operation_setting/invoice_setting.go, which checks
// them again.
const schema = z.object({
  enabled: z.boolean(),
  tax_rate: z.coerce
    .number()
    .min(0)
    .max(100)
    .refine((value) => Number.isInteger(Math.round(value * 100 * 1e6) / 1e6), {
      message: 'Use at most two decimals',
    }),
  categories: z
    .string()
    .refine((value) => value.split('\n').some((line) => line.trim() !== ''), {
      message: 'Enter at least one category',
    }),
  order_days: z.coerce.number().int().min(1).max(3650),
  max_orders: z.coerce.number().int().min(1).max(200),
  payment_timeout_minutes: z.coerce.number().int().min(5).max(1440),
  file_max_kb: z.coerce.number().int().min(10).max(10240),
})

type Values = z.infer<typeof schema>

const NUMBER_FIELDS = [
  {
    name: 'tax_rate',
    label: 'General invoice tax rate (%)',
    description:
      'Charged on top of the order amount for a general VAT invoice. 0 means no tax.',
    step: '0.01',
  },
  {
    name: 'order_days',
    label: 'Invoiceable period (days)',
    description: 'Orders paid within this many days can be invoiced.',
    step: '1',
  },
  {
    name: 'max_orders',
    label: 'Orders per application',
    description: 'The most orders one application can carry.',
    step: '1',
  },
  {
    name: 'payment_timeout_minutes',
    label: 'Tax payment timeout (minutes)',
    description:
      'Applications whose tax is not paid in time are cancelled and their orders released.',
    step: '1',
  },
  {
    name: 'file_max_kb',
    label: 'Invoice file size limit (KB)',
    description: 'Largest invoice file an administrator can upload.',
    step: '1',
  },
] as const

export function InvoiceSettingsSection(props: { defaultValues: Values }) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<Values>({
    resolver: zodResolver(schema) as unknown as Resolver<Values>,
    defaultValues: props.defaultValues,
  })
  const { isDirty, isSubmitting } = form.formState
  const saving = updateOption.isPending || isSubmitting

  async function onSubmit(values: Values) {
    const keys = Object.keys(values) as (keyof Values)[]
    const changed = keys.filter(
      (key) => String(values[key]) !== String(props.defaultValues[key])
    )
    if (changed.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    // Turning invoicing on goes last, after the terms it offers are saved.
    changed.sort((a, b) => Number(a === 'enabled') - Number(b === 'enabled'))
    for (const key of changed) {
      await updateOption.mutateAsync({
        key: `invoice_setting.${key}`,
        value: String(values[key]),
      })
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Invoicing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={saving}
            isSaveDisabled={!isDirty}
            saveLabel='Save invoice settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable invoicing')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Customers request general VAT invoices for paid top-ups and plans in the invoice center.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={saving}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
          <div className='grid gap-6 sm:grid-cols-2'>
            {NUMBER_FIELDS.map((item) => (
              <FormField
                key={item.name}
                control={form.control}
                name={item.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(item.label)}</FormLabel>
                    <FormControl>
                      <Input type='number' step={item.step} {...field} />
                    </FormControl>
                    <FormDescription>{t(item.description)}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>
          <FormField
            control={form.control}
            name='categories'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Product categories')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'One category per line. Customers pick one for each invoice.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
