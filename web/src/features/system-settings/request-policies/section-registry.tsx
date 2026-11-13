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
import { createSectionRegistry, lazySection } from '../utils/section-registry'
import type { RequestPolicySettings } from './defaults'

const ChannelHealthSection = lazySection(() =>
  import('./channel-health-section').then((m) => m.ChannelHealthSection)
)

const ClaudeCodeClientsSection = lazySection(() =>
  import('./claude-code-clients-section').then(
    (m) => m.ClaudeCodeClientsSection
  )
)

const RoutingPolicySection = lazySection(() =>
  import('./routing-section').then((m) => m.RoutingPolicySection)
)

const POLICY_SECTIONS = [
  {
    id: 'clients',
    titleKey: 'Claude Code clients',
    build: (settings: RequestPolicySettings) => (
      <ClaudeCodeClientsSection
        defaultValues={{
          'claude_code_client_setting.groups':
            settings['claude_code_client_setting.groups'],
          'claude_code_client_setting.min_version':
            settings['claude_code_client_setting.min_version'],
          'claude_code_client_setting.max_version':
            settings['claude_code_client_setting.max_version'],
        }}
      />
    ),
  },
  {
    id: 'routing',
    titleKey: 'Sessions and retries',
    build: () => <RoutingPolicySection />,
  },
  {
    id: 'health',
    titleKey: 'Channel health',
    build: (settings: RequestPolicySettings) => (
      <ChannelHealthSection defaultValues={settings} />
    ),
  },
] as const

export type PolicySectionId = (typeof POLICY_SECTIONS)[number]['id']
const registry = createSectionRegistry<PolicySectionId, RequestPolicySettings>({
  sections: POLICY_SECTIONS,
  defaultSection: 'routing',
  basePath: '/system-settings/request-policies',
  urlStyle: 'path',
})
export const POLICY_SECTION_IDS = registry.sectionIds
export const getPolicySectionNavItems = registry.getSectionNavItems
export const getPolicySectionContent = registry.getSectionContent
export const getPolicySectionMeta = registry.getSectionMeta
