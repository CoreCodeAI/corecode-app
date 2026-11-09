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
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'

import { prefetchSetupStatus } from '@/features/setup/api'
import { bootstrapAuthentication } from '@/lib/auth-session'
import { installBuildMetadata } from '@/lib/build-metadata'
import { setSiteTitle } from '@/lib/document-title'
import { applyFaviconToDom } from '@/lib/dom-utils'
import '@/lib/dayjs'
import { initializeFrontendCache } from '@/lib/frontend-cache'
import { resolveLegacyRoute } from '@/lib/legacy-route'
import { createAppQueryClient } from '@/lib/query-client'
import { hasSessionHint } from '@/lib/session-hint'
import { readCachedStatus, statusQueryOptions } from '@/lib/status-query'

import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
import { DASHBOARD_DEFAULT_SECTION } from './features/dashboard/section-registry'
import { i18nReady, loadLocaleParts } from './i18n/config'
import { localePartsFor } from './i18n/core-routes'
// Generated Routes
import { routeTree } from './routeTree.gen'

// Styles
import './styles/index.css'

// Ensure VChart theme is initialized before any chart mounts (prevents white default theme flash)
// VChart theme is driven by our ThemeProvider (html.light/html.dark) via per-chart `theme` prop.
initializeFrontendCache()
installBuildMetadata()

const queryClient = createAppQueryClient()

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// The root guard waits on the auth refresh and the setup check, and it runs
// only once the router renders after the locale loads. Start both now so they
// overlap the locale download; the guard picks up the same requests.
// preloadCurrentRouteCode below does the same for the route's code.
void bootstrapAuthentication()
if (!window.location.pathname.startsWith('/setup')) {
  prefetchSetupStatus()
}

// Render the app
const rootElement = document.querySelector<HTMLElement>('#root')
if (!rootElement) {
  throw new Error('Root element not found')
}
// Set document.title and favicon from cached status, then refresh from network
;(function initSystemBranding() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const apply = (name: string) => {
      setSiteTitle(name)
      const metaTitle = document.querySelector(
        'meta[name="title"]'
      ) as HTMLMetaElement | null
      if (metaTitle) metaTitle.setAttribute('content', name)
    }
    // Cache-first
    const cached = readCachedStatus()
    if (cached?.system_name) apply(cached.system_name as string)
    if (cached?.logo) applyFaviconToDom(cached.logo as string)

    // Background refresh through the shared cache. This primes ['status']
    // before React mounts, so the root guard and every status consumer reuse
    // this one request instead of firing their own. `fetchStatus` owns the
    // localStorage write and the system-config store sync.
    queryClient
      .ensureQueryData(statusQueryOptions)
      .then((s) => {
        if (s?.system_name) apply(s.system_name as string)
        if (s?.logo) applyFaviconToDom(s.logo as string)
      })
      .catch(() => {
        /* empty */
      })
  } catch {
    /* empty */
  }
})()
// The routes this URL renders, or null when a protected route will redirect
// to sign-in because there is no session hint.
function matchCurrentRoutes() {
  const href = resolveLegacyRoute(window.location.href) ?? window.location.href
  let { pathname } = new URL(href, window.location.origin)
  // The home page and the legacy /console lead here; it redirects to a section.
  if (pathname.replace(/\/$/, '') === '/dashboard') {
    pathname = `/dashboard/${DASHBOARD_DEFAULT_SECTION}`
  }
  const { matchedRoutes } = router.getMatchedRoutes(pathname)
  if (matchedRoutes.some((route) => route.id === '/_authenticated')) {
    if (!hasSessionHint()) return null
  }
  return matchedRoutes
}

const currentRoutes = matchCurrentRoutes()

// The router fetches a route's code only once it mounts, and mounting waits
// for the locale below. Fetch the code of the routes this URL renders now, in
// parallel with the locale. Guards and redirects still run when the router
// loads; this only loads modules, so a redirect elsewhere wastes the bytes.
function preloadCurrentRouteCode() {
  for (const route of currentRoutes ?? []) {
    void router.loadRouteChunk(route)?.catch(() => undefined)
  }
}

// The parts of the locale beyond boot this page renders from (core-routes.ts).
// A protected page without a session redirects to sign-in, a boot page. The
// others load once the browser is idle after the first render.
const renderLocaleParts =
  currentRoutes === null ? [] : localePartsFor(currentRoutes.at(-1)?.id)

if (!rootElement.innerHTML) {
  // index.html preloads the locale, and i18next requests it from a zero-delay
  // timer; queue behind that so the locale, which gates the first render, is
  // first on the connection.
  setTimeout(preloadCurrentRouteCode, 0)
  // Render after the locale loads so the first paint is already translated.
  void i18nReady
    .then(() => loadLocaleParts(renderLocaleParts))
    .then(() => {
      const root = ReactDOM.createRoot(rootElement)
      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider>
              <FontProvider>
                <DirectionProvider>
                  <RouterProvider router={router} />
                </DirectionProvider>
              </FontProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </StrictMode>
      )
      const idle =
        window.requestIdleCallback ?? ((run) => window.setTimeout(run, 1))
      idle(() => void loadLocaleParts(['core', 'rest']))
    })
}
