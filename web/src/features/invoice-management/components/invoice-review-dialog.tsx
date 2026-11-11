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
import { Download, Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteInvoice,
  downloadInvoiceAdmin,
  getInvoiceAdmin,
  issueInvoice,
  rejectInvoice,
  uploadInvoiceFile,
} from '@/features/invoice/api'
import { InvoiceFacts } from '@/features/invoice/components/invoice-facts'
import { INVOICE_KEY } from '@/features/invoice/constants'
import { handleServerError } from '@/lib/handle-server-error'

const REASON_LIMIT = 200
const FILE_ACCEPT =
  '.pdf,.ofd,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'

type ReasonAction = 'reject' | 'delete'

/**
 * One application for an administrator: upload or replace the invoice file,
 * confirm it issued, reject it, or delete it once it is finished.
 */
export function InvoiceReviewDialog(props: {
  id: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null)
  const [reason, setReason] = useState('')
  const [confirmIssue, setConfirmIssue] = useState(false)
  const detail = useQuery({
    queryKey: [...INVOICE_KEY, 'admin', 'detail', props.id],
    queryFn: () => getInvoiceAdmin(props.id),
  })
  const invoice = detail.data?.invoice
  const status = invoice?.status
  const canUpload = status === 'pending_review' || status === 'issued'
  const canReject = status === 'pending_review' || status === 'pending_payment'
  const canDelete =
    status === 'issued' || status === 'rejected' || status === 'cancelled'

  async function run(
    action: () => Promise<void>,
    success: string,
    fallback: string
  ) {
    setBusy(true)
    try {
      await action()
      toast.success(t(success))
      await queryClient.invalidateQueries({ queryKey: INVOICE_KEY })
      return true
    } catch (error) {
      handleServerError(error, t(fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return
    await run(
      () => uploadInvoiceFile(props.id, file),
      'Invoice file uploaded',
      'Failed to upload the invoice file'
    )
    if (fileInput.current) fileInput.current.value = ''
  }

  async function submitReason() {
    const trimmed = reason.trim()
    if (!reasonAction || trimmed === '') return
    const done =
      reasonAction === 'reject'
        ? await run(
            () => rejectInvoice(props.id, trimmed),
            'Application rejected',
            'Failed to reject the application'
          )
        : await run(
            () => deleteInvoice(props.id, trimmed),
            'Invoice application deleted',
            'Failed to delete the invoice application'
          )
    if (!done) return
    setReasonAction(null)
    setReason('')
    if (reasonAction === 'delete') props.onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t('Application #{{id}}', { id: props.id })}
      contentClassName='sm:max-w-xl'
    >
      {detail.isPending && <Skeleton className='h-60' />}
      {detail.data && invoice && (
        <div className='flex flex-col gap-5'>
          <p className='text-muted-foreground text-sm'>
            {t('User')}: #{detail.data.user?.id ?? invoice.user_id}
            {detail.data.user?.username ? ` ${detail.data.user.username}` : ''}
            {detail.data.user?.email ? ` · ${detail.data.user.email}` : ''}
          </p>
          <InvoiceFacts invoice={invoice} items={detail.data.items} />

          <section className='flex flex-col gap-2'>
            <span className='text-sm font-medium'>{t('Invoice file')}</span>
            {invoice.file_size > 0 ? (
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span className='min-w-0 flex-1 truncate'>
                  {invoice.file_name}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await downloadInvoiceAdmin(invoice)
                    } catch (error) {
                      handleServerError(
                        error,
                        t('Failed to download the invoice')
                      )
                    }
                  }}
                >
                  <Download aria-hidden='true' />
                  {t('Download')}
                </Button>
              </div>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('No file uploaded yet.')}
              </p>
            )}
            {canUpload && (
              <div className='flex flex-col gap-1'>
                <input
                  ref={fileInput}
                  type='file'
                  accept={FILE_ACCEPT}
                  className='sr-only'
                  aria-label={t('Upload file')}
                  onChange={(event) => void upload(event.target.files?.[0])}
                />
                <Button
                  variant='outline'
                  size='sm'
                  className='self-start'
                  disabled={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload aria-hidden='true' />
                  {invoice.file_size > 0 ? t('Replace file') : t('Upload file')}
                </Button>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'PDF, OFD, PNG or JPG. Files can be uploaded or replaced while the application is under review or issued.'
                  )}
                </p>
              </div>
            )}
          </section>

          {reasonAction && (
            <section className='flex flex-col gap-2'>
              <Label htmlFor='invoice-reason'>
                {reasonAction === 'reject'
                  ? t('Rejection reason')
                  : t('Deletion reason')}
              </Label>
              <Textarea
                id='invoice-reason'
                rows={3}
                maxLength={REASON_LIMIT}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                {reasonAction === 'reject'
                  ? t(
                      'The user sees this reason in the invoice center and the email. Paid tax is returned to the balance and the orders become invoiceable again.'
                    )
                  : t(
                      'The application leaves both lists and its file is removed. Its orders become invoiceable again. The reason is kept on the record.'
                    )}
              </p>
              <div className='flex justify-end gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  disabled={busy}
                  onClick={() => {
                    setReasonAction(null)
                    setReason('')
                  }}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  disabled={busy || reason.trim() === ''}
                  onClick={() => void submitReason()}
                >
                  {busy && (
                    <Loader2 className='animate-spin' aria-hidden='true' />
                  )}
                  {reasonAction === 'reject'
                    ? t('Reject application')
                    : t('Delete permanently')}
                </Button>
              </div>
            </section>
          )}

          {!reasonAction && (
            <div className='flex flex-wrap justify-end gap-2'>
              {canDelete && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => setReasonAction('delete')}
                >
                  {t('Delete')}
                </Button>
              )}
              {canReject && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => setReasonAction('reject')}
                >
                  {t('Reject')}
                </Button>
              )}
              {status === 'pending_review' && (
                <Button
                  size='sm'
                  disabled={busy || invoice.file_size <= 0}
                  onClick={() => setConfirmIssue(true)}
                >
                  {t('Confirm issued')}
                </Button>
              )}
            </div>
          )}
          <ConfirmDialog
            open={confirmIssue}
            onOpenChange={setConfirmIssue}
            title={t('Confirm issued')}
            desc={t(
              'The user is notified by email and can download the uploaded file. This cannot be undone.'
            )}
            confirmText={t('Confirm issued')}
            isLoading={busy}
            handleConfirm={async () => {
              const done = await run(
                () => issueInvoice(props.id),
                'Invoice issued',
                'Failed to issue the invoice'
              )
              if (done) setConfirmIssue(false)
            }}
          />
        </div>
      )}
    </Dialog>
  )
}
