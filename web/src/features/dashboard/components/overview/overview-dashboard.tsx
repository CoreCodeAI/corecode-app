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
/**
 * CoreCode fork: the overview is built for a Claude Code customer. It leads
 * with the balance and how to connect, then shows spend, cache hit rate and
 * the latest requests. Content panels render only when the operator has
 * filled them, so an empty deployment never shows placeholder cards.
 */
import { BookOpen, KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { ClientSetupGuide } from '@/features/keys/components/client-setup-guide'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { useBalanceStatus } from '../../hooks/use-balance-status'
import { useCustomerOverview } from '../../hooks/use-customer-overview'
import {
  useAnnouncements,
  useDashboardContentVisibility,
  useFAQ,
} from '../../hooks/use-status-data'
import {
  getFirstRunSteps,
  isFirstRun,
  SETUP_SECTION_ID,
} from '../../lib/first-run'
import { AnnouncementsPanel } from './announcements-panel'
import { BalanceCard } from './balance-card'
import { FAQPanel } from './faq-panel'
import { FirstRunChecklist } from './first-run-checklist'
import { OverviewAlerts } from './overview-alerts'
import { PerformanceHealthPanel } from './performance-health-panel'
import { RecentRequestsPanel } from './recent-requests-panel'
import { SpendTrendPanel } from './spend-trend-panel'
import { UptimePanel } from './uptime-panel'
import { UsageHighlights } from './usage-highlights'

export function OverviewDashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)
  const firstRun = user ? isFirstRun(user) : false
  const { status } = useStatus()
  const overview = useCustomerOverview()
  const balanceStatus = useBalanceStatus(
    Number(user?.quota ?? 0),
    overview.daily
  )
  const visibility = useDashboardContentVisibility()
  const announcements = useAnnouncements()
  const faq = useFAQ()
  const docsLink =
    typeof status?.docs_link === 'string' ? status.docs_link.trim() : ''

  const showAnnouncements =
    visibility.announcements && announcements.items.length > 0
  const showFAQ = visibility.faq && faq.items.length > 0

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Overview')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {docsLink && (
          <Button
            variant='ghost'
            size='sm'
            render={<a href={docsLink} target='_blank' rel='noreferrer' />}
          >
            <BookOpen data-icon='inline-start' />
            {t('Docs')}
          </Button>
        )}
        <Button size='sm' render={<Link to='/keys' />}>
          <KeyRound data-icon='inline-start' />
          {t('API Keys')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <CardStaggerContainer className='flex min-w-0 flex-col gap-4'>
          <OverviewAlerts
            balanceHealth={balanceStatus.health}
            runwayDays={balanceStatus.runwayDays}
            recent={overview.recent}
            firstRun={firstRun}
          />
          {firstRun && (
            <FirstRunChecklist
              loading={overview.keysLoading}
              steps={getFirstRunSteps({
                available: balanceStatus.available,
                keyCount: overview.keys.length,
                requestCount: Number(user?.request_count ?? 0),
              })}
            />
          )}
          <div className='grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]'>
            <CardStaggerItem>
              <BalanceCard
                daily={overview.daily}
                loading={overview.trendLoading}
              />
            </CardStaggerItem>
            <CardStaggerItem>
              <section
                id={SETUP_SECTION_ID}
                aria-labelledby='overview-setup-title'
                className='bg-card h-full min-w-0 scroll-mt-4 rounded-2xl border p-4 shadow-xs sm:p-5'
              >
                <ClientSetupGuide
                  keys={overview.keys}
                  keysLoading={overview.keysLoading}
                  renderHeading={(title) => (
                    <div className='mb-1 flex flex-col gap-1'>
                      <h2
                        id='overview-setup-title'
                        className='text-lg leading-tight'
                      >
                        {title}
                      </h2>
                      <p className='text-muted-foreground text-sm'>
                        {t('Copy the config with your key filled in.')}
                      </p>
                    </div>
                  )}
                />
              </section>
            </CardStaggerItem>
          </div>

          <CardStaggerItem>
            <UsageHighlights
              daily={overview.daily}
              trendLoading={overview.trendLoading}
              recent={overview.recent}
              logsLoading={overview.logsLoading}
            />
          </CardStaggerItem>

          <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
            <CardStaggerItem className='h-full'>
              <SpendTrendPanel
                daily={overview.daily}
                loading={overview.trendLoading}
              />
            </CardStaggerItem>
            <CardStaggerItem className='h-full'>
              <RecentRequestsPanel
                logs={overview.recentLogs}
                loading={overview.logsLoading}
              />
            </CardStaggerItem>
          </div>

          {(showAnnouncements || showFAQ) && (
            <div
              className={cn(
                'grid grid-cols-1 gap-4',
                showAnnouncements && showFAQ && 'xl:grid-cols-2'
              )}
            >
              {showAnnouncements && (
                <CardStaggerItem>
                  <AnnouncementsPanel />
                </CardStaggerItem>
              )}
              {showFAQ && (
                <CardStaggerItem>
                  <FAQPanel />
                </CardStaggerItem>
              )}
            </div>
          )}

          {visibility.uptimeKuma && (
            <CardStaggerItem>
              <UptimePanel />
            </CardStaggerItem>
          )}

          {isAdmin && (
            <CardStaggerItem>
              <PerformanceHealthPanel />
            </CardStaggerItem>
          )}
        </CardStaggerContainer>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
