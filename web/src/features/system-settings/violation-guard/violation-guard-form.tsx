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

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { useUpdateOption } from '../hooks/use-update-option'

// Mirrors ValidateViolationGuardOption on the server.
const violationGuardSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['observe', 'enforce']),
  suspend_hours: z.number().int().min(0),
  ban_strikes: z.number().int().min(0),
  strike_window_days: z.number().int().min(1),
  lenient_categories: z.string(),
  client_check_limit: z.number().int().min(0),
})

type ViolationGuardFormValues = z.output<typeof violationGuardSchema>

export type ViolationGuardValues = {
  'violation_guard_setting.enabled': boolean
  'violation_guard_setting.mode': 'observe' | 'enforce'
  'violation_guard_setting.suspend_hours': number
  'violation_guard_setting.ban_strikes': number
  'violation_guard_setting.strike_window_days': number
  'violation_guard_setting.lenient_categories': string
  'violation_guard_setting.client_check_limit': number
}

type ViolationGuardFormProps = {
  defaultValues: ViolationGuardValues
}

const toFormValues = (
  defaults: ViolationGuardValues
): ViolationGuardFormValues => ({
  enabled: defaults['violation_guard_setting.enabled'],
  mode: defaults['violation_guard_setting.mode'],
  suspend_hours: defaults['violation_guard_setting.suspend_hours'],
  ban_strikes: defaults['violation_guard_setting.ban_strikes'],
  strike_window_days: defaults['violation_guard_setting.strike_window_days'],
  lenient_categories: defaults['violation_guard_setting.lenient_categories'],
  client_check_limit: defaults['violation_guard_setting.client_check_limit'],
})

const toOptionValues = (
  values: ViolationGuardFormValues
): ViolationGuardValues => ({
  'violation_guard_setting.enabled': values.enabled,
  'violation_guard_setting.mode': values.mode,
  'violation_guard_setting.suspend_hours': values.suspend_hours,
  'violation_guard_setting.ban_strikes': values.ban_strikes,
  'violation_guard_setting.strike_window_days': values.strike_window_days,
  'violation_guard_setting.lenient_categories':
    values.lenient_categories.trim(),
  'violation_guard_setting.client_check_limit': values.client_check_limit,
})

export function ViolationGuardForm(props: ViolationGuardFormProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const form = useForm<
    ViolationGuardFormValues,
    unknown,
    ViolationGuardFormValues
  >({
    resolver: zodResolver(violationGuardSchema),
    mode: 'onChange',
    defaultValues: toFormValues(props.defaultValues),
  })

  useEffect(() => {
    form.reset(toFormValues(props.defaultValues))
  }, [props.defaultValues, form])

  const onSubmit = async (values: ViolationGuardFormValues) => {
    const normalized = toOptionValues(values)
    for (const key of Object.keys(normalized) as Array<
      keyof ViolationGuardValues
    >) {
      const value = normalized[key]
      if (value !== props.defaultValues[key]) {
        await updateOption.mutateAsync({ key, value })
      }
    }
  }

  const numberField = (
    name:
      | 'suspend_hours'
      | 'ban_strikes'
      | 'strike_window_days'
      | 'client_check_limit',
    label: string,
    description: string,
    min: number
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
              min={min}
              step={1}
              {...field}
              onChange={(e) =>
                field.onChange(Number.parseInt(e.target.value, 10) || min)
              }
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
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
          saveLabel='Save violation settings'
        />
        <FormField
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <SettingsSwitchItem>
              <SettingsSwitchContent>
                <FormLabel>{t('Enable violation handling')}</FormLabel>
                <FormDescription>
                  {t(
                    'When the upstream model refuses a request under its usage policy, record a violation against the customer who sent it. Administrators are never restricted.'
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
          <FormField
            control={form.control}
            name='mode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Mode')}</FormLabel>
                <Select
                  items={[
                    { value: 'observe', label: t('Observe - record only') },
                    {
                      value: 'enforce',
                      label: t('Enforce - suspend and disable'),
                    },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='observe'>
                        {t('Observe - record only')}
                      </SelectItem>
                      <SelectItem value='enforce'>
                        {t('Enforce - suspend and disable')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'Observe mode records what would have happened and restricts no one.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {numberField(
            'suspend_hours',
            t('Suspension hours'),
            t(
              'How long one violation suspends the customer API access. 0 means no suspension; violations are still counted.'
            ),
            0
          )}
          {numberField(
            'ban_strikes',
            t('Violations before disabling'),
            t(
              'Disable the account when this many violations fall within the counting window. 0 never disables the account.'
            ),
            0
          )}
          {numberField(
            'strike_window_days',
            t('Counting window (days)'),
            t(
              'Violations older than this no longer count toward disabling, and a refused conversation stays blocked for this long.'
            ),
            1
          )}
          <FormField
            control={form.control}
            name='lenient_categories'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Warn-first categories')}</FormLabel>
                <FormControl>
                  <Input placeholder='reasoning_extraction' {...field} />
                </FormControl>
                <FormDescription>
                  {t(
                    'Refusal categories, separated by commas, whose first refusal in the counting window is only a warning: the refused conversation stays blocked, but the customer is not suspended and the warning does not count toward disabling.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {numberField(
            'client_check_limit',
            t('Client check limit'),
            t(
              'Stop forwarding the client checks of a customer, such as the check Claude Code auto mode sends before a tool call, once the upstream has refused this many of them within 24 hours. They never count as violations. 0 always forwards them.'
            ),
            0
          )}
        </SettingsFormGrid>
      </SettingsForm>
    </Form>
  )
}
