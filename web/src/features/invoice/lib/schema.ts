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
import { z } from 'zod'

// A unified social credit code (18 characters) or an older taxpayer number
// (15 or 20). controller/invoice.go checks it again.
const TAX_NO_PATTERN = /^[0-9A-Za-z]{15,20}$/

export const invoiceFormSchema = z
  .object({
    title_type: z.enum(['company', 'personal']),
    title: z
      .string()
      .trim()
      .min(1, 'Enter the invoice title')
      .max(100, 'This field is too long'),
    tax_no: z.string().trim().max(20, 'This field is too long'),
    category: z.string().min(1, 'Select a product category'),
    email: z
      .string()
      .trim()
      .max(100, 'This field is too long')
      .pipe(z.email('Invalid email address')),
    payment_method: z.enum(['balance', 'alipay', 'wxpay']),
  })
  .superRefine((values, context) => {
    if (
      values.title_type === 'company' &&
      !TAX_NO_PATTERN.test(values.tax_no)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tax_no'],
        message: 'Enter a valid taxpayer identification number',
      })
    }
  })

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>
