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
import { KeyRound, Play, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

/**
 * CoreCode fork: what to do next from a model's page. A visitor is sent to
 * sign up; a signed-in customer to create a key, or to try the model in the
 * playground with it already chosen.
 */
export function ModelCta(props: { modelName: string }) {
  const { t } = useTranslation()
  const signedIn = useAuthStore((state) => Boolean(state.auth.user))

  if (!signedIn) {
    return (
      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <Button size='sm' render={<Link to='/sign-up' />}>
          <UserPlus className='size-4' aria-hidden />
          {t('Sign up to get started')}
        </Button>
      </div>
    )
  }

  return (
    <div className='mt-3 flex flex-wrap items-center gap-2'>
      <Button size='sm' render={<Link to='/keys' />}>
        <KeyRound className='size-4' aria-hidden />
        {t('Create an API key')}
      </Button>
      <Button
        size='sm'
        variant='outline'
        render={<Link to='/playground' search={{ model: props.modelName }} />}
      >
        <Play className='size-4' aria-hidden />
        {t('Try in the playground')}
      </Button>
    </div>
  )
}
