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
import { Link, useSearch } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { TermsGate } from '../components/terms-gate'
import { MagicLinkForm } from './components/magic-link-form'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()
  const { systemName } = useSystemConfig()

  const magicLinkEnabled =
    (status?.magic_link_enabled ?? status?.data?.magic_link_enabled ?? true) !==
    false
  const magicLinkRegisterEnabled =
    (status?.magic_link_register_enabled ??
      status?.data?.magic_link_register_enabled ??
      true) !== false
  const passwordLoginEnabled =
    (status?.password_login_enabled ??
      status?.data?.password_login_enabled ??
      true) !== false
  // OAuth already sits above the emailed link, so only the password form,
  // passkeys and WeChat need the second view.
  const hasOtherLogin = Boolean(status?.passkey_login || status?.wechat_login)

  // The emailed link is the customer path; the password form stays reachable for
  // the root account and for passkey or WeChat sign-in.
  const [showPasswordForm, setShowPasswordForm] = useState(!magicLinkEnabled)
  const showOtherWays =
    magicLinkEnabled && (passwordLoginEnabled || hasOtherLogin)

  // A separate sign-up page is only needed when the link itself cannot create
  // the account.
  const showRegisterLink =
    !status?.self_use_mode_enabled &&
    status?.register_enabled !== false &&
    !(magicLinkEnabled && magicLinkRegisterEnabled)

  return (
    <AuthLayout>
      <div className='w-full space-y-8'>
        <div className='space-y-2'>
          <h1 className='text-3xl'>
            {t('Sign in to {{name}}', { name: systemName })}
          </h1>
          {showRegisterLink && (
            <p className='text-muted-foreground text-sm'>
              {t("Don't have an account?")}{' '}
              <Link
                to='/sign-up'
                search={{ redirect }}
                className='text-primary font-medium underline-offset-4 hover:underline'
              >
                {t('Sign up')}
              </Link>
            </p>
          )}
        </div>

        <TermsGate status={status}>
          {showPasswordForm ? (
            <UserAuthForm redirectTo={redirect} />
          ) : (
            <MagicLinkForm
              redirectTo={redirect}
              registrationEnabled={magicLinkRegisterEnabled}
              showOAuthProviders
            />
          )}
        </TermsGate>

        {showOtherWays && (
          <Button
            type='button'
            variant='link'
            className='text-muted-foreground hover:text-foreground w-full'
            onClick={() => setShowPasswordForm((current) => !current)}
          >
            {showPasswordForm
              ? t('Sign in with an email link')
              : t('Sign in another way')}
          </Button>
        )}

        <TermsFooter
          variant='sign-in'
          status={status}
          className='text-center'
        />
      </div>
    </AuthLayout>
  )
}
