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
import fs from 'node:fs'
import path from 'node:path'

// Fails the build when a core page's first load outgrows its budget in
// first-load-budget.json. A page's first load is what a cold visit downloads
// before the console can render it: the scripts and stylesheet index.html
// references, the chunks the inline route preload names for the page (and its
// layouts), and the parts of the zhCN locale the page renders from. Sizes are
// the brotli files the server sends. One import from a route's options once added 144 KB to every page's
// first load and nothing in review showed it; this makes such a change fail CI
// until the budget is raised on purpose.
//
//   node scripts/check-first-load.mjs          after `bun run build`
const DIST = path.resolve('dist')
const BUDGET = path.resolve('first-load-budget.json')

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const budget = JSON.parse(fs.readFileSync(BUDGET, 'utf8'))

const size = (file) => {
  const full = path.join(DIST, file)
  return fs.existsSync(`${full}.br`)
    ? fs.statSync(`${full}.br`).size
    : fs.statSync(full).size
}

const entry = [
  ...html.matchAll(/(?:src|href)="\/(static\/[^"]+\.(?:js|css))"/g),
].map((m) => m[1])
// pluginPreloadLocale's chunk URLs by language, for the boot, core and rest
// parts of the locale.
const localeUrls = html.match(/var u=(\[\{.*?\}\]);/)?.[1]
// pluginPreloadRoute's table (rsbuild.config.ts): chunk names, then rows of
// [pattern, protected, chunk indexes, locale tier].
const table = html.match(/var f=(\[.*?\]),r=(\[.*?\]),s=(\[.*?\]);/)
if (entry.length === 0 || !localeUrls || !table) {
  console.error(
    'check-first-load: dist/index.html has no entry, locale preload or route table; did the preload plugins change?'
  )
  process.exit(1)
}
const locale = JSON.parse(localeUrls).map((urls) => urls.zhCN.slice(1))
const names = JSON.parse(table[1])
const routes = JSON.parse(table[2])
const chunkFile = (name) =>
  name.includes('/') ? name : `static/js/async/${name}.js`

let failed = false
for (const [page, limitKB] of Object.entries(budget)) {
  const route = routes.find(([pattern]) =>
    new RegExp(`^${pattern}$`).test(page)
  )
  if (!route) {
    console.error(`check-first-load: no preload route matches ${page}`)
    failed = true
    continue
  }
  const files = new Set([
    ...entry,
    ...locale.slice(0, route[3] + 1),
    ...route[2].map((i) => chunkFile(names[i])),
  ])
  const bytes = [...files].reduce((sum, file) => sum + size(file), 0)
  const room = limitKB * 1024 - bytes
  const over = room < 0
  failed ||= over
  // Bytes as well as KB: a rounded figure reads the same a few bytes either
  // side of the limit.
  console.log(
    `${over ? 'OVER' : 'ok  '} ${page.padEnd(22)} ${(bytes / 1024).toFixed(1).padStart(6)} KB of ${limitKB} KB, ${files.size} files, ${over ? `${-room} bytes over` : `${room} bytes left`}`
  )
}
if (failed) {
  console.error(
    'check-first-load: a core page downloads more before it renders. Find what pulled code in, or raise its budget in first-load-budget.json on purpose.'
  )
  process.exit(1)
}
