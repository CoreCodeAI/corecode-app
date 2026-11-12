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
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { RichContent } from '@/components/rich-content'
import { useTheme } from '@/context/theme-provider'
import { captureAffiliateCodeFromUrl } from '@/features/auth/lib/storage'
import { isLikelyHtml } from '@/lib/content-format'
import { useAuthStore } from '@/stores/auth-store'

import { CTA, Features, Hero, HowItWorks, Stats } from './components'
import { useHomePageContent } from './hooks'

// On corecode.live a static home page sits in front of the console: the
// proxy (corecode-infra's Caddyfile) answers a document load of `/` itself
// and sends only invitation links (`?aff=`, `?ref=`) here. That page carries
// the motion, live status and copy buttons this route's copy of the HTML
// loses to sanitizing, so a visitor who reaches this route by any other way
// (a link, a redirect, an invitation) is handed to it with a full load.
//
// A document that itself loaded at `/` without an invitation shows the host
// serves the console there (a dev server, a plain new-api), so there is no
// static page to hand to and this route renders the home itself. That check
// also keeps the hand-off from looping.
function staticHomeServesRoot(): boolean {
  const entry = performance.getEntriesByType('navigation')[0]
  if (!entry) return false
  const url = new URL(entry.name)
  return url.pathname !== '/' || hasInviteCode(url.search)
}

function hasInviteCode(search: string): boolean {
  const params = new URLSearchParams(search)
  return Boolean(params.get('ref')?.trim() || params.get('aff')?.trim())
}

export function Home() {
  if (staticHomeServesRoot()) return <StaticHomeHandOff />
  return <ConsoleHome />
}

function StaticHomeHandOff() {
  useEffect(() => {
    // The root route saves the code in its own effect, which runs after this
    // one; save it first so the code survives the load.
    captureAffiliateCodeFromUrl(window.location.search)
    window.location.replace('/')
  }, [])
  // The header stays while the page loads; it matches the static page's.
  return (
    <PublicLayout showMainContainer={false}>
      <main className='min-h-screen' />
    </PublicLayout>
  )
}

function ConsoleHome() {
  const { i18n, t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const { resolvedTheme } = useTheme()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const { content, isLoaded, isUrl } = useHomePageContent()
  const navigate = useNavigate()
  // An invitation link lands here with ?ref= or ?aff=. Without custom home
  // content the stock hero is not what that visitor came for: send them to
  // sign-up, where the code (already saved by the root route) is applied.
  const redirectToSignUp =
    isLoaded &&
    !content &&
    !isAuthenticated &&
    hasInviteCode(window.location.search)

  useEffect(() => {
    if (!redirectToSignUp) return
    captureAffiliateCodeFromUrl(window.location.search)
    void navigate({ to: '/sign-up', replace: true })
  }, [navigate, redirectToSignUp])

  const syncIframePreferences = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { themeMode: resolvedTheme },
        '*'
      )
      iframeRef.current?.contentWindow?.postMessage(
        { lang: i18n.language },
        '*'
      )
    } catch {
      // Cross-origin frames may reject access while navigating.
    }
  }, [i18n.language, resolvedTheme])

  useEffect(() => {
    if (isUrl) {
      syncIframePreferences()
    }
  }, [isUrl, syncIframePreferences])

  // Cached content shows at once; only a cold, unknown page waits.
  if (!isLoaded && !content) {
    return (
      <PublicLayout showMainContainer={false}>
        <main className='flex min-h-screen items-center justify-center'>
          <div className='text-muted-foreground'>{t('Loading...')}</div>
        </main>
      </PublicLayout>
    )
  }

  if (redirectToSignUp) return null

  if (content) {
    if (isUrl) {
      return (
        <PublicLayout showMainContainer={false}>
          {/*
            allow-top-navigation-by-user-activation: the custom home page URL is
            admin-configured (trusted); this lets its target="_top" nav/menu links
            navigate the top-level window on user click. The default sandbox blocks
            this on desktop, while some mobile browsers allow it via allow-popups,
            causing inconsistent behavior. This token only permits user-activated
            top-level navigation and does NOT grant same-origin access.
          */}
          <iframe
            ref={iframeRef}
            src={content}
            className='h-screen w-full border-none'
            title={t('Custom Home Page')}
            sandbox='allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
            onLoad={syncIframePreferences}
          />
        </PublicLayout>
      )
    }

    const contentIsHtml = isLikelyHtml(content)

    if (contentIsHtml) {
      return (
        <PublicLayout showMainContainer={false}>
          <RichContent
            mode='html'
            htmlVariant='isolated'
            content={content}
            className='custom-home-content'
          />
        </PublicLayout>
      )
    }

    return (
      <PublicLayout>
        <div className='mx-auto max-w-6xl px-4 py-8'>
          <RichContent
            mode='markdown'
            content={content}
            className='custom-home-content'
          />
        </div>
      </PublicLayout>
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <Hero isAuthenticated={isAuthenticated} />
      <Stats />
      <Features />
      <HowItWorks />
      <CTA isAuthenticated={isAuthenticated} />
      <Footer />
    </PublicLayout>
  )
}
