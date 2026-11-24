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
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getAdminPlans } from '@/features/subscriptions/api'
import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'

// Mirrors ValidateAffiliateOption on the server.
const affiliateSchema = z
  .object({
    enabled: z.boolean(),
    self_serve_rate: z.number().int().min(0).max(100),
    max_rate: z.number().int().min(0).max(100),
    second_level_rate: z.number().int().min(0).max(100),
    min_withdrawal: z.number().int().min(0),
    gift_plan_id: z.number().int().min(0),
    retail_gift_plan_id: z.number().int().min(0),
    gift_daily_cap: z.number().int().min(0),
    gift_ip_limit: z.number().int().min(0),
    invite_bonus: z.number().min(0).max(1000),
    gift_blocked_email_domains: z.string(),
    reserved_code_words: z.string(),
  })
  .refine((v) => v.self_serve_rate <= v.max_rate, {
    path: ['self_serve_rate'],
    message: 'Default rate cannot exceed the maximum rate',
  })

type AffiliateFormValues = z.output<typeof affiliateSchema>

export type AffiliateValues = {
  'affiliate_setting.enabled': boolean
  'affiliate_setting.self_serve_rate': number
  'affiliate_setting.max_rate': number
  'affiliate_setting.second_level_rate': number
  'affiliate_setting.min_withdrawal': number
  'affiliate_setting.gift_plan_id': number
  'affiliate_setting.retail_gift_plan_id': number
  'affiliate_setting.gift_daily_cap': number
  'affiliate_setting.gift_ip_limit': number
  'affiliate_setting.invite_bonus': number
  'affiliate_setting.gift_blocked_email_domains': string
  'affiliate_setting.reserved_code_words': string
}

type AffiliateFormProps = {
  defaultValues: AffiliateValues
}

const toFormValues = (d: AffiliateValues): AffiliateFormValues => ({
  enabled: d['affiliate_setting.enabled'],
  self_serve_rate: d['affiliate_setting.self_serve_rate'],
  max_rate: d['affiliate_setting.max_rate'],
  second_level_rate: d['affiliate_setting.second_level_rate'],
  min_withdrawal: d['affiliate_setting.min_withdrawal'],
  gift_plan_id: d['affiliate_setting.gift_plan_id'],
  retail_gift_plan_id: d['affiliate_setting.retail_gift_plan_id'],
  gift_daily_cap: d['affiliate_setting.gift_daily_cap'],
  gift_ip_limit: d['affiliate_setting.gift_ip_limit'],
  invite_bonus: d['affiliate_setting.invite_bonus'],
  gift_blocked_email_domains: d['affiliate_setting.gift_blocked_email_domains'],
  reserved_code_words: d['affiliate_setting.reserved_code_words'],
})

const toOptionValues = (v: AffiliateFormValues): AffiliateValues => ({
  'affiliate_setting.enabled': v.enabled,
  'affiliate_setting.self_serve_rate': v.self_serve_rate,
  'affiliate_setting.max_rate': v.max_rate,
  'affiliate_setting.second_level_rate': v.second_level_rate,
  'affiliate_setting.min_withdrawal': v.min_withdrawal,
  'affiliate_setting.gift_plan_id': v.gift_plan_id,
  'affiliate_setting.retail_gift_plan_id': v.retail_gift_plan_id,
  'affiliate_setting.gift_daily_cap': v.gift_daily_cap,
  'affiliate_setting.gift_ip_limit': v.gift_ip_limit,
  'affiliate_setting.invite_bonus': v.invite_bonus,
  'affiliate_setting.gift_blocked_email_domains':
    v.gift_blocked_email_domains.trim(),
  'affiliate_setting.reserved_code_words': v.reserved_code_words.trim(),
})

type PlanName = 'gift_plan_id' | 'retail_gift_plan_id'
type NumberName = Exclude<
  keyof AffiliateFormValues,
  'enabled' | 'gift_blocked_email_domains' | 'reserved_code_words' | PlanName
>

