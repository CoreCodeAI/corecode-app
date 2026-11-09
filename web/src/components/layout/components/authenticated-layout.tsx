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
import { lazy, Suspense } from 'react'

import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { LayoutProvider } from '@/context/layout-provider'
import { useFeedbackReplyToast } from '@/features/feedback/hooks/use-feedback-unread'
import { useIdentifyUser, useReportPurchases } from '@/lib/analytics'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'

// Loaded after the first render: it only shows a dialog when the terms change,
// so it stays out of every console page's first load.
const LazyTermsConsentPrompt = lazy(() =>
  import('@/features/auth/components/terms-consent-prompt').then((m) => ({
    default: m.TermsConsentPrompt,
  }))
)

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

// A child, not hooks in AuthenticatedLayout, so the feedback poll unmounts on
// sign-out with the pages instead of running ahead of the early return.
function SignedInEffects() {
  useIdentifyUser()
  useReportPurchases()
  useFeedbackReplyToast()
  return null
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  const signedIn = useAuthStore((s) => !!s.auth.user)
  // Unmount pages on sign-out, otherwise their queries refetch and toast "Session expired!" / "invalid access token"
  if (!signedIn) return null

  return (
    <LayoutProvider>
      <SignedInEffects />
      <Suspense fallback={null}>
        <LazyTermsConsentPrompt />
      </Suspense>
      <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
        <SkipToMain />
        <AppHeader />
        <div className='flex min-h-0 w-full flex-1'>
          <AppSidebar />
          <SidebarInset
            className={cn(
              '@container/content',
              'h-[calc(100svh-var(--app-header-height,0px))]',
              'min-h-0 overflow-hidden',
              'peer-data-[variant=inset]:h-[calc(100svh-var(--app-header-height,0px)-(var(--spacing)*4))]'
            )}
          >
            {props.children ?? <AnimatedOutlet />}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </LayoutProvider>
  )
}
