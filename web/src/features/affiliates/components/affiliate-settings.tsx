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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'

import { AffiliateForm, type AffiliateValues } from './affiliate-form'

// What the server applies while an option row is missing.
const AFFILIATE_DEFAULTS: AffiliateValues = {
  'affiliate_setting.enabled': false,
  'affiliate_setting.self_serve_rate': 10,
  'affiliate_setting.max_rate': 30,
  'affiliate_setting.second_level_rate': 5,
  'affiliate_setting.min_withdrawal': 100,
  'affiliate_setting.gift_plan_id': 0,
  'affiliate_setting.retail_gift_plan_id': 0,
  'affiliate_setting.gift_daily_cap': 50,
  'affiliate_setting.gift_ip_limit': 5,
  'affiliate_setting.invite_bonus': 5,
  'affiliate_setting.gift_blocked_email_domains': '',
  'affiliate_setting.reserved_code_words':
    'corecode\nalphafox\nanthropic\nclaude\nofficial\nguanfang\nadmin\nsupport\nkefu',
}

/** The program's terms, saved as option rows like any system setting. */
export function AffiliateSettings() {
  const { t } = useTranslation()
  const options = useSystemOptions()
  const [actions, setActions] = useState<HTMLDivElement | null>(null)
  const values = useMemo(
    () => getOptionValue(options.data?.data, AFFILIATE_DEFAULTS),
    [options.data?.data]
  )

  if (options.isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'>
        {t('Loading settings...')}
      </div>
    )
  }
  if (options.isError) {
    return (
      <p className='text-destructive text-sm'>{t('Failed to load settings')}</p>
    )
  }
  return (
    <SettingsPageProvider actionsContainer={actions}>
      <div className='flex max-w-3xl flex-col gap-4'>
        <div ref={setActions} className='flex justify-end' />
        <AffiliateForm defaultValues={values} />
      </div>
    </SettingsPageProvider>
  )
}
