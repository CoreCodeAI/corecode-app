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
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { CANVAS_KEY_GROUP, CANVAS_KEY_NAME } from '../lib/canvas-link'

type CanvasKeyDialogProps = {
  open: boolean
  busy: boolean
  onCreate: () => void
  onCancel: () => void
}

/** Offers to create the `auto`-group key the canvas needs. */
export function CanvasKeyDialog(props: CanvasKeyDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next && !props.busy) props.onCancel()
      }}
      title={t('The Creation Studio needs an auto-group key')}
      description={t(
        'The Creation Studio draws images and videos as well as text, and only a key in the auto group reaches all of those models. You have no enabled key in that group.'
      )}
      contentClassName='sm:max-w-md'
      footer={
        <>
          <Button
            variant='outline'
            disabled={props.busy}
            onClick={props.onCancel}
          >
            {t('Cancel')}
          </Button>
          <Button disabled={props.busy} onClick={props.onCreate}>
            {props.busy && <Loader2 className='animate-spin' />}
            {t('Create Creation Studio key')}
          </Button>
        </>
      }
    >
      <p className='text-muted-foreground text-sm'>
        {t(
          'This creates a key named "{{name}}" in the "{{group}}" group with unlimited quota that never expires. You can edit or delete it on the API Keys page.',
          { name: CANVAS_KEY_NAME, group: CANVAS_KEY_GROUP }
        )}
      </p>
    </Dialog>
  )
}
