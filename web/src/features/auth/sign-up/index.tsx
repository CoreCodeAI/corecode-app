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
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'

import { AuthLayout } from '../auth-layout'
import { TermsFooter } from '../components/terms-footer'
import { TermsGate } from '../components/terms-gate'
import { MagicLinkForm } from '../sign-in/components/magic-link-form'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { status } = useStatus()

  // Registration is part of sign-in: an emailed link creates the account for an
  // unknown address. The password form stays the entry only while the link is
  // switched off.
  const magicLinkEnabled =
    (status?.magic_link_enabled ?? status?.data?.magic_link_enabled ?? true) !==
    false
  const magicLinkRegisterEnabled =
    (status?.magic_link_register_enabled ??
      status?.data?.magic_link_register_enabled ??
      true) !== false
  const oauthRegisterEnabled =
    (status?.oauth_register_enabled ??
      status?.data?.oauth_register_enabled ??
      true) !== false

  return (
    <AuthLayout>
      <div className='w-full space-y-8'>
        <div className='space-y-2'>
          <h1 className='text-3xl'>{t('Create an account')}</h1>
          <p className='text-muted-foreground text-sm'>
            {t('Already have an account?')}{' '}
            <Link
              to='/sign-in'
              className='text-primary font-medium underline-offset-4 hover:underline'
            >
              {t('Sign in')}
            </Link>
          </p>
        </div>

        <TermsGate status={status}>
          {magicLinkEnabled && magicLinkRegisterEnabled ? (
            <MagicLinkForm showOAuthProviders={oauthRegisterEnabled} />
          ) : (
            <SignUpForm />
          )}
        </TermsGate>

        <TermsFooter
          variant='sign-up'
          status={status}
          className='text-center'
        />
      </div>
    </AuthLayout>
  )
}
