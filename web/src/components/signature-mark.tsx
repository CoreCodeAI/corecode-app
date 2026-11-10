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
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'

// The stylesheet reads this: see .signature-mark in styles/corecode-brand.css.
const FIELD = {
  '--signature-field': 'url(/brand/signature-field.svg)',
} as CSSProperties

type SignatureMarkProps = {
  className?: string
}

/**
 * The CoreCode C drawn in the characters of real Claude thinking signatures,
 * as on the home page. Decoration for pages where nobody is working: sign-in,
 * a page that does not exist, a list with nothing in it.
 *
 * The drawing is /brand/signature-field.svg, which the host serves beside the
 * console (corecode-infra's site/brand). Where it is missing, a local dev
 * server for one, the mask has no image and the mark paints nothing.
 */
export function SignatureMark(props: SignatureMarkProps) {
  return (
    <div
      aria-hidden='true'
      className={cn('signature-mark pointer-events-none', props.className)}
      style={FIELD}
    />
  )
}
