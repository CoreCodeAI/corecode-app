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
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  KeyRound,
  Settings,
  Wallet,
} from 'lucide-react'
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
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import {
  FALLBACK_ERROR_CONTENT,
  getMessageErrorState,
  isAdminRole,
  MODEL_PRICING_SETTINGS_PATH,
} from '../../lib'
import type { Message } from '../../types'

interface MessageErrorProps {
  message: Message
  className?: string
  actions?: ReactNode
}

/**
 * Display error messages using Alert component
 * Following ai-elements pattern for error handling
 */
export function MessageError({
  message,
  className = '',
  actions,
}: MessageErrorProps) {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const errorState = getMessageErrorState(message, isAdminRole(user?.role))

  if (!errorState) {
    return null
  }

  if (errorState.kind === 'model-price') {
    const content =
      errorState.content === FALLBACK_ERROR_CONTENT
        ? t(FALLBACK_ERROR_CONTENT)
        : errorState.content

    return (
      <Alert variant='default' className={className}>
        <AlertTriangle className='text-orange-500' />
        <AlertTitle>{t('Model Price Not Configured')}</AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>{content}</p>
          {errorState.showSettingsLink && (
            <Button
              variant='outline'
              size='sm'
              onClick={() => window.open(MODEL_PRICING_SETTINGS_PATH, '_blank')}
            >
              <Settings className='mr-1 h-3.5 w-3.5' />
              {t('Go to Settings')}
            </Button>
          )}
          {actions}
        </AlertDescription>
      </Alert>
    )
  }

  if (
    errorState.kind === 'model-not-in-group' ||
    errorState.kind === 'model-wrong-endpoint'
  ) {
    // The server's text names the groups and the endpoint; the buttons are the
    // way out. A video model's text points at /v1/videos, so link its page.
    const prefix = (i18n.resolvedLanguage || i18n.language).startsWith('zh')
      ? '/docs'
      : '/docs/en'
    const docsUrl = errorState.content.includes('/v1/videos')
      ? `${prefix}/api/videos/`
      : `${prefix}/groups/`
    return (
      <Alert variant='default' className={className}>
        <AlertTriangle className='text-orange-500' />
        <AlertTitle>
          {errorState.kind === 'model-not-in-group'
            ? t('This key cannot use this model')
            : t('This model needs a different endpoint')}
        </AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>{errorState.content}</p>
          <div className='flex flex-wrap gap-2'>
            {errorState.kind === 'model-not-in-group' && (
              <Button size='sm' render={<Link to='/keys' />}>
                <KeyRound className='mr-1 h-3.5 w-3.5' />
                {t('Create a key')}
              </Button>
            )}
            <Button
              variant='outline'
              size='sm'
              render={<a href={docsUrl} target='_blank' rel='noreferrer' />}
            >
              <BookOpen className='mr-1 h-3.5 w-3.5' />
              {t('View docs')}
            </Button>
          </div>
          {actions}
        </AlertDescription>
      </Alert>
    )
  }

  if (errorState.kind === 'insufficient-balance') {
    // The server's text quotes raw quota units, so show a plain message instead.
    return (
      <Alert variant='default' className={className}>
        <Wallet className='text-orange-500' />
        <AlertTitle>{t('Insufficient balance')}</AlertTitle>
        <AlertDescription className='space-y-2'>
          <p>
            {t(
              'Your balance is too low for this request. Top up to keep chatting.'
            )}
          </p>
          <Button size='sm' render={<Link to='/wallet' />}>
            {t('Go to top up')}
          </Button>
          {actions}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant='destructive' className={className}>
      <AlertCircle />
      <AlertTitle>{t('Error')}</AlertTitle>
      <AlertDescription className='space-y-2'>
        <p>
          {errorState.content === FALLBACK_ERROR_CONTENT
            ? t(FALLBACK_ERROR_CONTENT)
            : errorState.content}
        </p>
        {actions}
      </AlertDescription>
    </Alert>
  )
}
