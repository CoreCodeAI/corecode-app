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
import { createFileRoute, redirect } from '@tanstack/react-router'
import z from 'zod'

import { SiteInsights } from '@/features/site-insights'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const siteInsightsSearchSchema = z.object({
  tab: z
    .enum([
      'overview',
      'capacity',
      'finance',
      'risk',
      'growth',
      'activity',
      'quality',
      // The business tab was split up: its models went to funds, referrals
      // and groups to growth, clients to quality. An old link opens funds.
      'business',
      'pool',
      'channels',
      'upstream',
    ])
    .transform((tab) => (tab === 'business' ? 'finance' : tab))
    .optional()
    .catch(undefined),
  days: z.number().int().positive().optional().catch(undefined),
  // The quality tab's model filter; every model when absent.
  models: z.array(z.string()).max(100).optional().catch(undefined),
  // The pool tab's provider; Claude when absent.
  provider: z
    .enum(['claude', 'codex', 'grok', 'gemini'])
    .optional()
    .catch(undefined),
  // The capacity tab's provider; every provider when absent.
  vendor: z
    .enum(['claude', 'codex', 'grok', 'gemini'])
    .optional()
    .catch(undefined),
})

export const Route = createFileRoute('/_authenticated/site-insights/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  validateSearch: siteInsightsSearchSchema,
  component: SiteInsights,
})
