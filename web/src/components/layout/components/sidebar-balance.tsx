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
/**
 * CoreCode fork: the balance stays in view on every console page, so a
 * customer notices a low balance before Claude Code starts failing with 403.
 */
import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useBalanceStatus } from '@/features/dashboard/hooks/use-balance-status'
import { useDailySpend } from '@/features/dashboard/hooks/use-customer-overview'
import { useSelf } from '@/hooks/use-self'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export function SidebarBalance() {
  const user = useAuthStore((state) => state.auth.user)
  // Keeps the balance following the server on every page.
  useSelf()
  if (!user) return null
  return <SidebarBalanceButton balance={Number(user.quota ?? 0)} />
}

/** Warns before the balance runs out, not only once it has. */
function SidebarBalanceButton(props: { balance: number }) {
  const { t } = useTranslation()
  const spend = useDailySpend()
  const status = useBalanceStatus(props.balance, spend.daily)
  const amount = formatQuota(status.available)
  const warn = status.health !== 'healthy'
  const label = warn
    ? `${t('Balance')} ${amount}, ${status.label}`
    : `${t('Balance')} ${amount}`

  return (
    <SidebarFooter className='border-sidebar-border/70 border-t'>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size='lg'
            tooltip={label}
            aria-label={label}
            render={<Link to='/wallet' />}
          >
            <span
              className={cn(
                'bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-lg',
                status.health === 'low' && 'bg-warning/15 text-warning',
                status.health === 'empty' &&
                  'bg-destructive/10 text-destructive'
              )}
            >
              <Wallet className='size-4' aria-hidden />
            </span>
            <span className='flex min-w-0 flex-col leading-tight'>
              <span
                className={cn(
                  'text-sidebar-foreground/60 text-xs',
                  status.health === 'low' && 'text-warning',
                  status.health === 'empty' && 'text-destructive'
                )}
              >
                {warn ? status.label : t('Balance')}
              </span>
              <span
                className={cn(
                  'truncate text-sm font-semibold tabular-nums',
                  status.health === 'empty' && 'text-destructive'
                )}
              >
                {amount}
              </span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
