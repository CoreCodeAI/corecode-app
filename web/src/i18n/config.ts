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
import i18n, { type BackendModule } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import type { LocalePart } from './core-routes'
import { convertDetectedLanguage, toIntlLocale } from './languages'

type LocaleModule = { default: { translation: Record<string, string> } }
type LocaleLoader = {
  boot: () => Promise<LocaleModule>
} & Partial<Record<LocalePart, () => Promise<LocaleModule>>>

// Each locale is 0.5–0.8 MB and a visitor reads one, so each loads as its own
// chunk on demand instead of all seven riding in the entry bundle. Every locale
// carries every key (locales.test.ts), so a supported language loads alone and
// `en` is the fallback only for a language the console does not offer. English
// loads only the entries that differ from their keys
// (scripts/i18n-en-overrides-loader.cjs); the rest render as the key itself.
//
// The other languages load in three parts (scripts/i18n-locale-split-loader.mjs):
// `boot` has every key the sign-in and error pages can show, `core` adds the
// overview and keys pages', and `rest` has the keys only other pages name. The
// first render waits only for the parts its page needs (core-routes.ts); the
// others load after that render, or before another page renders
// (loadLocaleParts). The chunk names let index.html preload the parts the
// visitor's page needs beside the entry bundle (pluginPreloadLocale in
// rsbuild.config.ts).
const localeLoaders: Record<string, LocaleLoader> = {
  en: {
    boot: () =>
      import(/* webpackChunkName: "locale-en" */ './locales/en.json?overrides'),
  },
  zhCN: {
    boot: () =>
      import(/* webpackChunkName: "locale-zhCN" */ './locales/zh.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-zhCN" */ './locales/zh.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-zhCN" */ './locales/zh.json?rest'),
  },
  fr: {
    boot: () =>
      import(/* webpackChunkName: "locale-fr" */ './locales/fr.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-fr" */ './locales/fr.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-fr" */ './locales/fr.json?rest'),
  },
  ru: {
    boot: () =>
      import(/* webpackChunkName: "locale-ru" */ './locales/ru.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-ru" */ './locales/ru.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-ru" */ './locales/ru.json?rest'),
  },
  ja: {
    boot: () =>
      import(/* webpackChunkName: "locale-ja" */ './locales/ja.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-ja" */ './locales/ja.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-ja" */ './locales/ja.json?rest'),
  },
  ko: {
    boot: () =>
      import(/* webpackChunkName: "locale-ko" */ './locales/ko.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-ko" */ './locales/ko.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-ko" */ './locales/ko.json?rest'),
  },
  vi: {
    boot: () =>
      import(/* webpackChunkName: "locale-vi" */ './locales/vi.json?boot'),
    core: () =>
      import(/* webpackChunkName: "i18n-core-vi" */ './locales/vi.json?core'),
    rest: () =>
      import(/* webpackChunkName: "i18n-rest-vi" */ './locales/vi.json?rest'),
  },
  zhTW: {
    boot: () =>
      import(/* webpackChunkName: "locale-zhTW" */ './locales/zh-TW.json?boot'),
    core: () =>
      import(
        /* webpackChunkName: "i18n-core-zhTW" */ './locales/zh-TW.json?core'
      ),
    rest: () =>
      import(
        /* webpackChunkName: "i18n-rest-zhTW" */ './locales/zh-TW.json?rest'
      ),
  },
}

// Each language's parts beyond boot that are loaded, or loading.
const partLoads = new Map<string, Promise<void>>()

let firstRead = true

// i18next awaits `read` when it takes two parameters and returns a promise.
// The page load's first language reads its boot part; a language the visitor
// switches to later reads whole, so the page on screen never lacks a key.
const lazyLocales: BackendModule = {
  type: 'backend',
  init: () => undefined,
  async read(language: string, _namespace: string) {
    const loader = localeLoaders[language]
    if (!loader) return {}
    if (firstRead) {
      firstRead = false
      return (await loader.boot()).default.translation
    }
    const parts = (['core', 'rest'] as const).filter((part) => loader[part])
    const modules = await Promise.all(
      [loader.boot, ...parts.map((part) => loader[part])].map((load) =>
        load?.()
      )
    )
    for (const part of parts) {
      partLoads.set(`${language}:${part}`, Promise.resolve())
    }
    return Object.assign({}, ...modules.map((m) => m?.default.translation))
  },
}

/**
 * Load parts of a language's locale beyond its boot part. Resolves once they
 * are in, or once loading failed; the next call retries, and until then those
 * keys render as their English source text.
 */
export function loadLocaleParts(
  parts: readonly LocalePart[],
  language: string = i18n.resolvedLanguage ?? i18n.language
): Promise<void> {
  return Promise.all(
    parts.map((part) => {
      const load = localeLoaders[language]?.[part]
      if (!load) return undefined
      const id = `${language}:${part}`
      let pending = partLoads.get(id)
      if (!pending) {
        pending = load().then(
          (locale) => {
            i18n.addResourceBundle(
              language,
              'translation',
              locale.default.translation,
              true,
              false
            )
          },
          () => {
            partLoads.delete(id)
          }
        )
        partLoads.set(id, pending)
      }
      return pending
    })
  ).then(() => undefined)
}

// <html lang> follows the interface language, for screen readers, browser
// translation and search engines. index.html's value covers the first paint.
i18n.on('languageChanged', (language) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = toIntlLocale(language) ?? 'en'
})

// Resolves once the current language is loaded, or has failed to load; keys
// then render as their English source text.
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: {
      default: ['en'],
      ...Object.fromEntries(Object.keys(localeLoaders).map((lng) => [lng, []])),
    },
    supportedLngs: Object.keys(localeLoaders),
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      // Browsers report `zh-CN`/`zh-TW`/`zh`; map them onto our `zhCN`/`zhTW`
      // codes (non-Chinese codes pass through for normal supportedLngs matching).
      convertDetectedLanguage,
    },
  })

export default i18n
