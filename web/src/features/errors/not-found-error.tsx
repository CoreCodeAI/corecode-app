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
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SignatureMark } from '@/components/signature-mark'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/use-document-title'
import { useNoIndex } from '@/hooks/use-no-index'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

type NotFoundErrorProps = {
  /** Render inside the console shell: fill the content area, not the viewport. */
  embedded?: boolean
}

export function NotFoundError(props: NotFoundErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { history } = useRouter()
  const signedIn = useAuthStore((state) => !!state.auth.user)
  useNoIndex()
  useDocumentTitle('404')
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden',
        props.embedded ? 'h-full min-h-80' : 'h-svh'
      )}
    >
      <SignatureMark className='absolute inset-0 -z-10 m-auto h-full max-h-96 max-w-full rounded-full opacity-10' />
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'>404</h1>
        <span className='font-medium'>{t('Oops! Page Not Found!')}</span>
        <p className='text-muted-foreground text-center'>
          {t("It seems like the page you're looking for")} <br />
          {t('does not exist or might have been removed.')}
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant='outline' onClick={() => history.go(-1)}>
            {t('Go Back')}
          </Button>
          <Button
            onClick={() => navigate({ to: signedIn ? '/dashboard' : '/' })}
          >
            {t('Back to Home')}
          </Button>
        </div>
      </div>
    </div>
  )
}
