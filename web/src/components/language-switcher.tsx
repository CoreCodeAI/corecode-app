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
import { Check, Globe } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { normalizeInterfaceLanguage } from '@/i18n/languages'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

// The languages corecode.live is written in that the console has a locale for,
// in the order of the static site's language menu. fr and vi stay reachable
// from the profile page.
const SWITCHER_LANGUAGES = [
  { code: 'zhCN', label: '简体中文', tag: 'zh-CN' },
  { code: 'en', label: 'English', tag: 'en' },
  { code: 'ja', label: '日本語', tag: 'ja' },
  { code: 'ko', label: '한국어', tag: 'ko' },
  { code: 'ru', label: 'Русский', tag: 'ru' },
  { code: 'zhTW', label: '繁體中文', tag: 'zh-TW' },
] as const

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const current = normalizeInterfaceLanguage(i18n.language)
  const label =
    SWITCHER_LANGUAGES.find((option) => option.code === current)?.label ??
    'English'

  const handleChangeLanguage = useCallback(
    async (code: string) => {
      await i18n.changeLanguage(code)
      if (user) {
        try {
          await api.put('/api/user/self', { language: code })
        } catch {
          // Best-effort persistence; don't block the UI on failure
        }
      }
    },
    [i18n, user]
  )

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='text-muted-foreground hover:text-foreground h-9 shrink-0 gap-1.5 px-2.5'
            aria-label={t('Change language')}
          />
        }
      >
        <Globe className='size-4' aria-hidden='true' />
        <span className='hidden text-sm sm:inline'>{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {SWITCHER_LANGUAGES.map((option) => {
          const active = option.code === current
          return (
            <DropdownMenuItem
              key={option.code}
              lang={option.tag}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                if (!active) handleChangeLanguage(option.code)
              }}
            >
              {option.label}
              <Check size={14} className={cn('ms-auto', !active && 'hidden')} />
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
