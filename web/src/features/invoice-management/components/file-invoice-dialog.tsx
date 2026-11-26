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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  createInvoiceAdmin,
  getInvoiceConfig,
  getInvoiceOrdersAdmin,
} from '@/features/invoice/api'
import { InvoiceForm } from '@/features/invoice/components/invoice-form'
import { InvoiceableOrders } from '@/features/invoice/components/invoiceable-orders'
import { INVOICE_KEY } from '@/features/invoice/constants'
import { orderKey } from '@/features/invoice/lib/order-key'
import {
  toggleSelection,
  visibleSelection,
} from '@/features/invoice/lib/selection'
import type {
  InvoiceUserOrders,
  InvoiceableOrder,
} from '@/features/invoice/types'
import { handleServerError } from '@/lib/handle-server-error'

/**
 * An administrator files an application for a customer who cannot apply in
 * the console: find the account, pick its orders and fill in the title. The
 * tax is deducted from the customer's balance, or, for a transfer that
 * included it, recorded as collected offline.
 */
export function FileInvoiceDialog(props: { onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [userIdText, setUserIdText] = useState('')
  const [loading, setLoading] = useState(false)
  const [account, setAccount] = useState<InvoiceUserOrders | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [taxFromBalance, setTaxFromBalance] = useState(true)
  const config = useQuery({
    queryKey: [...INVOICE_KEY, 'config'],
    queryFn: getInvoiceConfig,
  })

  const orders = account?.orders ?? []
  const chosenKeys = visibleSelection(orders, selected)
  const chosen = orders.filter((order) => chosenKeys.has(orderKey(order)))
  const maxOrders = config.data?.max_orders ?? 0

  async function findAccount() {
    const userId = Number(userIdText.trim())
    if (!Number.isInteger(userId) || userId <= 0) {
      toast.error(t('Enter a user ID'))
      return
    }
    setLoading(true)
    try {
      setAccount(await getInvoiceOrdersAdmin(userId))
      setSelected(new Set())
    } catch (error) {
      setAccount(null)
      handleServerError(error, t('Failed to load'))
    } finally {
      setLoading(false)
    }
  }

  function toggle(order: InvoiceableOrder, checked: boolean) {
    setSelected(toggleSelection(chosenKeys, order, checked, maxOrders))
  }

  function toggleAll(checked: boolean) {
    setSelected(
      checked ? new Set(orders.slice(0, maxOrders).map(orderKey)) : new Set()
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      title={t('File an application for a user')}
      description={t('For a customer who cannot apply in the console.')}
      contentClassName='sm:max-w-5xl'
    >
      <form
        className='flex flex-wrap items-end gap-2'
        onSubmit={(event) => {
          event.preventDefault()
          void findAccount()
        }}
      >
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='invoice-user-id'>{t('User ID')}</Label>
          <Input
            id='invoice-user-id'
            inputMode='numeric'
            autoComplete='off'
            className='w-40 font-mono'
            value={userIdText}
            onChange={(event) => setUserIdText(event.target.value)}
          />
        </div>
        <Button type='submit' variant='outline' disabled={loading}>
          {loading ? (
            <Loader2 className='animate-spin' aria-hidden='true' />
          ) : (
            <Search aria-hidden='true' />
          )}
          {t('Find')}
        </Button>
        {account && (
          <p className='text-muted-foreground pb-2 text-sm'>
            #{account.user.id} {account.user.username}
            {account.user.email ? ` · ${account.user.email}` : ''}
          </p>
        )}
      </form>
      <div className='flex items-start gap-3 rounded-lg border p-3'>
        <Switch
          id='invoice-tax-from-balance'
          checked={taxFromBalance}
          onCheckedChange={setTaxFromBalance}
        />
        <div className='grid gap-1'>
          <Label htmlFor='invoice-tax-from-balance'>
            {t("Deduct the tax from the user's balance")}
          </Label>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Turn it off only when the customer paid the tax with the transfer: it is then recorded as collected offline and nothing is deducted.'
            )}
          </p>
        </div>
      </div>
      {config.isPending && <Skeleton className='h-60' />}
      {account && config.data && (
        <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:items-start'>
          <InvoiceableOrders
            orders={orders}
            loading={false}
            selected={chosenKeys}
            maxOrders={maxOrders}
            orderDays={config.data.order_days}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
          <InvoiceForm
            key={account.user.id}
            config={config.data}
            orders={chosen}
            defaultEmail={account.user.email}
            balance={0}
            filingTaxFromBalance={taxFromBalance}
            onFile={(submission) =>
              createInvoiceAdmin({
                ...submission,
                user_id: account.user.id,
                tax_from_balance: taxFromBalance,
              })
            }
            onSubmitted={() => {
              void queryClient.invalidateQueries({ queryKey: INVOICE_KEY })
              props.onClose()
            }}
          />
        </div>
      )}
    </Dialog>
  )
}
