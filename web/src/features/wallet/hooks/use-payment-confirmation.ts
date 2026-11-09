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
/**
 * CoreCode fork: a payment is paid in another tab, so the wallet cannot tell
 * when it lands. After a payment is handed off, this watches the balance and
 * says once when credit arrives, or says calmly that it is still pending.
 */
import i18next from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useRefreshSelf } from '@/hooks/use-self'
import { formatQuota } from '@/lib/format'

export const PAYMENT_POLL_INTERVAL_MS = 4000
export const PAYMENT_WAIT_TIMEOUT_MS = 3 * 60 * 1000

export type PaymentWaitStatus = 'idle' | 'waiting' | 'timeout'

export function usePaymentConfirmation() {
  const refreshSelf = useRefreshSelf()
  const [status, setStatus] = useState<PaymentWaitStatus>('idle')
  // The window being watched; a stale poll from an ended one must do nothing.
  const sessionRef = useRef(0)
  const stopRef = useRef<() => void>(() => {})

  const end = useCallback((next: PaymentWaitStatus) => {
    sessionRef.current += 1
    stopRef.current()
    stopRef.current = () => {}
    setStatus(next)
  }, [])

  const start = useCallback(
    (baselineQuota: number) => {
      stopRef.current()
      const session = ++sessionRef.current
      setStatus('waiting')

      let polling = false
      const poll = async () => {
        if (polling) return
        polling = true
        const user = await refreshSelf()
        polling = false
        if (session !== sessionRef.current || !user) return
        const added = Number(user.quota ?? 0) - baselineQuota
        if (added <= 0) return
        end('idle')
        toast.success(
          i18next.t('Payment received! Added: {{quota}}', {
            quota: formatQuota(added),
          })
        )
      }

      const interval = window.setInterval(poll, PAYMENT_POLL_INTERVAL_MS)
      const timeout = window.setTimeout(() => {
        if (session === sessionRef.current) end('timeout')
      }, PAYMENT_WAIT_TIMEOUT_MS)
      // Coming back from the payment tab is when credit most likely landed.
      const onVisible = () => {
        if (document.visibilityState === 'visible') void poll()
      }
      document.addEventListener('visibilitychange', onVisible)
      stopRef.current = () => {
        window.clearInterval(interval)
        window.clearTimeout(timeout)
        document.removeEventListener('visibilitychange', onVisible)
      }
    },
    [refreshSelf, end]
  )

  const dismiss = useCallback(() => end('idle'), [end])

  useEffect(
    () => () => {
      sessionRef.current += 1
      stopRef.current()
    },
    []
  )

  return { status, start, dismiss }
}
