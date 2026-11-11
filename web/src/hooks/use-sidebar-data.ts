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
import {
  Activity,
  Box,
  Building2,
  ClipboardList,
  CreditCard,
  FileCheck,
  FileText,
  FlaskConical,
  HandCoins,
  HeartPulse,
  Key,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  MessageSquare,
  MessageSquareText,
  Palette,
  PlugZap,
  Radio,
  Receipt,
  ReceiptText,
  ServerCog,
  ChartNoAxesCombined,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  User,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SidebarBadges, SidebarData } from '@/components/layout/types'
import { useFeedbackUnreadCount } from '@/features/feedback/hooks/use-feedback-unread'
import { useInvoiceReviewCount } from '@/features/invoice/hooks/use-invoice-review-count'
import { useStatus } from '@/hooks/use-status'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(badges: SidebarBadges = {}): SidebarData {
  const { t } = useTranslation()
  const unreadFeedback = useFeedbackUnreadCount()
  const invoiceReviews = useInvoiceReviewCount()
  const { status } = useStatus()
  const role = useAuthStore((s) => s.auth.user?.role)
  // Customers get a plainer name; "Dashboard" sits beside "Overview" for them.
  const isCustomer = (role ?? ROLE.GUEST) < ROLE.ADMIN

  return {
    navGroups: [
      {
        id: 'general',
        title: t('General'),
        items: [
          {
            title: t('Overview'),
            url: '/dashboard/overview',
            icon: Activity,
          },
          {
            title: isCustomer ? t('Usage analytics') : t('Dashboard'),
            url: '/dashboard/models',
            icon: LayoutDashboard,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
          {
            title: t('Audit Logs'),
            url: '/usage-logs/audit',
            icon: ClipboardList,
          },
          {
            title: t('Task Logs'),
            url: '/usage-logs/task',
            activeUrls: ['/usage-logs/drawing'],
            configUrls: ['/usage-logs/drawing', '/usage-logs/task'],
            icon: ListTodo,
          },
          {
            title: t('Service Status'),
            url: '/service-status',
            icon: HeartPulse,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Wallet'),
            url: '/wallet',
            icon: Wallet,
          },
          // Shown once an administrator turns invoicing on.
          ...(status?.invoice_enabled === true
            ? [
                {
                  title: t('Invoice center'),
                  url: '/invoice',
                  icon: ReceiptText,
                },
              ]
            : []),
          {
            title: t('Invitations'),
            url: '/invitations',
            icon: UserPlus,
          },
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
          {
            title: t('Security & Access'),
            url: '/security',
            icon: ShieldCheck,
          },
          {
            title: t('Feedback'),
            url: '/feedback',
            icon: LifeBuoy,
            badge: unreadFeedback > 0 ? String(unreadFeedback) : undefined,
          },
        ],
      },
      {
        id: 'chat',
        title: t('Chat'),
        items: [
          {
            title: t('Playground'),
            url: '/playground',
            icon: FlaskConical,
          },
          {
            title: t('Creation Studio'),
            icon: Palette,
            type: 'canvas-studio',
          },
          {
            title: t('Chat'),
            icon: MessageSquare,
            type: 'chat-presets',
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Site Insights'),
            url: '/site-insights',
            icon: ChartNoAxesCombined,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Risk Control'),
            url: '/risk-control',
            icon: ShieldAlert,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Feedback Review'),
            url: '/feedback-admin',
            icon: MessageSquareText,
          },
          {
            title: t('Enterprise Applications'),
            url: '/enterprise-applications',
            icon: Building2,
          },
          {
            title: t('Top-up Records'),
            url: '/topups',
            icon: Receipt,
          },
          {
            title: t('Invoice management'),
            url: '/invoice-management',
            icon: FileCheck,
            badge: invoiceReviews > 0 ? String(invoiceReviews) : undefined,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Invitation program'),
            url: '/affiliates',
            icon: HandCoins,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Subscriptions'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('System Info'),
            url: '/system-info',
            icon: ServerCog,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('Task Plugins'),
            url: '/task-plugins',
            icon: PlugZap,
            requiredRole: ROLE.SUPER_ADMIN,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            requiredRole: ROLE.SUPER_ADMIN,
            // Model pricing lives in System Settings.
            badge: badges.modelPricing,
          },
        ],
      },
    ],
  }
}
