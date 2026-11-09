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
/**
 * CoreCode fork: what a customer who has not sent a request yet should do, in
 * order. It replaces the "balance has run out" alert for them: a zero balance
 * is where everyone starts, not a warning.
 */
import { Link } from '@tanstack/react-router'
import { ArrowRight, Check, Circle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import {
  SETUP_SECTION_ID,
  type FirstRunStep,
  type FirstRunStepId,
} from '../../lib/first-run'

function scrollToSetup() {
  document
    .querySelector(`#${SETUP_SECTION_ID}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function FirstRunChecklist(props: {
  steps: FirstRunStep[]
  loading?: boolean
}) {
  const { t } = useTranslation()
  const doneCount = props.steps.filter((step) => step.done).length

  const copy: Record<
    FirstRunStepId,
    { title: string; hint: string; cta: ReactNode }
  > = {
    balance: {
      title: t('Add credits or redeem a code'),
      hint: t('Requests are charged to your balance.'),
      cta: (
        <Button size='sm' render={<Link to='/wallet' />}>
          {t('Add credits')}
          <ArrowRight data-icon='inline-end' />
        </Button>
      ),
    },
    key: {
      title: t('Create an API key'),
      hint: t('One click in the setup panel below creates one for you.'),
      cta: (
        <Button size='sm' variant='outline' onClick={scrollToSetup}>
          {t('Create API Key')}
        </Button>
      ),
    },
    config: {
      title: t('Paste the config into Claude Code'),
      hint: t('Copy it from the setup panel below, with your key filled in.'),
      cta: (
        <Button size='sm' variant='outline' onClick={scrollToSetup}>
          {t('Go to setup')}
        </Button>
      ),
    },
    verify: {
      title: t('Run the check command'),
      hint: t(
        'Run it in a new terminal. This list goes away after your first request.'
      ),
      cta: (
        <Button size='sm' variant='outline' onClick={scrollToSetup}>
          {t('Show the command')}
        </Button>
      ),
    },
  }

  return (
    <section
      aria-labelledby='first-run-title'
      className='bg-primary/5 border-primary/20 min-w-0 rounded-2xl border p-4 sm:p-5'
    >
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <h2 id='first-run-title' className='text-lg leading-tight'>
          {t('Get started in four steps')}
        </h2>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {t('{{done}} of {{total}} done', {
            done: doneCount,
            total: props.steps.length,
          })}
        </span>
      </div>
      <ol className='mt-3 flex flex-col gap-2'>
        {props.steps.map((step, index) => (
          <li
            key={step.id}
            data-step={step.id}
            data-done={step.done}
            className='bg-card flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5'
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border',
                step.done
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'text-muted-foreground'
              )}
            >
              {step.done ? (
                <Check className='size-3.5' aria-hidden />
              ) : (
                <Circle className='size-3 opacity-0' aria-hidden />
              )}
              <span className='sr-only'>
                {step.done ? t('Done') : t('Not done yet')}
              </span>
            </span>
            <div className='min-w-0 flex-1 basis-48'>
              <p
                className={cn(
                  'text-sm font-medium',
                  step.done && 'text-muted-foreground line-through'
                )}
              >
                {index + 1}. {copy[step.id].title}
              </p>
              <p className='text-muted-foreground text-xs'>
                {copy[step.id].hint}
              </p>
            </div>
            {!step.done && !props.loading && copy[step.id].cta}
          </li>
        ))}
      </ol>
    </section>
  )
}
