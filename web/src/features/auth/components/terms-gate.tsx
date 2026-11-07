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
import { lazy, type ReactNode, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import {
  getTermsVersion,
  hasStoredTermsConsent,
  storeTermsConsent,
} from '../lib/terms-consent'
import type { SystemStatus } from '../types'

// The dialog loads on first use, so the sign-in page's first load does not
// carry it when no terms version is configured.
const LazyTermsUpdateDialog = lazy(() =>
  import('./terms-update-dialog').then((m) => ({
    default: m.TermsUpdateDialog,
  }))
)

type TermsGateProps = {
  status: SystemStatus | null
  children: ReactNode
}

// Holds the sign-in and sign-up forms until the visitor agrees to the current
// terms. The agreement is kept in the browser and recorded on the server by
// the console once the visitor is signed in. With no terms version configured
// the forms render unchanged.
export function TermsGate(props: TermsGateProps) {
  const { t } = useTranslation()
  const version = getTermsVersion(props.status)
  const [agreedVersion, setAgreedVersion] = useState('')
  const [dialogOpen, setDialogOpen] = useState(true)

  if (!version) return props.children

  const agreed = agreedVersion === version || hasStoredTermsConsent(version)

  function handleAgree() {
    storeTermsConsent(version)
    setAgreedVersion(version)
    setDialogOpen(false)
  }

  function handleReject() {
    setDialogOpen(false)
    toast.error(
      t(
        'You cannot sign up or use quick sign-in until you agree to the latest terms.'
      )
    )
  }

  return (
    <div className='grid gap-5'>
      {!agreed && (
        <div
          role='status'
          className='border-border/60 bg-muted/40 grid gap-2 rounded-md border p-3 text-xs leading-5'
        >
          <p className='text-foreground font-medium'>
            {t('You need to agree to the latest terms before signing in.')}
          </p>
          <p className='text-muted-foreground'>
            {t('Inputs and quick sign-in stay disabled until you agree.')}
          </p>
          <Button
            type='button'
            size='sm'
            variant='outline'
            className='justify-self-start'
            onClick={() => setDialogOpen(true)}
          >
            {t('View terms')}
          </Button>
        </div>
      )}
      <fieldset disabled={!agreed} className='m-0 min-w-0 border-0 p-0'>
        {props.children}
      </fieldset>
      {!agreed && (
        <Suspense fallback={null}>
          <LazyTermsUpdateDialog
            open={dialogOpen}
            version={version}
            dismissible
            onAgree={handleAgree}
            onReject={handleReject}
          />
        </Suspense>
      )}
    </div>
  )
}
