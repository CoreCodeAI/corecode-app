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
/**
 * CoreCode fork: open a tab inside a click handler, point it later.
 *
 * Browsers (Safari above all) block `window.open` once an `await` has passed
 * since the click. So the tab opens blank, synchronously, and its location is
 * set when the key is ready.
 */

export type PendingTab = {
  /** Send the tab to the url; opens a fresh tab if the blank one was blocked. */
  navigate: (url: string) => void
  /** Close the blank tab. */
  close: () => void
}

/** Call synchronously from a click handler. */
export function openPendingTab(): PendingTab {
  const tab = window.open('about:blank', '_blank')
  if (tab) {
    // The canvas is another origin: it must not reach back into the console.
    tab.opener = null
  }
  return {
    navigate: (url) => {
      if (tab && !tab.closed) {
        tab.location.href = url
        return
      }
      window.open(url, '_blank', 'noopener')
    },
    close: () => {
      if (tab && !tab.closed) tab.close()
    },
  }
}
