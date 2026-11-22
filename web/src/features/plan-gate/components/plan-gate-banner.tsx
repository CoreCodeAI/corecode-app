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
/**
 * CoreCode fork: tells a customer whose newcomer plan was paused for a shared
 * network that their requests are being charged to the balance, and where to
 * ask for the plan back. The overview loads this module lazily, and only for a
 * customer with an active plan (see lib/mount.ts); the wallet renders it
 * directly.
 */
import { Link } from '@tanstack/react-router'
import { ArrowRight, ShieldAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { loadLocaleParts } from '@/i18n/config'
import { useAuthStore } from '@/stores/auth-store'

import { usePlanGateNotice } from '../hooks/use-plan-gate-notice'
import { dismissPlanGateBanner, readPlanGateDismissed } from '../lib/mount'
import { balanceHitCount, shouldShowPlanGateBanner } from '../lib/notice'

export function PlanGateBanner() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [dismissed, setDismissed] = useState(() =>
    readPlanGateDismissed(userId)
  )
  const { data: notice } = usePlanGateNotice(!dismissed)
  // The overview does not wait for the locale's rest part, which holds this
  // text; show the banner once it is in rather than in English first.
  const [localeReady, setLocaleReady] = useState(false)
  useEffect(() => {
    void loadLocaleParts(['core', 'rest']).then(() => setLocaleReady(true))
  }, [])
  if (!localeReady || !shouldShowPlanGateBanner(notice, dismissed)) return null

  return (
    <Alert className='border-warning/40 bg-warning/8' role='status'>
      <ShieldAlert className='text-warning' />
      <AlertTitle>{t('Newcomer plan paused')}</AlertTitle>
      <AlertDescription className='flex flex-wrap items-center justify-between gap-3'>
        <span>
          {t(
            'We detected that your network exit is shared with several newcomer plan accounts. To prevent abuse, the newcomer plan is paused: {{count}} requests in the last 24 hours were charged to your balance or refused. If you are a normal user, contact us in Feedback to restore it.',
            { count: balanceHitCount(notice) }
          )}
        </span>
        <span className='flex items-center gap-2'>
          <Button size='sm' render={<Link to='/feedback' />}>
            {t('Go to Feedback')}
            <ArrowRight data-icon='inline-end' />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('Dismiss')}
            onClick={() => {
              if (userId !== undefined) dismissPlanGateBanner(userId)
              setDismissed(true)
            }}
          >
            <X />
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}

export default PlanGateBanner
