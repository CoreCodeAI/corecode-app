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

import { SecuritySettings } from '@/features/system-settings/security'
import {
  SECURITY_DEFAULT_SECTION,
  SECURITY_SECTION_IDS,
} from '@/features/system-settings/security/section-registry.tsx'

export const Route = createFileRoute(
  '/_authenticated/system-settings/security/$section'
)({
  codeSplitGroupings: [['loader', 'component'], ['errorComponent']],
  loader: ({ params }) => {
    // Sensitive words are a request processing instance now.
    if (params.section === 'sensitive-words') {
      throw redirect({ to: '/request-processing', replace: true })
    }
    // Both moved to the risk control page beside site insights.
    if (
      params.section === 'violation-guard' ||
      params.section === 'risk-gate'
    ) {
      throw redirect({
        to: '/risk-control',
        hash: params.section === 'risk-gate' ? 'audit' : 'violations',
        replace: true,
      })
    }
    const validSections = SECURITY_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/system-settings/security/$section',
        params: { section: SECURITY_DEFAULT_SECTION },
      })
    }
  },
  component: SecuritySettings,
})
