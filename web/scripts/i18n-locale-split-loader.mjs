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
// Rspack loader for `locales/<lng>.json?boot`, `?core` and `?rest`. The console
// renders only once its locale has loaded, and the whole locale (8,000 keys,
// 146 KB brotli for zhCN) was the largest file a first visit waited for. The
// pages most visits land on (src/i18n/core-routes.ts) can render far fewer keys.
//
// `?boot` keeps every key that a module reachable from the boot routes (the
// sign-in and error pages, with main.tsx) names as a string literal. `?core`
// keeps the keys that modules reachable from the core routes (the overview and
// keys pages) name, and every key that no console source names: the server
// sends English messages for the console to translate, and a key built at run
// time matches no literal. `?rest` keeps the others, which only other pages
// name. A boot page renders from `?boot`, a core page from `?boot` and `?core`,
// and any other page waits for all three (src/i18n/config.ts). Reachability
// follows static and dynamic imports, so a dialog a page opens later is covered
// too. Outside production builds `?boot` is the whole locale.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const ROUTES = path.join(SRC, 'routes')
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const IMPORT =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g
// A template literal with a substitution matches as a whole, so its closing
// backtick cannot open a match that swallows the code up to the next template,
// and with it every key in between; the literals inside it are read apart.
const LITERAL =
  /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`$\\]|\\.|\$(?!\{))*)`|`(?:[^`\\]|\\.)*`/g

function isSource(file) {
  return (
    EXTENSIONS.includes(path.extname(file)) && !/\.test\.|__tests__/.test(file)
  )
}

function sourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (isSource(full)) files.push(full)
  }
  return files
}

function resolveImport(from, specifier) {
  let base
  if (specifier.startsWith('@/')) {
    base = path.join(SRC, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(from), specifier)
  } else {
    return null
  }
  base = base.replace(/\?.*$/, '')
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => path.join(base, `index${e}`)),
  ]
  return (
    candidates.find((file) => isSource(file) && fs.existsSync(file)) ?? null
  )
}

// Route id -> route file, as TanStack's file routes name them: `__root__` is
// __root.tsx, an id ending in `/` is the directory's index.tsx.
function routeFile(id) {
  if (id === '__root__') return path.join(ROUTES, '__root.tsx')
  const relative = id.endsWith('/') ? `${id}index` : id
  return path.join(ROUTES, `${relative}.tsx`)
}

// A route id list from core-routes.ts, which the loader reads as text.
function routeIds(name) {
  const text = fs.readFileSync(path.join(SRC, 'i18n', 'core-routes.ts'), 'utf8')
  const list = text.match(new RegExp(`${name} = \\[([\\s\\S]*?)\\]`))
  if (!list) {
    throw new Error(`i18n-locale-split-loader: ${name} not found`)
  }
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function unescapeLiteral(text) {
  return text.replaceAll(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c)
}

function addLiterals(text, names) {
  for (const m of text.matchAll(LITERAL)) {
    const literal = m[1] ?? m[2] ?? m[3]
    if (literal !== undefined) names.add(unescapeLiteral(literal))
    else addLiterals(m[0].slice(1, -1), names)
  }
}

function literalsIn(files) {
  const names = new Set()
  for (const file of files) addLiterals(fs.readFileSync(file, 'utf8'), names)
  return names
}

// The modules some routes can run: main.tsx, each route file and the layout
// (`route.tsx`) of every directory above it, and everything they import.
// routeTree.gen.ts imports every route, so the walk does not enter it.
function routeModules(ids) {
  const seen = new Set()
  const queue = [path.join(SRC, 'main.tsx')]
  for (const id of ids) {
    const file = routeFile(id)
    if (!fs.existsSync(file)) {
      throw new Error(`i18n-locale-split-loader: no route file for ${id}`)
    }
    queue.push(file)
    for (
      let dir = path.dirname(file);
      dir.startsWith(ROUTES) && dir !== ROUTES;
      dir = path.dirname(dir)
    ) {
      queue.push(path.join(dir, 'route.tsx'))
    }
  }
  while (queue.length > 0) {
    const file = queue.pop()
    if (seen.has(file) || !fs.existsSync(file)) continue
    seen.add(file)
    if (path.basename(file) === 'routeTree.gen.ts') continue
    for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolveImport(file, m[1] ?? m[2] ?? m[3])
      if (target) queue.push(target)
    }
  }
  return seen
}

/** Each key's part: `boot`, `core` or `rest`. */
function localeParts(translation) {
  const bootNames = literalsIn(routeModules(routeIds('BOOT_ROUTE_IDS')))
  const coreNames = literalsIn(routeModules(routeIds('CORE_ROUTE_IDS')))
  const allNames = literalsIn(sourceFiles(SRC))
  const parts = new Map()
  for (const key of Object.keys(translation)) {
    if (bootNames.has(key)) parts.set(key, 'boot')
    else if (coreNames.has(key) || !allNames.has(key)) parts.set(key, 'core')
    else parts.set(key, 'rest')
  }
  return parts
}

function splitLocale(locale, part, parts) {
  const translation = {}
  for (const [key, value] of Object.entries(locale.translation)) {
    if (parts.get(key) === part) translation[key] = value
  }
  return { ...locale, translation }
}

let cachedParts = null

export default function i18nLocaleSplitLoader(source) {
  const part = this.resourceQuery.slice(1)
  const locale = JSON.parse(source)
  if (this.mode !== 'production') {
    return JSON.stringify(
      part === 'boot' ? locale : { ...locale, translation: {} }
    )
  }
  // Every locale carries every key (locales.test.ts), so one partition, taken
  // from the first locale built, serves them all.
  cachedParts ??= localeParts(locale.translation)
  return JSON.stringify(splitLocale(locale, part, cachedParts))
}
export { localeParts, splitLocale }
