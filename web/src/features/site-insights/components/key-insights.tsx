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
import { useTranslation } from 'react-i18next'

import {
  failureTone,
  SMALL_SAMPLE,
  TONES,
  tableState,
  useInsightsFormat,
  type InsightsRangeInfo,
  type SourceState,
  type useChargeFormat,
} from '../lib'
import type { APIKeyUsage, KeyInsights } from '../types'
import { StaleNote } from './insight-kit'
import { Panel, SimpleTable, UserLabel, type Column } from './shared'

/**
 * The customers' API keys over the range by consumption: who sent the
 * requests, how many failed on the service's side, and what each key cost.
 * Nothing is drawn while the server does not send the view (an older server
 * answers 404), so the tab reads as it did before.
 */
export function ApiKeysPanel(props: {
  data: KeyInsights | undefined
  source?: SourceState
  charge: ReturnType<typeof useChargeFormat>
  range?: InsightsRangeInfo
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  // Without the view there is nothing to show: a failed or absent read is
  // left out, so an unknown never reads as no consumption.
  if (props.data === undefined && props.source?.status !== 'pending') {
    return null
  }
  const data = props.data
  const largest = data?.keys[0]
  const keyName = (row: APIKeyUsage) => {
    if (row.token_id === 0) return t('No API key')
    if (row.token_id < 0) return t('Other keys')
    return row.token_name || `#${row.token_id}`
  }
  const failureText = (row: APIKeyUsage) => {
    const text = fmt.pct(row.service_failure_rate)
    // A small sample reads faded, not coloured, as the other tables do.
    if (row.requests < SMALL_SAMPLE) return text
    return (
      <span className={TONES[failureTone(row.service_failure_rate)]}>
        {text}
      </span>
    )
  }
  const columns = (): Column<APIKeyUsage>[] => [
    {
      key: 'key',
      label: t('API key'),
      render: (row) => keyName(row),
    },
    {
      key: 'owner',
      label: t('Owner'),
      render: (row) =>
        row.token_id > 0 ? (
          <UserLabel
            user_id={row.owner.user_id}
            username={row.owner.username}
          />
        ) : (
          '-'
        ),
    },
    {
      key: 'req',
      label: t('Requests'),
      align: 'right',
      render: (row) => fmt.num(row.requests),
    },
    {
      key: 'failure',
      label: t('Service failure rate'),
      hint: t(
        'Requests the service did not serve, less the ones the customer caused (a client error), over all requests.'
      ),
      align: 'right',
      render: failureText,
    },
    {
      key: 'usd',
      label: t('Consumption'),
      align: 'right',
      render: (row) => props.charge.usd(props.charge.toUSD(row.quota_usd)),
    },
    {
      key: 'share',
      label: t('Share'),
      align: 'right',
      render: (row) => fmt.pct(row.share),
    },
    {
      key: 'models',
      label: t('Top models'),
      render: (row) => (
        <span className='text-muted-foreground'>
          {row.top_models.map((model) => model.model).join(', ') || '-'}
        </span>
      ),
    },
  ]
  const rows = data
    ? [...data.keys, ...(data.other_keys ? [data.other_keys] : [])]
    : undefined
  const rangeHours = props.range
    ? Math.round((props.range.end - props.range.start) / 3600)
    : 0
  return (
    <Panel
      title={t('By API key')}
      help={t(
        'Each customer API key over the range, by consumption. Each hour keeps its largest keys by spend and by requests; the rest are summed into Other keys, so the totals stay whole.'
      )}
      description={
        largest
          ? t(
              '{{name}} is the largest key, with {{share}} of the consumption.',
              {
                name: keyName(largest),
                share: fmt.pct(largest.share),
              }
            )
          : undefined
      }
    >
      <SimpleTable
        rows={rows}
        rowKey={(row) => row.token_id}
        faded={(row) => row.requests < SMALL_SAMPLE}
        empty={t('No consumption in this range')}
        state={tableState(props.source, data?.keys)}
        columns={columns()}
      />
      {data && data.staff_keys.length > 0 && (
        <div className='mt-4 grid gap-2'>
          <h3 className='text-muted-foreground text-xs font-normal'>
            {t('Staff keys, apart from the customers’ figures')}
          </h3>
          <SimpleTable
            rows={data.staff_keys}
            rowKey={(row) => row.token_id}
            faded={(row) => row.requests < SMALL_SAMPLE}
            empty={t('No consumption in this range')}
            columns={columns()}
          />
        </div>
      )}
      <StaleNote staleHours={data?.stale_hours} rangeHours={rangeHours} />
    </Panel>
  )
}
