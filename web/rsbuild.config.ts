import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv, type RsbuildPlugin } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { tanstackRouter } from '@tanstack/router-plugin/rspack'

import { BOOT_ROUTE_IDS, CORE_ROUTE_IDS } from './src/i18n/core-routes'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The console renders only once the visitor's locale has loaded, and the bundle
// asks for it only after it has downloaded and run. This inline script picks the
// language as i18next will (the `i18next` cookie, then the `i18nextLng`
// localStorage cache, then the browser languages,
// mapped as convertDetectedLanguage maps them) and preloads that locale's parts
// the page renders from beside the entry bundle: the boot part, then the core
// and rest parts as window.__localeTier, which pluginPreloadRoute's script sets
// first, asks (src/i18n/core-routes.ts).
function pluginPreloadLocale(): RsbuildPlugin {
  return {
    name: 'preload-locale',
    setup(api) {
      api.modifyHTMLTags((tags, { compilation, assetPrefix }) => {
        // Language -> chunk URL, for the boot, core and rest parts.
        const urls: Record<string, string>[] = [{}, {}, {}]
        for (const chunk of compilation.chunks) {
          const file = [...chunk.files].find((name) => name.endsWith('.js'))
          const part = chunk.name?.match(/^(locale|i18n-core|i18n-rest)-(.+)$/)
          if (!file || !part) continue
          const tier = ['locale', 'i18n-core', 'i18n-rest'].indexOf(part[1])
          urls[tier][part[2]] = assetPrefix + file
        }
        if (!urls[0].en) return tags
        const script = `(function(){var u=${JSON.stringify(urls)};function p(c){if(!c)return;var x=String(c).toLowerCase().replace(/_/g,'-');if(x.indexOf('zh')===0)return /^(zhtw|zh-tw|zh-hk|zh-mo|zh-hant)/.test(x)?'zhTW':'zhCN';if(u[0][c])return c;x=x.split('-')[0];if(u[0][x])return x}var c=p((document.cookie.match(/(?:^|;\\s*)i18next=([^;]*)/)||[])[1]);try{if(!c)c=p(localStorage.getItem('i18nextLng'))}catch(e){}var n=navigator.languages||[navigator.language];for(var i=0;!c&&i<n.length;i++)c=p(n[i]);c=c||'en';var t=window.__localeTier;if(t===undefined)t=1;for(i=0;i<=t;i++){if(!u[i][c])continue;var l=document.createElement('link');l.rel='preload';l.as='script';l.href=u[i][c];document.head.appendChild(l)}})()`
        tags.headTags.unshift({ tag: 'script', children: script })
        return tags
      })
    },
  }
}

