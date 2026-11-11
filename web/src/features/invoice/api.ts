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
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import type {
  InvoiceConfig,
  InvoiceDetail,
  InvoiceFilters,
  InvoicePage,
  InvoicePaymentStart,
  InvoiceSubmission,
  InvoiceSummary,
  InvoiceTaxMethod,
  InvoiceableOrder,
  Invoice,
} from './types'

type Envelope<T> = { success: boolean; message?: string; data?: T }
type PageParams = { p: number; page_size: number }

async function read<T>(
  request: Promise<{ data: Envelope<T> }>,
  fallback: string
): Promise<T> {
  const res = await request
  if (!res.data.success || res.data.data === undefined) {
    throw createServerError(res.data, fallback)
  }
  return res.data.data
}

async function check(
  request: Promise<{ data: Envelope<unknown> }>,
  fallback: string
): Promise<void> {
  const res = await request
  if (!res.data.success) {
    throw createServerError(res.data, fallback)
  }
}

export function getInvoiceConfig(): Promise<InvoiceConfig> {
  return read(api.get('/api/invoice/config'), 'Failed to load')
}

export function getInvoiceSummary(): Promise<InvoiceSummary> {
  return read(api.get('/api/invoice/summary'), 'Failed to load')
}

export function getInvoiceableOrders(): Promise<InvoiceableOrder[]> {
  return read(api.get('/api/invoice/orders'), 'Failed to load')
}

export function getMyInvoices(
  page: PageParams,
  status?: string
): Promise<InvoicePage> {
  return read(
    api.get('/api/invoice/self', { params: { ...page, status } }),
    'Failed to load'
  )
}

export function getMyInvoice(id: number): Promise<InvoiceDetail> {
  return read(api.get(`/api/invoice/self/${id}`), 'Failed to load')
}

export function submitInvoice(
  submission: InvoiceSubmission
): Promise<InvoicePaymentStart> {
  return read(
    api.post('/api/invoice', submission),
    'Failed to submit the application'
  )
}

export function payInvoiceTax(
  id: number,
  method: InvoiceTaxMethod
): Promise<InvoicePaymentStart> {
  return read(
    api.post(`/api/invoice/self/${id}/pay`, { payment_method: method }),
    'Failed to start payment'
  )
}

export function cancelInvoice(id: number): Promise<void> {
  return check(
    api.post(`/api/invoice/self/${id}/cancel`),
    'Failed to cancel the application'
  )
}

/**
 * Downloads an invoice file and saves it under the name the server gives.
 * A failure answers with JSON instead of the file.
 */
async function downloadFile(path: string, fallbackName: string) {
  const res = await api.get<Blob>(path, {
    responseType: 'blob',
    skipErrorHandler: true,
  })
  const blob = res.data
  if (blob.type.includes('application/json')) {
    const body = JSON.parse(await blob.text()) as Envelope<unknown>
    throw createServerError(body, 'Failed to download the invoice')
  }
  const disposition = String(res.headers['content-disposition'] ?? '')
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  let name = fallbackName
  if (encoded) {
    try {
      name = decodeURIComponent(encoded.trim())
    } catch {
      name = fallbackName
    }
  }
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(href)
}

export function downloadMyInvoice(invoice: Invoice): Promise<void> {
  return downloadFile(
    `/api/invoice/self/${invoice.id}/file`,
    invoice.file_name || `invoice-${invoice.id}`
  )
}

export function getAllInvoices(
  filters: InvoiceFilters,
  page: PageParams
): Promise<InvoicePage> {
  return read(
    api.get('/api/invoice/admin', { params: { ...filters, ...page } }),
    'Failed to load'
  )
}

export function getInvoiceAdmin(id: number): Promise<InvoiceDetail> {
  return read(api.get(`/api/invoice/admin/${id}`), 'Failed to load')
}

export function uploadInvoiceFile(id: number, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  return check(
    api.post(`/api/invoice/admin/${id}/file`, form),
    'Failed to upload the invoice file'
  )
}

export function downloadInvoiceAdmin(invoice: Invoice): Promise<void> {
  return downloadFile(
    `/api/invoice/admin/${invoice.id}/file`,
    invoice.file_name || `invoice-${invoice.id}`
  )
}

export function issueInvoice(id: number): Promise<void> {
  return check(
    api.post(`/api/invoice/admin/${id}/issue`),
    'Failed to issue the invoice'
  )
}

export function rejectInvoice(id: number, reason: string): Promise<void> {
  return check(
    api.post(`/api/invoice/admin/${id}/reject`, { reason }),
    'Failed to reject the application'
  )
}

export function deleteInvoice(id: number, reason: string): Promise<void> {
  return check(
    api.post(`/api/invoice/admin/${id}/delete`, { reason }),
    'Failed to delete the invoice application'
  )
}
