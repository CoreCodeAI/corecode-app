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
import type { SecuritySettings } from '../types'
import { createSectionRegistry, lazySection } from '../utils/section-registry'

const RateLimitSection = lazySection(() =>
  import('../request-limits/rate-limit-section').then((m) => m.RateLimitSection)
)

const SSRFSection = lazySection(() =>
  import('../request-limits/ssrf-section').then((m) => m.SSRFSection)
)

const TokenLimitSection = lazySection(() =>
  import('../request-limits/token-limit-section').then(
    (m) => m.TokenLimitSection
  )
)

const ViolationGuardSection = lazySection(() =>
  import('../violation-guard/violation-guard-section').then(
    (m) => m.ViolationGuardSection
  )
)

const RiskGateSection = lazySection(() =>
  import('../risk-gate/risk-gate-section').then((m) => m.RiskGateSection)
)

const SECURITY_SECTIONS = [
  {
    id: 'rate-limit',
    titleKey: 'Rate Limiting',
    build: (settings: SecuritySettings) => (
      <RateLimitSection
        defaultValues={{
          ModelRequestRateLimitEnabled: settings.ModelRequestRateLimitEnabled,
          ModelRequestRateLimitCount: settings.ModelRequestRateLimitCount,
          ModelRequestRateLimitSuccessCount:
            settings.ModelRequestRateLimitSuccessCount,
          ModelRequestRateLimitDurationMinutes:
            settings.ModelRequestRateLimitDurationMinutes,
          ModelRequestRateLimitGroup: settings.ModelRequestRateLimitGroup,
        }}
      />
    ),
  },

  {
    id: 'ssrf',
    titleKey: 'SSRF Protection',
    build: (settings: SecuritySettings) => (
      <SSRFSection
        defaultValues={{
          'fetch_setting.enable_ssrf_protection':
            settings['fetch_setting.enable_ssrf_protection'],
          'fetch_setting.allow_private_ip':
            settings['fetch_setting.allow_private_ip'],
          'fetch_setting.domain_filter_mode':
            settings['fetch_setting.domain_filter_mode'],
          'fetch_setting.ip_filter_mode':
            settings['fetch_setting.ip_filter_mode'],
          'fetch_setting.domain_list': settings['fetch_setting.domain_list'],
          'fetch_setting.ip_list': settings['fetch_setting.ip_list'],
          'fetch_setting.allowed_ports':
            settings['fetch_setting.allowed_ports'],
          'fetch_setting.apply_ip_filter_for_domain':
            settings['fetch_setting.apply_ip_filter_for_domain'],
        }}
      />
    ),
  },
  {
    id: 'token-limits',
    titleKey: 'Token Limits',
    build: (settings: SecuritySettings) => (
      <TokenLimitSection
        defaultValues={{
          'token_setting.max_user_tokens':
            settings['token_setting.max_user_tokens'],
          'token_setting.concurrency_limits':
            settings['token_setting.concurrency_limits'],
        }}
      />
    ),
  },
  {
    id: 'violation-guard',
    titleKey: 'Usage policy violations',
    build: (settings: SecuritySettings) => (
      <ViolationGuardSection
        defaultValues={{
          'violation_guard_setting.enabled':
            settings['violation_guard_setting.enabled'],
          'violation_guard_setting.mode':
            settings['violation_guard_setting.mode'],
          'violation_guard_setting.suspend_hours':
            settings['violation_guard_setting.suspend_hours'],
          'violation_guard_setting.ban_strikes':
            settings['violation_guard_setting.ban_strikes'],
          'violation_guard_setting.strike_window_days':
            settings['violation_guard_setting.strike_window_days'],
          'violation_guard_setting.lenient_categories':
            settings['violation_guard_setting.lenient_categories'],
          'violation_guard_setting.client_check_limit':
            settings['violation_guard_setting.client_check_limit'],
        }}
      />
    ),
  },
  {
    id: 'risk-gate',
    titleKey: 'Risk audit',
    build: (settings: SecuritySettings) => (
      <RiskGateSection
        defaultValues={{
          'risk_gate_setting.enabled': settings['risk_gate_setting.enabled'],
          'risk_gate_setting.mode': settings['risk_gate_setting.mode'],
          'risk_gate_setting.distill_enabled':
            settings['risk_gate_setting.distill_enabled'],
          'risk_gate_setting.distill_rules':
            settings['risk_gate_setting.distill_rules'],
          'risk_gate_setting.distill_strike':
            settings['risk_gate_setting.distill_strike'],
          'risk_gate_setting.hard_regex_enabled':
            settings['risk_gate_setting.hard_regex_enabled'],
          'risk_gate_setting.hard_regex_rules':
            settings['risk_gate_setting.hard_regex_rules'],
          'risk_gate_setting.hard_regex_strike':
            settings['risk_gate_setting.hard_regex_strike'],
          'risk_gate_setting.similarity_enabled':
            settings['risk_gate_setting.similarity_enabled'],
          'risk_gate_setting.similarity_threshold':
            settings['risk_gate_setting.similarity_threshold'],
          'risk_gate_setting.decision_enabled':
            settings['risk_gate_setting.decision_enabled'],
          'risk_gate_setting.decision_base_url':
            settings['risk_gate_setting.decision_base_url'],
          'risk_gate_setting.decision_api_key':
            settings['risk_gate_setting.decision_api_key'],
          'risk_gate_setting.decision_model':
            settings['risk_gate_setting.decision_model'],
          'risk_gate_setting.decision_questions':
            settings['risk_gate_setting.decision_questions'],
          'risk_gate_setting.decision_threshold':
            settings['risk_gate_setting.decision_threshold'],
          'risk_gate_setting.decision_timeout_ms':
            settings['risk_gate_setting.decision_timeout_ms'],
          'risk_gate_setting.decision_fail_open':
            settings['risk_gate_setting.decision_fail_open'],
          'risk_gate_setting.decision_strike':
            settings['risk_gate_setting.decision_strike'],
          'risk_gate_setting.decision_skip_official':
            settings['risk_gate_setting.decision_skip_official'],
        }}
      />
    ),
  },
] as const

export type SecuritySectionId = (typeof SECURITY_SECTIONS)[number]['id']

const securityRegistry = createSectionRegistry<
  SecuritySectionId,
  SecuritySettings
>({
  sections: SECURITY_SECTIONS,
  defaultSection: 'rate-limit',
  basePath: '/system-settings/security',
  urlStyle: 'path',
})

export const SECURITY_SECTION_IDS = securityRegistry.sectionIds
export const SECURITY_DEFAULT_SECTION = securityRegistry.defaultSection
export const getSecuritySectionNavItems = securityRegistry.getSectionNavItems
export const getSecuritySectionContent = securityRegistry.getSectionContent
export const getSecuritySectionMeta = securityRegistry.getSectionMeta