export function AffiliateForm(props: AffiliateFormProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<AffiliateFormValues, unknown, AffiliateFormValues>({
    resolver: zodResolver(affiliateSchema),
    mode: 'onChange',
    defaultValues: toFormValues(props.defaultValues),
  })

  useEffect(() => {
    form.reset(toFormValues(props.defaultValues))
  }, [props.defaultValues, form])

  const plans = useQuery({
    queryKey: ['subscription', 'admin-plans'],
    queryFn: async () => (await getAdminPlans()).data ?? [],
  })
  const giftPlanItems = [
    { value: '0', label: t('Off') },
    ...(plans.data ?? []).map(({ plan }) => ({
      value: String(plan.id),
      label: plan.enabled ? plan.title : `${plan.title} (${t('Disabled')})`,
    })),
  ]

  const onSubmit = async (values: AffiliateFormValues) => {
    const normalized = toOptionValues(values)
    for (const key of Object.keys(normalized) as Array<keyof AffiliateValues>) {
      const value = normalized[key]
      if (value !== props.defaultValues[key]) {
        await updateOption.mutateAsync({ key, value })
      }
    }
  }

  // A step below 1 accepts decimals, such as an amount of money.
  const numberField = (
    name: NumberName,
    label: string,
    description: string,
    step = 1
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type='number'
              min={0}
              step={step}
              {...field}
              onChange={(e) =>
                field.onChange(
                  (step < 1
                    ? Number.parseFloat(e.target.value)
                    : Number.parseInt(e.target.value, 10)) || 0
                )
              }
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  const planField = (name: PlanName, label: string, description: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            items={giftPlanItems}
            onValueChange={(value) => field.onChange(Number(value))}
            value={String(field.value)}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {giftPlanItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FormDescription>{description}</FormDescription>
        </FormItem>
      )}
    />
  )

  return (
    <Form {...form}>
      <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsPageFormActions
          onSave={form.handleSubmit(onSubmit)}
          isSaving={updateOption.isPending}
          saveLabel='Save invitation settings'
        />
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <SettingsSwitchItem>
              <SettingsSwitchContent>
                <FormLabel>{t('Enable invitation program')}</FormLabel>
                <FormDescription>
                  {t(
                    'Every customer can invite. On the bonus reward both sides receive the invite bonus; on the commission reward the inviter earns their rate on what invitees pay for and use. Turning it off hides the program; earned commission is kept.'
                  )}
                </FormDescription>
              </SettingsSwitchContent>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </SettingsSwitchItem>
          )}
        />
        <SettingsFormGrid>
          {numberField(
            'self_serve_rate',
            t('Default rate (%)'),
            t(
              'Commission rate every customer has unless an administrator sets another. 0 gives no one a default.'
            )
          )}
          {numberField(
            'max_rate',
            t('Maximum rate (%)'),
            t(
              'The highest commission rate an administrator can set for a user.'
            )
          )}
          {numberField(
            'second_level_rate',
            t('Second-level rate (%)'),
            t(
              'Extra commission distributor channels earn from users their invitees invite.'
            )
          )}
          {numberField(
            'min_withdrawal',
            t('Minimum withdrawal'),
            t(
              'The smallest cash payout a promotion channel can request, in the payment currency.'
            )
          )}
          {planField(
            'retail_gift_plan_id',
            t('Retail channel gift plan'),
            t(
              'Every user who signs up with a retail channel code receives this plan, free. An invitee who received it cannot buy it.'
            )
          )}
          {planField(
            'gift_plan_id',
            t('Distributor channel gift plan'),
            t(
              'Every user who signs up with a distributor channel code receives this plan, free. An invitee who received it cannot buy it.'
            )
          )}
          {numberField(
            'invite_bonus',
            t('Invite bonus'),
            t(
              'What a customer on the bonus reward and each user they invite receive in the wallet: the invitee at sign-up, the inviter once the invitee has paid at least as much. Channels, rates you set, and customers who had invited someone before the bonus keep their commission. 0 turns it off.'
            ),
            0.01
          )}
          {numberField(
            'gift_ip_limit',
            t('Gifts per address'),
            t(
              'The most sign-up gifts, a channel plan or the invite bonus, that sign-ups from one address receive in 30 days. 0 is no limit.'
            )
          )}
          {numberField(
            'gift_daily_cap',
            t('Daily gifts per channel'),
            t(
              "The most sign-up gifts one inviter's invitees receive in 24 hours; later sign-ups still bind but receive nothing. 0 is no limit."
            )
          )}
          <FormField
            control={form.control}
            name='gift_blocked_email_domains'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Blocked email domains')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder='mailinator.com' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'One per line. Sign-ups from these domains and their subdomains receive no gift.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='reserved_code_words'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reserved invite code words')}</FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder='corecode' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'One per line. Users cannot choose one of these words as their code, ignoring case, hyphens and underscores; a code that only contains one is allowed. Simple codes such as 888, 6688 or 123 are always reserved. Codes you set for a user are not checked.'
                  )}
                </FormDescription>
              </FormItem>
            )}
          />
        </SettingsFormGrid>
      </SettingsForm>
    </Form>
  )
}
