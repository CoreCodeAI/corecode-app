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
import { CopyButton } from '@/components/copy-button'

/** A detail value with a copy button, for identifiers quoted to support. */
export function CopyableDetailValue(props: { value: string; label: string }) {
  return (
    <span className='flex min-w-0 items-start gap-1'>
      <span className='min-w-0 flex-1'>{props.value}</span>
      <CopyButton
        value={props.value}
        className='-my-1 size-6'
        iconClassName='size-3.5'
        aria-label={props.label}
      />
    </span>
  )
}
