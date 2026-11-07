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
import { ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type TermsUpdateDialogProps = {
  open: boolean
  version: string
  // Signed-in customers cannot close the dialog without answering; on the
  // sign-in page closing it counts as declining.
  dismissible: boolean
  isSubmitting?: boolean
  onAgree: () => void
  onReject: () => void
}

export function TermsUpdateDialog(props: TermsUpdateDialogProps) {
  const { t } = useTranslation()
  // Sections of the terms page. The user agreement route forwards the anchor
  // to the configured terms URL.
  const sections = [
    { anchor: 'service', label: t('Terms of service') },
    { anchor: 'aup', label: t('Acceptable use policy') },
    { anchor: 'refund', label: t('Refunds') },
    { anchor: 'privacy', label: t('Privacy notice') },
  ]

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && props.dismissible) props.onReject()
      }}
      disablePointerDismissal={!props.dismissible}
      showCloseButton={false}
      contentClassName='sm:max-w-xl'
      title={
        <span className='flex flex-wrap items-center gap-2'>
          <ShieldCheck aria-hidden='true' className='text-primary size-5' />
          {t('Terms update notice')}
          <Badge variant='outline'>{props.version}</Badge>
        </span>
      }
      description={t(
        'Our terms were updated on {{version}}. Please read and agree before signing in or creating an account.',
        { version: props.version }
      )}
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            disabled={props.isSubmitting}
            onClick={props.onReject}
          >
            {t('Decline')}
          </Button>
          <Button
            type='button'
            disabled={props.isSubmitting}
            onClick={props.onAgree}
          >
            {props.isSubmitting && <Loader2 className='animate-spin' />}
            {t('Agree and continue')}
          </Button>
        </>
      }
    >
      <p className='mb-3 text-sm font-medium'>{t('Related documents')}</p>
      <div className='grid gap-3 sm:grid-cols-2'>
        {sections.map((section) => (
          <a
            key={section.anchor}
            href={`/user-agreement#${section.anchor}`}
            target='_blank'
            rel='noopener noreferrer'
            className='border-border hover:bg-muted/60 flex items-center gap-3 rounded-lg border p-3 text-sm font-medium transition-colors'
          >
            <FileText
              aria-hidden='true'
              className='text-muted-foreground size-4 shrink-0'
            />
            <span className='min-w-0 flex-1'>{section.label}</span>
            <ExternalLink
              aria-hidden='true'
              className='text-muted-foreground size-3.5 shrink-0'
            />
          </a>
        ))}
      </div>
    </Dialog>
  )
}
