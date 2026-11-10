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
import { cn } from '@/lib/utils'

type BrandWordmarkProps = {
  name: string
  className?: string
}

// Two capitalised words written as one, such as CoreCode.
const TWO_WORDS = /^([A-Z][a-z0-9]+)([A-Z][a-z0-9]+)$/

/**
 * The system's name set as the static site's header sets it: serif, with the
 * second word of a two-word name in the accent colour. Any other name is one
 * word in the text colour.
 */
export function BrandWordmark(props: BrandWordmarkProps) {
  const words = TWO_WORDS.exec(props.name)

  return (
    <span
      title={props.name}
      className={cn(
        'truncate font-serif font-semibold tracking-tight',
        props.className
      )}
    >
      {words ? (
        <>
          {words[1]}
          <span className='text-primary'>{words[2]}</span>
        </>
      ) : (
        props.name
      )}
    </span>
  )
}
