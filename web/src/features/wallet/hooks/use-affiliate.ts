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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useRefreshSelf } from '@/hooks/use-self'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerMessage } from '@/lib/server-error-message'

import {
  createAffiliateWithdrawal,
  getAffiliateSelf,
  transferAffiliateCommission,
  transferAffiliateQuota,
} from '../api'
import { generateAffiliateLink } from '../lib'

// ============================================================================
// Invitation commission hook
// ============================================================================

export const AFFILIATE_SELF_KEY = ['affiliate', 'self'] as const

export function useAffiliate() {
  const queryClient = useQueryClient()
  const refreshSelf = useRefreshSelf()
  const [legacyTransferring, setLegacyTransferring] = useState(false)

  const query = useQuery({
    queryKey: AFFILIATE_SELF_KEY,
    queryFn: getAffiliateSelf,
    meta: { errorToast: false },
  })
  const summary = query.data ?? null

  const affiliateLink = useMemo(
    () => (summary?.aff_code ? generateAffiliateLink(summary.aff_code) : ''),
    [summary?.aff_code]
  )

  const refresh = useCallback(async () => {
    // A transfer moves commission into the balance, so the user is stale too.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['affiliate'] }),
      refreshSelf(),
    ])
  }, [queryClient, refreshSelf])

  const transfer = useMutation({
    mutationFn: transferAffiliateCommission,
    onSuccess: async () => {
      toast.success(i18next.t('Transfer successful'))
      await refresh()
    },
    onError: (error) => handleServerError(error),
  })

  const withdraw = useMutation({
    mutationFn: createAffiliateWithdrawal,
    onSuccess: async () => {
      toast.success(i18next.t('Withdrawal requested'))
      await refresh()
    },
    onError: (error) => handleServerError(error),
  })

  // Rewards earned under the earlier referral program.
  const transferLegacy = useCallback(
    async (quota: number): Promise<boolean> => {
      try {
        setLegacyTransferring(true)
        const response = await transferAffiliateQuota({ quota })
        if (response.success) {
          toast.success(
            getServerMessage(response) || i18next.t('Transfer successful')
          )
          await refreshSelf()
          return true
        }
        handleServerError(response, i18next.t('Transfer failed'))
        return false
      } catch (error) {
        handleServerError(error, i18next.t('Transfer failed'))
        return false
      } finally {
        setLegacyTransferring(false)
      }
    },
    [refreshSelf]
  )

  return {
    summary,
    affiliateLink,
    loading: query.isPending,
    transferring: transfer.isPending,
    withdrawing: withdraw.isPending,
    legacyTransferring,
    transferCommission: (quota: number) =>
      transfer.mutateAsync(quota).then(
        () => true,
        () => false
      ),
    withdraw: (quota: number, account: string) =>
      withdraw.mutateAsync({ quota, account }).then(
        () => true,
        () => false
      ),
    transferLegacy,
    refetch: query.refetch,
  }
}
