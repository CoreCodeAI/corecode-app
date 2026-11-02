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
import { createContext, use, useState, type ComponentProps } from 'react'

import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip'

const TapContext = createContext<(() => void) | null>(null)

/**
 * A tooltip that a tap opens too. Base UI's tooltip opens on mouse hover and
 * keyboard focus only, so on a touch screen a chart's marks read out nothing.
 * Here a tap toggles it and a tap anywhere else closes it; a mouse behaves as
 * before. Pair it with `TapTooltipTrigger`.
 */
export function TapTooltip(
  props: Omit<
    ComponentProps<typeof Tooltip>,
    'open' | 'defaultOpen' | 'onOpenChange'
  >
) {
  const [open, setOpen] = useState(false)
  return (
    <TapContext value={() => setOpen((current) => !current)}>
      <Tooltip {...props} open={open} onOpenChange={setOpen} />
    </TapContext>
  )
}

/**
 * The trigger of a `TapTooltip`. A click does not close it, so the tap that
 * opened it is not undone by the click the same tap fires.
 */
export function TapTooltipTrigger(
  props: ComponentProps<typeof TooltipTrigger>
) {
  const toggle = use(TapContext)
  return (
    <TooltipTrigger
      closeOnClick={false}
      {...props}
      onPointerDown={(event) => {
        props.onPointerDown?.(event)
        if (event.pointerType !== 'mouse') toggle?.()
      }}
    />
  )
}
