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
export type Section = { title: string; element: HTMLElement }

/**
 * The panels under a node, in page order: each heading's text and the card
 * it titles. A panel is named by its h3, as Panel writes it.
 */
export function readSections(container: HTMLElement | null): Section[] {
  if (!container) return []
  return [...container.querySelectorAll<HTMLElement>('h3')].flatMap(
    (heading) => {
      const title = heading.textContent?.trim()
      if (!title) return []
      const card = heading.closest<HTMLElement>('[data-slot=card]')
      return [{ title, element: card ?? heading }]
    }
  )
}

/** What a panel is told to open its folded group on. */
export const REVEAL_EVENT = 'site-insights:reveal'

/**
 * Opens the folded group holding a panel, if it sits in one, so the panel
 * can be scrolled to. The group is open once this returns.
 */
export function revealPanel(element: Element): void {
  element
    .closest('[data-details-group]')
    ?.dispatchEvent(new CustomEvent(REVEAL_EVENT))
}
