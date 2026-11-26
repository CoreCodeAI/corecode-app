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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getUserContractBonus,
  updateUserContractBonus,
} from '../../contract-bonus-api'
import {
  contractBonusRateToPercent,
  parseContractBonusPercent,
} from '../../lib/contract-bonus'

type UserContractBonusDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: { id: number; username: string }
}

/**
 * Sets the top-up bonus a user was promised outside the site's tiers, such as
 * an enterprise's 10%. The user earns it or the site's tier, whichever is
 * higher, on every top-up, offline payments included; 0 removes it.
 */
export function UserContractBonusDialog(props: UserContractBonusDialogProps) {
  const { t } = useTranslation()
  const current = useQuery({
    queryKey: ['user-contract-bonus', props.user.id],
    queryFn: () => getUserContractBonus(props.user.id),
  })
  const [text, setText] = useState<string | null>(null)
  const shown =
    text ?? (current.data ? contractBonusRateToPercent(current.data.rate) : '')
  const percent = parseContractBonusPercent(shown)

  const save = useMutation({
    mutationFn: (rate: number) => updateUserContractBonus(props.user.id, rate),
    onSuccess: () => {
      toast.success(t('Contract bonus saved'))
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error),
  })

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Contract bonus')}
      description={t(
        "{{username}} earns this bonus or the site's tier for the amount, whichever is higher, on every top-up, offline payments included. The two never add up. 0 removes it.",
        { username: props.user.username }
      )}
    >
      {current.isPending ? (
        <Skeleton className='h-16' />
      ) : (
        <form
          className='flex items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            if (percent !== null) save.mutate(percent / 100)
          }}
        >
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='contract-bonus-percent'>
              {t('Bonus rate (%)')}
            </Label>
            <Input
              id='contract-bonus-percent'
              inputMode='decimal'
              autoComplete='off'
              className='w-32 font-mono'
              value={shown}
              aria-invalid={shown.trim() !== '' && percent === null}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Button type='submit' disabled={percent === null || save.isPending}>
            {save.isPending && <Loader2 className='animate-spin' />}
            {t('Save')}
          </Button>
        </form>
      )}
    </Dialog>
  )
}
