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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

import {
  getDigestSettings,
  saveDigestSettings,
  sendTestDigest,
  type DigestSettings as Saved,
} from '../api'

const QUERY_KEY = ['site-insights', 'digest-settings']

/** A whole hour of the day, 0 to 23. */
function validHour(value: string): boolean {
  return /^\d{1,2}$/.test(value.trim()) && Number(value) <= 23
}

function DigestForm(props: { saved: Saved }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const saved = props.saved
  const [enabled, setEnabled] = useState(saved.enabled)
  const [hour, setHour] = useState(saved.hour)
  const [webhook, setWebhook] = useState(saved.webhook)
  // The server never sends the secret back: blank leaves the saved one.
  const [secret, setSecret] = useState('')
  const changes = {
    ...(webhook.trim() !== saved.webhook && { webhook: webhook.trim() }),
    ...(secret.trim() !== '' && { secret: secret.trim() }),
    ...(hour.trim() !== saved.hour && { hour: hour.trim() }),
    ...(enabled !== saved.enabled && { enabled }),
  }
  const save = useMutation({
    mutationFn: () => saveDigestSettings(changes),
    onSuccess: () => toast.success(t('Saved successfully')),
    onError: (error: Error) => toast.error(error.message),
    // Refused or not, what the server holds now is what the form starts from.
    onSettled: () => client.invalidateQueries({ queryKey: QUERY_KEY }),
  })
  const test = useMutation({
    mutationFn: sendTestDigest,
    onSuccess: () => toast.success(t('Test message sent.')),
    onError: (error: Error) => toast.error(error.message),
  })
  const hourValid = validHour(hour)
  return (
    <form
      className='grid gap-3'
      onSubmit={(event) => {
        event.preventDefault()
        if (hourValid) save.mutate()
      }}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='grid gap-0.5'>
          <Label htmlFor='digest-enabled'>{t('Daily Feishu digest')}</Label>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Yesterday against the day before, sent once a day after the send hour.'
            )}
          </p>
        </div>
        <Switch
          id='digest-enabled'
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor='digest-hour'>
          {t('Send hour, 0 to 23, Beijing time')}
        </Label>
        <Input
          id='digest-hour'
          inputMode='numeric'
          value={hour}
          aria-invalid={!hourValid}
          onChange={(event) => setHour(event.target.value)}
        />
        {!hourValid && (
          <p className='text-destructive text-xs'>
            {t('Enter a whole number')}
          </p>
        )}
      </div>
      <div className='grid gap-1'>
        <Label htmlFor='digest-webhook'>{t('Feishu bot webhook')}</Label>
        <Input
          id='digest-webhook'
          type='url'
          autoComplete='off'
          placeholder='https://open.feishu.cn/open-apis/bot/v2/hook/...'
          value={webhook}
          onChange={(event) => setWebhook(event.target.value)}
        />
      </div>
      <div className='grid gap-1'>
        <Label htmlFor='digest-secret'>{t('Feishu signing secret')}</Label>
        <Input
          id='digest-secret'
          type='password'
          autoComplete='new-password'
          placeholder={t('Leave blank unless updating')}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
      </div>
      <div className='flex justify-between gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          // The test goes to the saved webhook, so there must be one.
          disabled={test.isPending || saved.webhook === ''}
          onClick={() => test.mutate()}
        >
          {t('Send test message')}
        </Button>
        <Button
          type='submit'
          size='sm'
          disabled={
            save.isPending || !hourValid || Object.keys(changes).length === 0
          }
        >
          {t('Save')}
        </Button>
      </div>
    </form>
  )
}

/**
 * The daily Feishu digest's settings, opened from the overview, whose
 * findings the digest sends. They are read when the panel opens, and the
 * form starts again from what the server holds after every save.
 */
export function DigestSettings() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const saved = useQuery({
    queryKey: QUERY_KEY,
    queryFn: getDigestSettings,
    enabled: open,
    meta: { errorToast: false },
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='outline' size='sm' />}>
        <Send />
        {t('Daily Feishu digest')}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 gap-0 p-4'>
        {saved.data && (
          <DigestForm
            // A save changes what the form starts from.
            key={JSON.stringify(saved.data)}
            saved={saved.data}
          />
        )}
        {saved.isPending && <Skeleton className='h-40 w-full' />}
        {saved.isError && (
          <p className='text-destructive text-xs'>
            {saved.error instanceof Error
              ? saved.error.message
              : t('Could not be read')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
