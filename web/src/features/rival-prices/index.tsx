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
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getRivalBoard } from './api'
import { BoardTab } from './components/board-tab'
import { ChangesTab } from './components/changes-tab'
import { SettingsBar } from './components/settings-bar'
import { SitesTab } from './components/sites-tab'
import type { RivalTab } from './constants'

const route = getRouteApi('/_authenticated/rival-prices/')

export function RivalPrices() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tab: RivalTab = search.tab ?? 'board'
  const board = useQuery({
    queryKey: ['rival-prices', 'board', search.model ?? ''],
    queryFn: () => getRivalBoard(search.model),
    placeholderData: (previous) => previous,
  })
  const counts = board.data?.counts

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Rival prices')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4 px-3 pb-6 sm:px-4'>
          {board.data && <SettingsBar board={board.data} />}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Tabs
              value={tab}
              onValueChange={(value) =>
                void navigate({
                  search: (prev) => ({ ...prev, tab: value as RivalTab }),
                })
              }
            >
              <TabsList>
                <TabsTrigger value='board'>{t('Price board')}</TabsTrigger>
                <TabsTrigger value='sites'>{t('Sites')}</TabsTrigger>
                <TabsTrigger value='changes'>{t('Price changes')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {counts && (
              <span className='text-muted-foreground text-xs'>
                {t(
                  '{{ok}} priced · {{unsupported}} without a price list · {{error}} unreachable · {{pending}} waiting · {{total}} sites',
                  counts
                )}
              </span>
            )}
          </div>
          {board.isError && (
            <p className='text-destructive text-sm'>{board.error.message}</p>
          )}
          {tab === 'board' && board.data && (
            <BoardTab
              board={board.data}
              onModelChange={(model) =>
                void navigate({ search: (prev) => ({ ...prev, model }) })
              }
            />
          )}
          {tab === 'sites' && <SitesTab />}
          {tab === 'changes' && board.data && (
            <ChangesTab model={board.data.model} />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
