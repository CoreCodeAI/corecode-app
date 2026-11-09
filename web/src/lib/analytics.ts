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
import { useEffect } from 'react'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

// Conversion events for Google Analytics 4. new-api injects gtag.js into
// index.html only when GOOGLE_ANALYTICS_ID is set. Without it window.gtag is
// absent, every call here does nothing, and the purchase check sends no request.
//
// A browser reports each conversion once and remembers the keys it sent in
// localStorage. GA also drops a repeated purchase with the same transaction_id,
// which covers a second browser reporting the same order.

declare global {
  interface Window {
    gtag?: {
      (command: 'event', name: string, params: object): void
      (command: 'set', params: object): void
      (command: 'set', target: 'user_properties', params: object): void
    }
  }
}

const REPORTED_STORAGE_KEY = 'corecode:analytics:reported'
// "1" while an administrator is signed in on this browser. The tag new-api
// injects and the docs pages' snippet both read it before their first hit, so
// operators' page views carry traffic_type=internal from the first load, and
// the property's Internal Traffic filter drops them. Kept until a customer
// signs in on the same browser.
export const INTERNAL_TRAFFIC_STORAGE_KEY = 'corecode:analytics:internal'
const REPORTED_LIMIT = 200
// A login this soon after the account was created is its registration.
export const SIGN_UP_WINDOW_SECONDS = 10 * 60
// An order older than this is history, not a conversion to report now.
export const PURCHASE_LOOKBACK_SECONDS = 3 * 24 * 60 * 60
// CoreCode charges through epay only, in CNY; formatPaymentMoney prints ¥.
const PAYMENT_CURRENCY = 'CNY'
const PURCHASE_CHECK_PAGE_SIZE = 10

export type AnalyticsPurchaseRecord = {
  trade_no: string
  money: number
  status: string
  payment_provider?: string
  complete_time?: number
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// Records key as reported and returns whether it was new. Without storage the
// event is still sent; GA's transaction_id dedupe then covers purchases.
function claimReport(key: string): boolean {
  try {
    const stored = window.localStorage.getItem(REPORTED_STORAGE_KEY)
    const reported: string[] = stored ? JSON.parse(stored) : []
    if (reported.includes(key)) return false
    reported.push(key)
    window.localStorage.setItem(
      REPORTED_STORAGE_KEY,
      JSON.stringify(reported.slice(-REPORTED_LIMIT))
    )
  } catch {
    // Private mode or a corrupt value: report rather than drop the event.
  }
  return true
}

// Reports a login, or the registration when the account was created moments
// ago. Logins are not deduplicated: each is a real return to the console.
export function trackLogin(
  user: { id: number; created_at?: number },
  method: string,
  now = nowSeconds()
): void {
  if (!window.gtag) return
  const isNew =
    !!user.created_at && now - user.created_at <= SIGN_UP_WINDOW_SECONDS
  if (!isNew) {
    window.gtag('event', 'login', { method })
    return
  }
  if (!claimReport(`sign_up:${user.id}`)) return
  window.gtag('event', 'sign_up', { method })
}

// Ties this browser's hits to the account, so GA counts one user across
// devices, and marks administrators' hits as internal. Only the numeric id
// and the group name leave the browser; never an email or a username.
export function identifyUser(user: {
  id: number
  role: number
  group?: string
}): void {
  const internal = user.role >= ROLE.ADMIN
  try {
    if (internal) {
      window.localStorage.setItem(INTERNAL_TRAFFIC_STORAGE_KEY, '1')
    } else {
      window.localStorage.removeItem(INTERNAL_TRAFFIC_STORAGE_KEY)
    }
  } catch {
    // Without storage the flag lasts only for this page.
  }
  if (!window.gtag) return
  window.gtag('set', {
    user_id: String(user.id),
    traffic_type: internal ? 'internal' : undefined,
  })
  window.gtag('set', 'user_properties', { user_group: user.group || 'default' })
}

export function useIdentifyUser(): void {
  const user = useAuthStore((state) => state.auth.user)
  const id = user?.id
  const role = user?.role
  const group = user?.group
  useEffect(() => {
    if (id === undefined || role === undefined) return
    identifyUser({ id, role, group })
  }, [id, role, group])
}

export function trackCreateApiKey(count: number): void {
  if (!window.gtag || count <= 0) return
  window.gtag('event', 'create_api_key', { count })
}

// A customer confirmed a top-up and is being sent to the payment page. value
// is the amount the payment page will charge, in CNY like purchase.
export function trackBeginCheckout(value: number, paymentType: string): void {
  if (!window.gtag || !(value > 0)) return
  window.gtag('event', 'begin_checkout', {
    value,
    currency: PAYMENT_CURRENCY,
    payment_type: paymentType,
  })
}

// Balance-paid orders spend money already counted at its top-up.
export function trackPurchases(
  records: AnalyticsPurchaseRecord[],
  now = nowSeconds()
): void {
  if (!window.gtag) return
  for (const record of records) {
    if (record.status !== 'success' || record.payment_provider === 'balance') {
      continue
    }
    if (!(record.money > 0) || !record.complete_time) continue
    if (now - record.complete_time > PURCHASE_LOOKBACK_SECONDS) continue
    if (!claimReport(`purchase:${record.trade_no}`)) continue
    window.gtag('event', 'purchase', {
      transaction_id: record.trade_no,
      value: record.money,
      currency: PAYMENT_CURRENCY,
    })
  }
}

// Payment completes in epay's asynchronous notify, after the customer may have
// left, so the console looks for newly completed orders each time it opens.
// An order completed while the console is open is reported at the next open.
export function useReportPurchases(): void {
  const userId = useAuthStore((state) => state.auth.user?.id)
  useEffect(() => {
    if (!userId || !window.gtag) return
    api
      .get('/api/user/topup/self', {
        params: { p: 1, page_size: PURCHASE_CHECK_PAGE_SIZE },
        skipErrorHandler: true,
      })
      .then((res) => {
        if (res.data?.success) trackPurchases(res.data.data?.items ?? [])
      })
      .catch(() => {
        // Analytics must never surface an error to the customer.
      })
  }, [userId])
}
