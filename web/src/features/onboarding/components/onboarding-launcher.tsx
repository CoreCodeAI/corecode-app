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
 * CoreCode fork: the overview's host for the onboarding wizard. The overview
 * loads this module only for an account that has not made a request, and the
 * wizard itself only when it opens, so the first load of /dashboard/overview
 * pays for neither (one chunk: each extra async chunk costs the page's entry
 * a few bytes of chunk map). It opens the wizard once per account, right after the
 * first sign-in, and keeps a card on the overview to reopen it.
 */
import { ListChecks } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { isFirstRun } from '@/features/dashboard/lib/first-run'
import { useRefreshSelf } from '@/hooks/use-self'
import { loadLocaleParts } from '@/i18n/config'
import { useAuthStore } from '@/stores/auth-store'

import { dismissOnboarding, isOnboardingDismissed } from '../lib/onboarding'
import { OnboardingWizard } from './onboarding-wizard'

export default function OnboardingLauncher() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const refreshSelf = useRefreshSelf()
  const [localeReady, setLocaleReady] = useState(false)
  const [open, setOpen] = useState(false)
  const decided = useRef(false)

  // The wizard's strings are in the locale's rest part, which the overview does
  // not wait for. Open it once they are in, and only for an account whose
  // fresh figures still show no request: the signed-in copy can be hours old.
  useEffect(() => {
    if (!user || decided.current) return
    decided.current = true
    void (async () => {
      await loadLocaleParts(['core', 'rest'])
      setLocaleReady(true)
      if (isOnboardingDismissed(user.id)) return
      const fresh = await refreshSelf()
      if (fresh && !isFirstRun(fresh)) return
      // Shown once: leaving without finishing does not bring it back.
      dismissOnboarding(user.id)
      setOpen(true)
    })()
  }, [user, refreshSelf])

  const close = () => {
    setOpen(false)
    void refreshSelf()
  }

  return (
    <>
      {localeReady && user && (isFirstRun(user) || open) && (
        <section
          aria-label={t('Set up a client')}
          className='bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-xs'
        >
          <div className='flex min-w-0 flex-col gap-0.5'>
            <h2 className='text-sm font-medium'>
              {t('Connect your first client in 3 steps')}
            </h2>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Choose a client, copy its config, and we confirm the first request.'
              )}
            </p>
          </div>
          <Button size='sm' onClick={() => setOpen(true)}>
            <ListChecks data-icon='inline-start' />
            {t('Set up a client')}
          </Button>
        </section>
      )}
      {open && <OnboardingWizard onClose={close} />}
    </>
  )
}
