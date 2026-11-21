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

import { PublicLayout } from '@/components/layout'

import { staticPricingTarget } from '../lib/static-pricing'

// See lib/static-pricing.ts for why these routes hand the visit over.
export function StaticPricingHandOff(props: { modelId?: string }) {
  const { modelId } = props
  useEffect(() => {
    window.location.replace(
      staticPricingTarget(window.location.search, modelId)
    )
  }, [modelId])
  // The header stays while the page loads; it matches the static page's.
  return (
    <PublicLayout showMainContainer={false}>
      <main className='min-h-screen' />
    </PublicLayout>
  )
}
