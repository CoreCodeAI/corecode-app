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
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '../copy-to-clipboard'

class ClipboardItemStub {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

// jsdom has no navigator.clipboard.
function mockClipboard(clipboard: Partial<Clipboard>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  })
}

function deferred() {
  let resolve: (text: string) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copying text that is still being fetched', () => {
  it('hands the clipboard a promise during the call, before the text arrives', async () => {
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)
    const write = vi.fn(async (items: ClipboardItemStub[]) => {
      await items[0].items['text/plain']
    })
    const writeText = vi.fn()
    mockClipboard({ write, writeText } as never)
    const text = deferred()

    const copied = copyToClipboard(text.promise)

    expect(write).toHaveBeenCalledTimes(1)
    text.resolve('sk-secret')
    expect(await copied).toBe(true)
    const blob = await write.mock.calls[0][0][0].items['text/plain']
    expect(await blob.text()).toBe('sk-secret')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('writes the text once it arrives when the browser has no ClipboardItem', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    const writeText = vi.fn(async () => {})
    mockClipboard({ writeText })

    expect(await copyToClipboard(Promise.resolve('sk-secret'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('sk-secret')
  })

  it('falls back to writing the text when the browser refuses the promise', async () => {
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)
    const write = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    const writeText = vi.fn(async () => {})
    mockClipboard({ write, writeText } as never)

    expect(await copyToClipboard(Promise.resolve('sk-secret'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('sk-secret')
  })

  it('copies nothing and reports failure when the text cannot be fetched', async () => {
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)
    const write = vi.fn(async (items: ClipboardItemStub[]) => {
      await items[0].items['text/plain']
    })
    const writeText = vi.fn(async () => {})
    mockClipboard({ write, writeText } as never)
    const text = deferred()

    const copied = copyToClipboard(text.promise)
    text.reject(new Error('denied'))

    expect(await copied).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('still writes a plain string with writeText', async () => {
    vi.stubGlobal('ClipboardItem', ClipboardItemStub)
    const write = vi.fn()
    const writeText = vi.fn(async () => {})
    mockClipboard({ write, writeText } as never)

    expect(await copyToClipboard('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(write).not.toHaveBeenCalled()
  })
})
