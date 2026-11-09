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
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { signInWithMagicLink } from '@/features/auth/api'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { authErrorMessage } from '@/lib/secure-verification'

import { AuthLayout } from '../auth-layout'

export type EmailLoginSearchParams = {
  token?: string
  redirect?: string
}

type EmailLoginConfirmProps = EmailLoginSearchParams

// The mailed link lands here. The token is posted once and then removed from the
// address bar, so a later view of history or a shared screen cannot reuse it;
// the server enforces the same single use.
export function EmailLoginConfirm({ token, redirect }: EmailLoginConfirmProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { handleLoginResult } = useAuthRedirect()
  const [error, setError] = useState('')
  // The router listens to history writes, so the rewrite below drops `token`
  // from the search params while the request is still in flight. The view
  // keys off the token it claimed on mount, not the live prop.
  const [linkToken] = useState(token)
  const consumed = useRef(false)

  useEffect(() => {
    if (!linkToken || consumed.current) return
    consumed.current = true

    // The token lives in the address bar only until this effect claims it, so
    // a reload or a shared screen no longer exposes a live link.
    window.history.replaceState(null, '', window.location.pathname)

    async function consume() {
      try {
        const res = await signInWithMagicLink(linkToken as string)
        if (res?.success) {
          await handleLoginResult(res.data, redirect)
          return
        }
        setError(t('This sign-in link is invalid or has expired.'))
      } catch (error: unknown) {
        setError(
          authErrorMessage(
            error,
            t('This sign-in link is invalid or has expired.')
          )
        )
      }
    }
    void consume()
  }, [handleLoginResult, linkToken, redirect, t])

  if (!linkToken || error) {
    return (
      <AuthLayout>
        <div className='w-full space-y-6'>
          <h2 className='text-center text-2xl font-semibold tracking-tight'>
            {t('Sign in')}
          </h2>
          <Alert variant='destructive'>
            <AlertDescription>
              {error || t('This sign-in link is invalid or has expired.')}
            </AlertDescription>
          </Alert>
          <Button
            variant='link'
            className='w-full'
            onClick={() => navigate({ to: '/sign-in', replace: true })}
          >
            {t('Request a new link')}
          </Button>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <div className='text-muted-foreground flex w-full items-center justify-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        {t('Signing you in…')}
      </div>
    </AuthLayout>
  )
}
