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
/**
 * CoreCode fork: a clock for relative times that one timer drives for every
 * cell that reads it. Each cell re-renders on its own tick, so the table and
 * its other columns stay put. A caller that passes `override` (a test, a
 * frozen preview) gets that time and no tick.
 */
import { useSyncExternalStore } from 'react'

const TICK_MS = 30_000

let current = Date.now()
let timer: number | undefined
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === undefined) {
    current = Date.now()
    timer = window.setInterval(() => {
      current = Date.now()
      listeners.forEach((notify) => notify())
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      window.clearInterval(timer)
      timer = undefined
    }
  }
}

function getSnapshot(): number {
  return current
}

export function useNow(override?: number): number {
  const ticking = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return override ?? ticking
}
