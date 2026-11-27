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

import { useInsightsFormat, SERIES_COLORS } from '../lib'
import type { PersonaCustomer, PersonaInsights, PersonaWhale } from '../types'
import { Panel, SimpleTable, UserLabel, type Column } from './shared'
import { StackBar } from './stack-bar'

/** The sector names a persona block may carry, and the one for none. */
function useSectorLabel(): (sector: string) => string {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    科研: t('Academic research and student papers'),
    软件: t('Software development, SaaS and agents'),
    游戏: t('Games'),
    硬件: t('Hardware, embedded, automotive electronics and robotics'),
    内容: t('Content, video and self-media'),
    专业: t('Professional services and data'),
    其他: t('Other'),
  }
  return (sector: string) => labels[sector] ?? t('Unidentified')
}

/**
 * The customer personas kept in the admin remarks: how the customers with a
 * persona spend by sector, each of them, and the large customers who have none.
 * Spend is the 30 days that end at the page's end, in yuan.
 */
export function PersonasTab(props: { data: PersonaInsights | undefined }) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const sectorLabel = useSectorLabel()
  const sectors = props.data?.sectors ?? []
  const segments = sectors.map((sector, index) => ({
    key: sector.sector,
    label: sectorLabel(sector.sector),
    value: sector.spend_usd,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
  }))

  const sectorColumns: Column<PersonaInsights['sectors'][number]>[] = [
    {
      key: 'sector',
      label: t('Sector'),
      render: (row) => sectorLabel(row.sector),
    },
    {
      key: 'customers',
      label: t('Customers'),
      align: 'right',
      render: (row) => fmt.num(row.customers),
    },
    {
      key: 'spend',
      label: t('Spend, 30 days'),
      align: 'right',
      render: (row) => fmt.cny(row.spend_usd),
    },
    {
      key: 'share',
      label: t('Share'),
      align: 'right',
      render: (row) => fmt.pct(row.share),
    },
  ]

  const customerColumns: Column<PersonaCustomer>[] = [
    {
      key: 'user',
      label: t('User'),
      render: (row) => (
        <UserLabel user_id={row.user_id} username={row.username} />
      ),
    },
    {
      key: 'sector',
      label: t('Sector'),
      render: (row) => (
        <span>
          {sectorLabel(row.sector)}
          {row.detail && (
            <span className='text-muted-foreground'> · {row.detail}</span>
          )}
        </span>
      ),
    },
    {
      key: 'tags',
      label: t('Tags'),
      render: (row) => row.tags.join('、') || '-',
    },
    {
      key: 'remark',
      label: t('Remark'),
      render: (row) => row.remark || '-',
    },
    {
      key: 'spend',
      label: t('Spend, 30 days'),
      align: 'right',
      render: (row) => fmt.cny(row.spend_usd),
    },
    {
      key: 'last_active',
      label: t('Last active day'),
      render: (row) => (row.last_active > 0 ? fmt.day(row.last_active) : '-'),
    },
    {
      key: 'persona_date',
      label: t('Persona date'),
      render: (row) => row.persona_date,
    },
  ]

  const whaleColumns: Column<PersonaWhale>[] = [
    {
      key: 'user',
      label: t('User'),
      render: (row) => (
        <UserLabel user_id={row.user_id} username={row.username} />
      ),
    },
    {
      key: 'spend',
      label: t('Spend, 30 days'),
      align: 'right',
      render: (row) => fmt.cny(row.spend_usd),
    },
    {
      key: 'last_active',
      label: t('Last active day'),
      render: (row) => (row.last_active > 0 ? fmt.day(row.last_active) : '-'),
    },
  ]

  return (
    <div className='grid gap-4'>
      <Panel
        title={t('Customers by sector')}
        help={t(
          'Each customer with a persona block in the admin remark, grouped by the sector the block names. Customers whose block names no sector count as unidentified. Spend is the 30 days that end at the page’s end, in yuan.'
        )}
      >
        <div className='grid gap-3'>
          <StackBar
            segments={segments}
            ariaLabel={t('Spend by sector')}
            format={fmt.cny}
          />
          <SimpleTable
            columns={sectorColumns}
            rows={props.data?.sectors}
            rowKey={(row) => row.sector}
            empty={t('No customer has a persona block yet')}
          />
        </div>
      </Panel>
      <Panel
        title={t('Customers with a persona')}
        help={t(
          'Sorted by spend over the 30 days that end at the page’s end. The remark is the human note before the block; tags are the rest of the block.'
        )}
      >
        <SimpleTable
          columns={customerColumns}
          rows={props.data?.customers}
          rowKey={(row) => row.user_id}
          empty={t('No customer has a persona block yet')}
        />
      </Panel>
      <Panel
        title={t('Large customers without a persona')}
        description={t('Spend of {{floor}} and up, with no persona block.', {
          floor: fmt.cny(props.data?.whale_floor_usd ?? 0),
        })}
      >
        <SimpleTable
          columns={whaleColumns}
          rows={props.data?.whales}
          rowKey={(row) => row.user_id}
          empty={t('Every large customer has a persona block')}
        />
      </Panel>
    </div>
  )
}
