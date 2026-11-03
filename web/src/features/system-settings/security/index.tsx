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
import { SettingsPage } from '../components/settings-page'
import type { SecuritySettings } from '../types'
import {
  SECURITY_DEFAULT_SECTION,
  getSecuritySectionContent,
  getSecuritySectionMeta,
} from './section-registry.tsx'

const defaultSecuritySettings: SecuritySettings = {
  ModelRequestRateLimitEnabled: false,
  ModelRequestRateLimitCount: 0,
  ModelRequestRateLimitSuccessCount: 1000,
  ModelRequestRateLimitDurationMinutes: 1,
  ModelRequestRateLimitGroup: '',
  CheckSensitiveEnabled: false,
  CheckSensitiveOnPromptEnabled: false,
  SensitiveWords: '',
  'fetch_setting.enable_ssrf_protection': true,
  'fetch_setting.allow_private_ip': false,
  'fetch_setting.domain_filter_mode': false,
  'fetch_setting.ip_filter_mode': false,
  'fetch_setting.domain_list': [],
  'fetch_setting.ip_list': [],
  'fetch_setting.allowed_ports': [],
  'fetch_setting.apply_ip_filter_for_domain': false,
  'token_setting.max_user_tokens': 1000,
  'token_setting.concurrency_limits': '{}',
  'violation_guard_setting.enabled': false,
  'violation_guard_setting.mode': 'observe',
  'violation_guard_setting.suspend_hours': 24,
  'violation_guard_setting.ban_strikes': 2,
  'violation_guard_setting.strike_window_days': 30,
  'violation_guard_setting.lenient_categories': 'reasoning_extraction',
  'violation_guard_setting.client_check_limit': 5,
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

export function SecuritySettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/security/$section'
      defaultSettings={defaultSecuritySettings}
      defaultSection={SECURITY_DEFAULT_SECTION}
      getSectionContent={getSecuritySectionContent}
      getSectionMeta={getSecuritySectionMeta}
    />
  )
}