// A route's code is requested only once the entry has downloaded and run and
// the router has matched the URL: a round trip after the entry on every cold
// visit. This inline script matches the URL against the route files' paths and
// preloads that route's chunks, with its layouts', beside the entry. A protected
// route without the session hint cookie preloads the sign-in page it redirects
// to. A miss costs nothing: main.tsx still loads the route's code. It also sets
// window.__localeTier for pluginPreloadLocale's script: 0 for a page that
// renders from the boot part of the locale, 1 for one that also needs the core
// part, 2 for one that needs all three. scripts/check-first-load.mjs reads this
// table from the built index.html.
function pluginPreloadRoute(): RsbuildPlugin {
  return {
    name: 'preload-route',
    setup(api) {
      api.modifyHTMLTags((tags, { compilation, assetPrefix }) => {
        const routesDir = path.join(__dirname, 'src', 'routes') + path.sep
        // Route file, relative and without extension -> its lazy chunks.
        const chunks = new Map<string, Set<string>>()
        for (const group of compilation.chunkGroups) {
          for (const origin of group.origins) {
            const resource = origin.module?.nameForCondition()
            if (!resource?.startsWith(routesDir)) continue
            if (!origin.request?.includes('tsr-split')) continue
            const file = resource.slice(routesDir.length).replace(/\.tsx?$/, '')
            const files = chunks.get(file) ?? new Set<string>()
            for (const name of group.getFiles()) {
              if (name.endsWith('.js')) files.add(name)
            }
            chunks.set(file, files)
          }
        }
        if (!chunks.has('(auth)/sign-in')) return tags

        // A leaf's chunks plus those of every layout (`route.tsx`) above it.
        const withLayouts = (leaf: string) => {
          const files = new Set(chunks.get(leaf))
          const dirs = leaf.split('/').slice(0, -1)
          for (let i = 1; i <= dirs.length; i++) {
            for (const name of chunks.get(
              [...dirs.slice(0, i), 'route'].join('/')
            ) ?? []) {
              files.add(name)
            }
          }
          return files
        }
        // File-route conventions: (group) and _layout segments add nothing to
        // the path, index is the directory itself, $param is one segment.
        const pattern = (segments: string[]) => {
          const parts = segments
            .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('_'))
            .map((s) =>
              s.startsWith('$')
                ? '[^/]+'
                : s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
            )
          return `/${parts.join('/')}`
        }
        const routes: {
          pattern: string
          params: number
          protected: boolean
          tier: number
          files: Set<string>
        }[] = []
        // A route file's id, as TanStack names it: an index file is its directory.
        const routeId = (leaf: string) =>
          `/${leaf.endsWith('/index') ? leaf.slice(0, -'index'.length) : leaf}`
        const localeTier = (id: string) => {
          if (BOOT_ROUTE_IDS.includes(id)) return 0
          return CORE_ROUTE_IDS.includes(id) ? 1 : 2
        }
        for (const leaf of chunks.keys()) {
          const segments = leaf.split('/')
          const last = segments.at(-1)
          if (last === 'route') continue
          const add = (pathSegments: string[]) =>
            routes.push({
              pattern: pattern(pathSegments),
              params: pathSegments.filter((s) => s.startsWith('$')).length,
              protected: segments[0] === '_authenticated',
              tier: localeTier(routeId(leaf)),
              files: withLayouts(leaf),
            })
          add(last === 'index' ? segments.slice(0, -1) : segments)
          // An index route with no component of its own only redirects to one of
          // its sections, as /dashboard does; give it the section's chunks.
          const dir = segments.slice(0, -1).join('/')
          if (last?.startsWith('$') && !chunks.has(`${dir}/index`)) {
            add(segments.slice(0, -1))
          }
        }
        // Static paths before parameterised ones, as the router ranks them.
        routes.sort(
          (a, b) => a.params - b.params || b.pattern.length - a.pattern.length
        )

        const prefix = 'static/js/async/'
        const names: string[] = []
        const index = (name: string) => {
          const short = name.startsWith(prefix)
            ? name.slice(prefix.length, -3)
            : name
          let i = names.indexOf(short)
          if (i < 0) i = names.push(short) - 1
          return i
        }
        const table = routes.map((r) => [
          r.pattern,
          r.protected ? 1 : 0,
          [...r.files].map(index),
          r.tier,
        ])
        const signIn = [...withLayouts('(auth)/sign-in')].map(index)
        const script = `(function(){var f=${JSON.stringify(names)},r=${JSON.stringify(table)},s=${JSON.stringify(signIn)};var p=location.pathname.replace(/[/]+$/,'')||'/';var h=/(^|; *)new_api_has_session=/.test(document.cookie);window.__localeTier=1;for(var i=0;i<r.length;i++){if(!new RegExp('^'+r[i][0]+'$').test(p))continue;var a=r[i][1]&&!h,l=a?s:r[i][2];window.__localeTier=a?0:r[i][3];for(var j=0;j<l.length;j++){var n=f[l[j]],e=document.createElement('link');e.rel='preload';e.as='script';e.href=${JSON.stringify(assetPrefix)}+(n.indexOf('/')<0?${JSON.stringify(prefix)}+n+'.js':n);document.head.appendChild(e)}break}})()`
        tags.headTags.unshift({ tag: 'script', children: script })
        return tags
      })
    },
  }
}

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  const serverUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    'http://localhost:3000'

  const isProd = envMode === 'production'
  const devProxy = Object.fromEntries(
    (['/api', '/v1', '/mj', '/pg'] as const).map((key) => [
      key,
      { target: serverUrl, changeOrigin: true },
    ])
  ) as Record<string, { target: string; changeOrigin: boolean }>

  return {
    plugins: [
      pluginReact(),
      pluginTailwindcss({ optimize: false }),
      pluginPreloadLocale(),
      pluginPreloadRoute(),
    ],
    // Rsbuild 2: replaces deprecated `performance.chunkSplit` (RSPack 2 aligned).
    // No forced vendor groups: a group with `chunks: 'all'` and `enforce` pulls
    // every module it matches, from any page, into one chunk that the entry
    // needs, so a first visit downloaded all of Base UI and TanStack Table.
    splitChunks: {
      preset: 'default',
    },
    source: {
      entry: {
        index: './src/main.tsx',
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    html: {
      template: './index.html',
      favicon: './public/favicon.ico',
    },
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy: devProxy,
    },
    output: {
      // Production optimizations
      minify: isProd,
      target: 'web',
      distPath: {
        root: 'dist',
      },
      // Rely on Rsbuild default legalComments ("linked" → per-chunk *.LICENSE.txt) in all modes.
      // Do not set "none" in production: that strips minifier-preserved third-party notices and
      // extracted license files, which some distributions require for open-source compliance.
    },
    performance: {
      // Remove console in production
      removeConsole: isProd ? ['log'] : false,
      buildCache: false,
    },
    tools: {
      rspack: {
        module: {
          rules: [
            {
              test: /\.json$/,
              resourceQuery: /overrides/,
              use: [
                path.resolve(__dirname, 'scripts/i18n-en-overrides-loader.cjs'),
              ],
            },
            {
              test: /\.json$/,
              resourceQuery: /^\?(boot|core|rest)$/,
              use: [
                path.resolve(__dirname, 'scripts/i18n-locale-split-loader.mjs'),
              ],
            },
          ],
        },
        plugins: [
          tanstackRouter({
            target: 'react',
            // Dev: avoid per-route async chunks (reduces white flash on navigation + faster HMR feedback).
            // Prod: keep route-based code splitting.
            autoCodeSplitting: isProd,
          }),
        ],
      },
    },
  }
})
