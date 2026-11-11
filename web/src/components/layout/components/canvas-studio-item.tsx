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
import { ExternalLink, Loader2 } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'

import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { openPendingTab } from '@/features/canvas-studio/lib/canvas-tab'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'

import type { NavCanvasStudio } from '../types'

// Only a customer without a suitable key ever sees the dialog.
const CanvasKeyDialog = lazy(() =>
  import('@/features/canvas-studio/components/canvas-key-dialog').then((m) => ({
    default: m.CanvasKeyDialog,
  }))
)

/**
 * Sidebar button that opens the canvas app in a new tab. The tab opens inside
 * the click, before any await, so popup blockers allow it; the key lookup
 * loads on the first click and the URL carries the key in its fragment.
 */
export function CanvasStudioItem({ item }: { item: NavCanvasStudio }) {
  const { serverAddress } = useChatPresets()
  const { setOpenMobile } = useSidebar()
  const [busy, setBusy] = useState(false)
  const [needsKey, setNeedsKey] = useState(false)
  const busyRef = useRef(false)

  const run = async (mode: 'find' | 'create') => {
    if (busyRef.current) return
    // Synchronous: still inside the click's user gesture.
    const tab = openPendingTab()
    busyRef.current = true
    setBusy(true)
    try {
      const { openCanvasStudio } =
        await import('@/features/canvas-studio/lib/open-canvas')
      const result = await openCanvasStudio(tab, serverAddress, mode)
      // On mobile the dialog lives in the sidebar sheet, so close it only once
      // the canvas has opened.
      if (result === 'opened') setOpenMobile(false)
      setNeedsKey(
        result === 'needs-key' || (mode === 'create' && result === 'failed')
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={item.title}
        aria-disabled={busy ? 'true' : undefined}
        onClick={() => {
          void run('find')
        }}
      >
        {item.icon && <item.icon className='shrink-0' />}
        <span className='min-w-0 flex-1 truncate'>{item.title}</span>
        {busy ? (
          <Loader2 className='size-4 shrink-0 animate-spin group-data-[collapsible=icon]:hidden' />
        ) : (
          <ExternalLink className='size-4 shrink-0 opacity-70 group-data-[collapsible=icon]:hidden' />
        )}
      </SidebarMenuButton>
      {needsKey && (
        <Suspense fallback={null}>
          <CanvasKeyDialog
            open
            busy={busy}
            onCreate={() => void run('create')}
            onCancel={() => setNeedsKey(false)}
          />
        </Suspense>
      )}
    </SidebarMenuItem>
  )
}
