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
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
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
import { handleServerError } from '@/lib/handle-server-error'

import { testSiteInsightsDigest } from '../api'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'

const createDigestSchema = (t: (key: string) => string) =>
  z.object({
    Enabled: z.boolean(),
    Hour: z.string().refine((value) => {
      const hour = Number(value)
      return /^\d+$/.test(value.trim()) && hour >= 0 && hour <= 23
    }, t('Send hour must be a whole number from 0 to 23.')),
    FeishuWebhook: z.string().refine((value) => {
      const trimmed = value.trim()
      return (
        trimmed === '' ||
        trimmed.startsWith('https://open.feishu.cn/open-apis/bot/v2/hook/') ||
        trimmed.startsWith('https://open.larksuite.com/open-apis/bot/v2/hook/')
      )
    }, t('Enter a Feishu or Lark custom bot webhook, starting with https://open.feishu.cn/open-apis/bot/v2/hook/.')),
    FeishuSecret: z.string(),
  })

type DigestFormValues = z.infer<ReturnType<typeof createDigestSchema>>

type SiteInsightsDigestSectionProps = {
  defaultValues: DigestFormValues
}

/** The daily digest of the root dashboard, posted to a Feishu bot. */
export function SiteInsightsDigestSection({
  defaultValues,
}: SiteInsightsDigestSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const digestSchema = createDigestSchema(t)

  const form = useForm<DigestFormValues>({
    resolver: zodResolver(digestSchema),
    defaultValues,
  })

  useResetForm(form, defaultValues)

  const testMutation = useMutation({
    mutationFn: testSiteInsightsDigest,
    onSuccess: (data) => {
      if (data.success) {
        toast.success(t('Test message sent.'))
      } else {
        handleServerError(data, t('Failed to send the test message'))
      }
    },
    onError: (error: Error) => {
      handleServerError(error, t('Failed to send the test message'))
    },
  })

  const onSubmit = async (values: DigestFormValues) => {
    const updates: Array<{ key: string; value: string | boolean }> = []
    if (values.Enabled !== defaultValues.Enabled) {
      updates.push({
        key: 'site_insights_digest_setting.enabled',
        value: values.Enabled,
      })
    }
    if (values.Hour.trim() !== defaultValues.Hour) {
      updates.push({
        key: 'site_insights_digest_setting.hour',
        value: values.Hour.trim(),
      })
    }
    if (values.FeishuWebhook.trim() !== defaultValues.FeishuWebhook.trim()) {
      updates.push({
        key: 'site_insights_digest_setting.feishu_webhook',
        value: values.FeishuWebhook.trim(),
      })
    }
    if (values.FeishuSecret.trim() !== defaultValues.FeishuSecret.trim()) {
      updates.push({
        key: 'site_insights_digest_setting.feishu_secret',
        value: values.FeishuSecret.trim(),
      })
    }
    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }
  }

  return (
    <SettingsSection title={t('Site insights digest')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save digest settings'
          />
          <FormField
            control={form.control}
            name='Enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Send the daily digest')}</FormLabel>
                  <FormDescription>
                    {t(
                      'The digest covers the previous day and is sent once a day from the send hour until midnight, Beijing time.'
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

          <FormField
            control={form.control}
            name='Hour'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Digest send hour (Beijing time)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={0}
                    max={23}
                    inputMode='numeric'
                    {...field}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='FeishuWebhook'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Feishu bot webhook')}</FormLabel>
                <FormControl>
                  <Input
                    type='url'
                    placeholder='https://open.feishu.cn/open-apis/bot/v2/hook/...'
                    autoComplete='off'
                    {...field}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='FeishuSecret'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Feishu bot signing secret')}</FormLabel>
                <FormControl>
                  <Input
                    type='password'
                    autoComplete='new-password'
                    {...field}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                </FormControl>
                <FormDescription>
                  {t('Leave blank if the bot does not sign messages.')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={
                testMutation.isPending ||
                defaultValues.FeishuWebhook.trim() === ''
              }
              onClick={() => testMutation.mutate()}
            >
              {t('Send test digest now')}
            </Button>
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
