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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'

/**
 * Asks before a close discards edits. Pass the returned `onOpenChange` to the
 * sheet and render `confirmDialog` beside it; a close that the caller makes
 * itself (after saving) goes straight to the original `onOpenChange`.
 */
export function useUnsavedChangesGuard(options: {
  isDirty: boolean
  onOpenChange: (open: boolean) => void
}): {
  onOpenChange: (open: boolean) => void
  confirmDialog: React.ReactNode
} {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)

  const onOpenChange = (open: boolean) => {
    if (!open && options.isDirty) {
      setConfirming(true)
      return
    }
    options.onOpenChange(open)
  }

  const confirmDialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      title={t('Unsaved changes')}
      desc={t('You have unsaved changes. Are you sure you want to leave?')}
      confirmText={t('Leave')}
      destructive
      handleConfirm={() => {
        setConfirming(false)
        options.onOpenChange(false)
      }}
    />
  )

  return { onOpenChange, confirmDialog }
}
