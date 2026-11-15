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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TFunction } from 'i18next'
import { useRef, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { namedHead, SECTIONS } from '../../lib'
import { onSale } from '../../quality-analysis'
import { sentences } from '../../verdicts/shared'
import { Findings } from '../insight-kit'
import { metricLayout } from '../metric-layout'
import { withRisk, type RiskCluster } from '../risk-analysis'
import { ClusterList, CLUSTERS_LISTED, CLUSTERS_OPEN } from '../risk-insights'
import { SectionMenu } from '../section-menu'
import { readSections } from '../sections'
import { Panel, Verdict } from '../shared'

vi.mock('@tanstack/react-router', () => ({
  Link: (props: { children: ReactNode }) => <a href='#'>{props.children}</a>,
}))

const t = ((key: string, vars?: Record<string, unknown>) =>
  key.replaceAll(/\{\{(\w+)\}\}/g, (_, name) =>
    String(vars?.[name] ?? '')
  )) as unknown as TFunction

describe('a verdict read as a list', () => {
  it('keeps each sentence apart and joins them into one text', () => {
    expect(sentences('One.', false, 'Two.', undefined, 'Three.')).toEqual({
      text: 'One. Two. Three.',
      points: ['One.', 'Two.', 'Three.'],
    })
    expect(sentences()).toEqual({ text: '', points: [] })
  })

  it('heads the list with the first sentence and lists the rest', () => {
    const answer = sentences('1,200 requests.', 'Peak 30 of 60.', '4 refused.')
    render(<Verdict tone='warning' {...answer} />)
    const status = screen.getByRole('status')
    expect(status.querySelector('p')).toHaveTextContent('1,200 requests.')
    expect(
      within(status)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.trim())
    ).toEqual(['Peak 30 of 60.', '4 refused.'])
    // Read as one text, it is the answer it always was.
    expect(status).toHaveTextContent(answer.text)
  })

  it('shows one sentence, or a text given alone, without a list', () => {
    const { rerender } = render(
      <Verdict tone='good' {...sentences('Nothing to check.')} />
    )
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    rerender(<Verdict tone='danger' text='Could not be read' />)
    expect(screen.getByRole('status')).toHaveTextContent('Could not be read')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('a row of figures on a wide screen', () => {
  it('keeps one row of six columns for up to six columns of figures', () => {
    expect(metricLayout([2, 1, 1, 1, 1])).toEqual({
      columns: 6,
      spans: [2, 1, 1, 1, 1],
    })
    expect(metricLayout([1, 1, 1])).toEqual({ columns: 6, spans: [1, 1, 1] })
  })

  it('spreads more over equal rows and widens the featured figure to fill them', () => {
    // Seven columns' worth: 3 + 1, then 4, instead of six and a lone card.
    expect(metricLayout([2, 1, 1, 1, 1, 1])).toEqual({
      columns: 4,
      spans: [3, 1, 1, 1, 1, 1],
    })
    // Nine: 3 + 1 + 1, then five.
    expect(metricLayout([2, 1, 1, 1, 1, 1, 1, 1])).toEqual({
      columns: 5,
      spans: [3, 1, 1, 1, 1, 1, 1, 1],
    })
    // Eight fill two rows of four as they are.
    expect(metricLayout([2, 1, 1, 1, 1, 1, 1])).toEqual({
      columns: 4,
      spans: [2, 1, 1, 1, 1, 1, 1],
    })
  })

  it('widens the last figure when none is featured', () => {
    expect(metricLayout([1, 1, 1, 1, 1, 1, 1])).toEqual({
      columns: 4,
      spans: [1, 1, 1, 1, 1, 1, 2],
    })
  })

  it('fills every row: no layout it returns leaves a gap', () => {
    for (let count = 1; count <= 14; count++) {
      for (const featured of [false, true]) {
        const spans = Array.from({ length: count }, (_, index) =>
          featured && index === 0 ? 2 : 1
        )
        const layout = metricLayout(spans)
        const units = layout.spans.reduce((sum, span) => sum + span, 0)
        const total = spans.reduce((sum, span) => sum + span, 0)
        if (total > 6) expect(units % layout.columns).toBe(0)
        expect(layout.spans).toHaveLength(count)
      }
    }
  })
})

describe('a long list named by its head', () => {
  it('names the first three and counts the rest', () => {
    expect(namedHead(t, ['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2 more')
    expect(namedHead(t, ['a', 'b', 'c'])).toBe('a, b, c')
    expect(namedHead(t, ['a', 'b'], 1)).toBe('a +1 more')
    expect(namedHead(t, [])).toBe('')
  })

  it('leaves out the models the server names as taken off sale', () => {
    const models = [{ model: 'sold' }, { model: 'gone' }]
    expect(onSale(models, { retired_models: ['gone'] })).toEqual([
      { model: 'sold' },
    ])
    // A server that does not say, or says none, retires nothing.
    expect(onSale(models, {})).toEqual(models)
    expect(onSale(models, { retired_models: null })).toEqual(models)
    expect(onSale(undefined, undefined)).toEqual([])
  })
})

function cluster(index: number): RiskCluster {
  return {
    ip: `10.0.0.${index}`,
    requests: index,
    subscription_buyers: 0,
    users: [
      {
        user_id: index * 10,
        username: `user-${index}`,
        requests: index,
        paid: false,
        subscription: false,
        created_at: 0,
        balance_usd: 0,
      },
      {
        user_id: index * 10 + 1,
        username: `mate-${index}`,
        requests: 0,
        paid: false,
        subscription: false,
        created_at: 0,
        balance_usd: 0,
      },
    ],
  }
}

describe('shared addresses as a queue', () => {
  const clusters = withRisk([1, 2, 3, 4, 5].map(cluster), 0)

  it('shows the accounts of the first few and only the line of the rest', async () => {
    const user = userEvent.setup()
    render(<ClusterList clusters={clusters} />)
    expect(CLUSTERS_OPEN).toBe(3)
    expect(screen.getByText('user-3')).toBeInTheDocument()
    expect(screen.queryByText('user-4')).not.toBeInTheDocument()
    // Every address still has its line.
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()

    const fourth = screen.getByRole('button', { name: /10\.0\.0\.4/ })
    expect(fourth).toHaveAttribute('aria-expanded', 'false')
    await user.click(fourth)
    expect(fourth).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('user-4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /10\.0\.0\.1/ }))
    expect(screen.queryByText('user-1')).not.toBeInTheDocument()
  })

  it('opens and closes them all at once', async () => {
    const user = userEvent.setup()
    render(<ClusterList clusters={clusters} />)
    await user.click(screen.getByRole('button', { name: 'Expand All' }))
    expect(screen.getByText('user-5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('user-1')).not.toBeInTheDocument()
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument()
  })

  it('lists the first ten and the rest only when asked', async () => {
    const user = userEvent.setup()
    const many = withRisk(
      Array.from({ length: 12 }, (_, index) => cluster(index + 1)),
      0
    )
    render(<ClusterList clusters={many} />)
    expect(CLUSTERS_LISTED).toBe(10)
    expect(screen.getByText('10.0.0.10')).toBeInTheDocument()
    expect(screen.queryByText('10.0.0.11')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Show all 12 addresses' })
    )
    expect(screen.getByText('10.0.0.12')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Show the first 10 only' })
    )
    expect(screen.queryByText('10.0.0.12')).not.toBeInTheDocument()
  })

  it('offers no switch for a list that is all open anyway', () => {
    render(<ClusterList clusters={clusters.slice(0, 3)} />)
    expect(
      screen.queryByRole('button', { name: 'Expand All' })
    ).not.toBeInTheDocument()
    expect(screen.getByText('user-3')).toBeInTheDocument()
  })
})

function Page() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div>
      <SectionMenu container={ref} />
      <div ref={ref}>
        <Panel title='First panel' help='How it is counted'>
          one
        </Panel>
        <Panel id='second' title='Second panel'>
          two
        </Panel>
      </div>
    </div>
  )
}

describe('a finding that opens its tab at a panel', () => {
  it('passes the panel with the tab, and the tab alone without one', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <Findings
        onOpen={onOpen}
        tabLabel={(tab) => `Tab ${tab}`}
        items={[
          {
            key: 'a',
            tone: 'danger',
            title: 'Debt',
            tab: 'finance',
            section: SECTIONS.debtors,
          },
          { key: 'b', tone: 'warning', title: 'Slow', tab: 'quality' },
        ]}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Tab finance →' }))
    expect(onOpen).toHaveBeenLastCalledWith('finance', 'debtors')
    await user.click(screen.getByRole('button', { name: 'Tab quality →' }))
    expect(onOpen).toHaveBeenLastCalledWith('quality')
  })
})

describe('the menu of a tab’s panels', () => {
  it('lists the panels by their titles, each with its card', () => {
    render(<Page />)
    const sections = readSections(document.body)
    expect(sections.map((section) => section.title)).toEqual([
      'First panel',
      'Second panel',
    ])
    expect(sections[1].element.id).toBe('second')
    expect(readSections(null)).toEqual([])
  })

  it('scrolls to the panel picked', async () => {
    const user = userEvent.setup()
    const scrolled: string[] = []
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(function scrollIntoView(this: HTMLElement) {
        scrolled.push(this.id)
      })
    render(<Page />)
    await user.click(
      screen.getByRole('button', { name: 'Sections of this tab' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Second panel' })
    )
    expect(scrolled).toEqual(['second'])
    scroll.mockRestore()
  })
})
