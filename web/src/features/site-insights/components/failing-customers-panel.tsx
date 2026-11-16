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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import {
  failureTone,
  SMALL_SAMPLE,
  TONES,
  tableState,
  useInsightsFormat,
  type InsightsRangeInfo,
  type SourceState,
} from '../lib'
import type { FailingUser } from '../types'
import { StaleNote } from './insight-kit'
import { Panel, SimpleTable, UserLabel, type Column } from './shared'

/**
 * The customers who met the most service failures over the range, with the
 * model that failed most for each. Nothing is drawn while the server does not
 * send the field (an older server leaves it out), so the tab reads as it did
 * before.
 */
export function FailingCustomersPanel(props: {
  /** The keys view's failing customers; absent on a server that does not send it, and while loading. */
  users: FailingUser[] | null | undefined
  staleHours?: number | null
  source?: SourceState
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  // Without the view there is nothing to show: a failed or absent read is
  // left out, so an unknown never reads as no failures.
  if (!props.users && props.source?.status !== 'pending') return null
  const rows = props.users ?? undefined
  const largest = rows?.[0]
  const rangeHours = props.range
    ? Math.round((props.range.end - props.range.start) / 3600)
    : 0
  const failureText = (row: FailingUser) => {
    const text = fmt.pct(row.service_failure_rate)
    // A small sample reads faded, not coloured, as the keys table does.
    if (row.requests < SMALL_SAMPLE) return text
    return (
      <span className={TONES[failureTone(row.service_failure_rate)]}>
        {text}
      </span>
    )
  }
  const columns: Column<FailingUser>[] = [
    {
      key: 'user',
      label: t('Customer'),
      render: (row) => (
        <UserLabel user_id={row.user_id} username={row.username} />
      ),
    },
    {
      key: 'req',
      label: t('Requests'),
      align: 'right',
      render: (row) => fmt.num(row.requests),
    },
    {
      key: 'failures',
      label: t('Service failures'),
      align: 'right',
      render: (row) => fmt.num(row.service_failures),
    },
    {
      key: 'failure',
      label: t('Service failure rate'),
      hint: t(
        'Requests the service did not serve, less the ones the customer caused (a client error), over all their requests.'
      ),
      align: 'right',
      render: failureText,
    },
    {
      key: 'model',
      label: t('Model that failed most'),
      render: (row) =>
        row.top_model ? (
          <span>
            {row.top_model}{' '}
            <span className='text-muted-foreground'>
              ({fmt.num(row.top_model_failures)})
            </span>
          </span>
        ) : (
          '-'
        ),
    },
    {
      key: 'links',
      label: t('Links'),
      render: (row) => (
        <Link
          to='/usage-logs/$section'
          params={{ section: 'common' }}
          search={{ userId: String(row.user_id) }}
          className='text-primary text-xs font-medium hover:underline'
        >
          {t('Logs')}
        </Link>
      ),
    },
  ]
  return (
    <Panel
      title={t('Customers with the most service failures')}
      help={t(
        'The customers with the most requests the service failed over the range, the top 20. A failure the customer caused (such as a client error on their own request) does not count. Staff are left out. Requests no channel could take are counted as failures: the stored key rows do not tell them apart from other failures. A customer whose keys were folded into Other keys in a busy hour cannot be named.'
      )}
      description={
        largest
          ? t(
              '{{name}} met the most service failures: {{failures}} of their {{requests}} requests.',
              {
                name: largest.username || `#${largest.user_id}`,
                failures: fmt.num(largest.service_failures),
                requests: fmt.num(largest.requests),
              }
            )
          : undefined
      }
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.user_id}
        faded={(row) => row.requests < SMALL_SAMPLE}
        empty={t('No customer had a service failure in this range')}
        state={tableState(props.source, rows)}
        columns={columns}
      />
      <StaleNote staleHours={props.staleHours} rangeHours={rangeHours} />
    </Panel>
  )
}
