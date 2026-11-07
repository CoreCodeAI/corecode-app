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
import { ShieldAlert } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import {
  getTermsVersion,
  hasStoredTermsConsent,
  storeTermsConsent,
} from '../lib/terms-consent'
import type { SystemStatus } from '../types'
import { TermsUpdateDialog } from './terms-update-dialog'

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
        <Alert>
          <ShieldAlert aria-hidden='true' />
          <AlertTitle>
            {t('You need to agree to the latest terms before signing in.')}
          </AlertTitle>
          <AlertDescription className='grid gap-2'>
            <span>
              {t('Inputs and quick sign-in stay disabled until you agree.')}
            </span>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='justify-self-start'
              onClick={() => setDialogOpen(true)}
            >
              {t('View terms')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <fieldset disabled={!agreed} className='m-0 min-w-0 border-0 p-0'>
        {props.children}
      </fieldset>
      <TermsUpdateDialog
        open={!agreed && dialogOpen}
        version={version}
        dismissible
        onAgree={handleAgree}
        onReject={handleReject}
      />
    </div>
  )
}
