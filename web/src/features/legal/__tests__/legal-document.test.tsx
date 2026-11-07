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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LegalDocument } from '../legal-document'

vi.mock('@/components/layout', () => ({
  PublicLayout: ({ children }: { children: React.ReactNode }) => children,
}))

function renderDocument(data: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LegalDocument
        title='User Agreement'
        queryKey='user-agreement'
        fetchDocument={async () => ({ success: true, message: '', data })}
        emptyMessage='Not configured.'
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LegalDocument', () => {
  it('opens a document configured as a link directly', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace })

    renderDocument('https://corecode.live/docs/terms/')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('https://corecode.live/docs/terms/')
    )
  })

  it('carries a section anchor over to the linked document', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hash: '#aup', replace })

    renderDocument('https://corecode.live/docs/terms/')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        'https://corecode.live/docs/terms/#aup'
      )
    )
  })

  it('keeps the anchor the configured link already names', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, hash: '#aup', replace })

    renderDocument('https://corecode.live/docs/terms/#privacy')

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        'https://corecode.live/docs/terms/#privacy'
      )
    )
  })

  it('renders a document written in Markdown in place', async () => {
    const replace = vi.fn()
    vi.stubGlobal('location', { ...window.location, replace })

    renderDocument('# Terms\n\nBe kind.')

    expect(await screen.findByText('Be kind.')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })
})
