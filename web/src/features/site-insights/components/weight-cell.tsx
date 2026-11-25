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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import { saveCredentialWeight } from '../api'
import { DEFAULT_WEIGHT, WEIGHT_PRESETS, weightLabel } from '../pool-sort'
import type { EngineAccount } from '../types'

/**
 * Sets how many times its quota's share of new conversations an account
 * takes, saved in corecode-engine as the account's manual weight. The default
 * clears the weight rather than storing 50, so the account follows the
 * engine's default. A weight set elsewhere that is not a preset stays listed.
 */
export function WeightCell(props: { row: EngineAccount }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (weight: number) =>
      saveCredentialWeight({
        groupId: props.row.group_id,
        credentialId: props.row.credential_id,
        weight: weight === DEFAULT_WEIGHT ? null : weight,
      }),
    onSuccess: (_, weight) => {
      toast.success(
        t('Account #{{id}} now takes {{factor}} new conversations', {
          id: props.row.credential_id,
          factor: weightLabel(weight),
        })
      )
      queryClient.invalidateQueries({ queryKey: ['site-insights', 'pool'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    },
  })
  const weight = props.row.weight
  if (weight == null) {
    return <span className='text-muted-foreground'>-</span>
  }
  const shown = save.isPending ? (save.variables ?? weight) : weight
  const weights = [...new Set<number>([...WEIGHT_PRESETS, shown])].sort(
    (a, b) => a - b
  )
  const items = weights.map((value) => ({
    value: String(value),
    label:
      value === DEFAULT_WEIGHT
        ? t('{{factor}} (default)', { factor: weightLabel(value) })
        : weightLabel(value),
  }))
  return (
    <Select
      items={items}
      value={String(shown)}
      disabled={save.isPending}
      onValueChange={(value) => {
        if (value === null || Number(value) === weight) return
        save.mutate(Number(value))
      }}
    >
      <SelectTrigger
        size='sm'
        className={cn(
          'ml-auto h-7 w-20 text-xs tabular-nums',
          shown !== DEFAULT_WEIGHT && 'text-foreground font-medium',
          shown === DEFAULT_WEIGHT && 'text-muted-foreground'
        )}
        aria-label={t('Schedule weight of account #{{id}}', {
          id: props.row.credential_id,
        })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
