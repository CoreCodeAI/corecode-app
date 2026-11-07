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
import { getRouteApi } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'
import { RiskGateDashboard } from '@/features/system-settings/risk-gate/risk-gate-dashboard'
import {
  RiskGateForm,
  type RiskGateValues,
} from '@/features/system-settings/risk-gate/risk-gate-form'
import {
  ViolationGuardForm,
  type ViolationGuardValues,
} from '@/features/system-settings/violation-guard/violation-guard-form'
import { ViolationRecords } from '@/features/system-settings/violation-guard/violation-records'
import { cn } from '@/lib/utils'

import type { RiskControlTab } from './constants'

const route = getRouteApi('/_authenticated/risk-control/')

const defaultViolationGuard: ViolationGuardValues = {
  'violation_guard_setting.enabled': false,
  'violation_guard_setting.mode': 'observe',
  'violation_guard_setting.suspend_hours': 24,
  'violation_guard_setting.ban_strikes': 2,
  'violation_guard_setting.strike_window_days': 30,
  'violation_guard_setting.lenient_categories': 'reasoning_extraction',
  'violation_guard_setting.lenient_warnings': 2,
  'violation_guard_setting.client_check_limit': 5,
}

const defaultRiskGate: RiskGateValues = {
  'risk_gate_setting.enabled': false,
  'risk_gate_setting.mode': 'observe',
  'risk_gate_setting.distill_enabled': true,
  'risk_gate_setting.distill_rules': '',
  'risk_gate_setting.distill_strike': true,
  'risk_gate_setting.hard_regex_enabled': true,
  'risk_gate_setting.hard_regex_rules': '',
  'risk_gate_setting.hard_regex_strike': false,
  'risk_gate_setting.similarity_enabled': true,
  'risk_gate_setting.similarity_threshold': 0.85,
  'risk_gate_setting.decision_enabled': false,
  'risk_gate_setting.decision_base_url': '',
  'risk_gate_setting.decision_api_key': '',
  'risk_gate_setting.decision_model': '',
  'risk_gate_setting.decision_questions': '',
  'risk_gate_setting.decision_threshold': 0.8,
  'risk_gate_setting.decision_timeout_ms': 3000,
  'risk_gate_setting.decision_fail_open': true,
  'risk_gate_setting.decision_strike': true,
  'risk_gate_setting.decision_skip_official': false,
}

type OptionValues = Record<string, string | number | boolean | unknown[]>

/**
 * Folds a settings form under the records it governs. The form's save
 * buttons portal into this panel's header, not the page's, so they sit
 * beside the form and leave with it when the panel closes.
 */
function SettingsPanel<T extends OptionValues>(props: {
  title: string
  defaults: T
  render: (values: T) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [actions, setActions] = useState<HTMLDivElement | null>(null)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='bg-card rounded-lg border'
    >
      <div className='flex flex-wrap items-center justify-between gap-2 px-4 py-3'>
        <CollapsibleTrigger className='flex items-center gap-1.5 text-sm font-semibold'>
          <ChevronRight
            aria-hidden
            className={cn('size-4 transition-transform', open && 'rotate-90')}
          />
          {props.title}
        </CollapsibleTrigger>
        <div ref={setActions} className='flex items-center gap-2' />
      </div>
      <CollapsibleContent className='border-t p-4'>
        <SettingsPageProvider actionsContainer={actions}>
          <SettingsPanelBody defaults={props.defaults} render={props.render} />
        </SettingsPageProvider>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SettingsPanelBody<T extends OptionValues>(props: {
  defaults: T
  render: (values: T) => ReactNode
}) {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch } = useSystemOptions()
  const { defaults } = props
  // The forms reset whenever their defaults change identity, so the values
  // must stay the same object until the options themselves change.
  const values = useMemo(
    () => getOptionValue(data?.data, defaults),
    [data?.data, defaults]
  )

  if (isLoading) {
    return (
      <div className='text-muted-foreground flex min-h-24 items-center justify-center text-sm'>
        {t('Loading settings...')}
      </div>
    )
  }
  if (isError && !data) {
    return (
      <ErrorState
        title={t('Failed to load settings')}
        onRetry={() => void refetch()}
      />
    )
  }
  return props.render(values)
}

/**
 * The root-only risk control page: usage policy violations and the risk
 * audit, each with its records first and its settings folded below.
 */
export function RiskControl() {
  const { t } = useTranslation()
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const tab: RiskControlTab = search.tab ?? 'violations'

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Risk Control')}</span>
          <Badge variant='outline' className='shrink-0'>
            Root
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <Tabs
            value={tab}
            onValueChange={(value) =>
              navigate({ search: { tab: value as RiskControlTab } })
            }
          >
            <TabsList>
              <TabsTrigger value='violations'>
                {t('Usage policy violations')}
              </TabsTrigger>
              <TabsTrigger value='audit'>{t('Risk audit')}</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'violations' ? (
            <>
              <ViolationRecords />
              <SettingsPanel
                title={t('Settings')}
                defaults={defaultViolationGuard}
                render={(values) => (
                  <ViolationGuardForm defaultValues={values} />
                )}
              />
            </>
          ) : (
            <>
              <RiskGateDashboard />
              <SettingsPanel
                title={t('Settings')}
                defaults={defaultRiskGate}
                render={(values) => <RiskGateForm defaultValues={values} />}
              />
            </>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
