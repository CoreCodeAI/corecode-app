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
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'

import { getSetupTitle } from '../lib/client-setup'
import { useSetupClients } from '../lib/use-setup-clients'
import type { ApiKey } from '../types'
import { ApiKeysDeleteDialog } from './api-keys-delete-dialog'
import { ApiKeysMutateDrawer } from './api-keys-mutate-drawer'
import { useApiKeys } from './api-keys-provider'
import { ClientSetupGuide } from './client-setup-guide'
import { CCSwitchDialog } from './dialogs/cc-switch-dialog'

// The IQ test is opened rarely, so it is not part of the keys page's first load.
const IqTestDialog = lazy(() =>
  import('./dialogs/iq-test-dialog').then((m) => ({ default: m.IqTestDialog }))
)

/**
 * The setup dialog's title, from the clients the key's group admits. The
 * dialog mounts its title only while it is open, so a closed dialog asks for
 * no models.
 */
function SetupDialogTitle(props: { apiKey: ApiKey | null }) {
  const { t } = useTranslation()
  const { clients } = useSetupClients(props.apiKey)
  return t(getSetupTitle(clients))
}

export function ApiKeysDialogs() {
  const { open, setOpen, currentRow, resolvedKey } = useApiKeys()

  return (
    <>
      <ApiKeysMutateDrawer
        open={open === 'create' || open === 'update'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={open === 'update' ? currentRow || undefined : undefined}
      />
      <ApiKeysDeleteDialog />
      <CCSwitchDialog
        open={open === 'cc-switch'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        tokenKey={resolvedKey}
      />
      <Dialog
        open={open === 'setup' && currentRow !== null}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        title={<SetupDialogTitle apiKey={currentRow} />}
        description={currentRow?.name}
        contentClassName='sm:max-w-2xl'
        contentHeight='auto'
      >
        <ClientSetupGuide keys={currentRow ? [currentRow] : []} />
      </Dialog>
      {open === 'iq-test' && currentRow !== null && (
        <Suspense fallback={null}>
          <IqTestDialog
            key={currentRow.id}
            apiKey={currentRow}
            onOpenChange={(isOpen) => !isOpen && setOpen(null)}
          />
        </Suspense>
      )}
    </>
  )
}
