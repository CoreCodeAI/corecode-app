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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { acceptTermsConsent, logout } from '@/features/auth/api'
import {
  getTermsVersion,
  hasStoredTermsConsent,
  storeTermsConsent,
} from '@/features/auth/lib/terms-consent'
import type { SystemStatus } from '@/features/auth/types'
import { clearAuthenticatedClientState } from '@/lib/auth-session'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'
import { statusQueryOptions } from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { TermsUpdateDialog } from './terms-update-dialog'

// Asks a signed-in customer to accept the current terms when the server has no
// record of it, and records the answer. An agreement given on the sign-in page
// is recorded without asking again. Declining signs the customer out.
export function TermsConsentPrompt() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // The live status, not the persisted snapshot, so a stale snapshot never
  // asks for a version the server no longer requires.
  const { data: status } = useQuery(statusQueryOptions)
  const version = getTermsVersion(status as SystemStatus | null | undefined)
  const user = useAuthStore((s) => s.auth.user)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [silentFailedVersion, setSilentFailedVersion] = useState('')
  const silentStartedVersion = useRef('')

  const needsConsent =
    Boolean(version) && Boolean(user) && user?.terms_version !== version
  const canRecordSilently =
    needsConsent &&
    silentFailedVersion !== version &&
    hasStoredTermsConsent(version)

  function markAccepted(accepted: string) {
    storeTermsConsent(accepted)
    const auth = useAuthStore.getState().auth
    if (auth.user) auth.setUser({ ...auth.user, terms_version: accepted })
  }

  useEffect(() => {
    if (!canRecordSilently || silentStartedVersion.current === version) return
    silentStartedVersion.current = version
    acceptTermsConsent(version)
      .then((res) => {
        if (res.success) markAccepted(version)
        else setSilentFailedVersion(version)
      })
      .catch(() => setSilentFailedVersion(version))
  }, [canRecordSilently, version])

  async function handleAgree() {
    setIsSubmitting(true)
    try {
      const res = await acceptTermsConsent(version)
      if (res.success) {
        markAccepted(version)
        return
      }
      handleServerError(
        createServerError(res, t('Failed to record your agreement'))
      )
      // The terms may have changed since the page loaded.
      void queryClient.invalidateQueries({
        queryKey: statusQueryOptions.queryKey,
      })
    } catch (error: unknown) {
      handleServerError(error, t('Failed to record your agreement'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleReject() {
    setIsSubmitting(true)
    try {
      const response = await logout()
      if (!response.success) {
        handleServerError(response, t('Failed to sign out session'))
        return
      }
      clearAuthenticatedClientState(queryClient)
      toast.success(t('Signed out'))
      void navigate({ to: '/sign-in', replace: true })
    } catch (error: unknown) {
      handleServerError(error, t('Failed to sign out session'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <TermsUpdateDialog
      open={needsConsent && !canRecordSilently}
      version={version}
      dismissible={false}
      isSubmitting={isSubmitting}
      onAgree={handleAgree}
      onReject={handleReject}
    />
  )
}
