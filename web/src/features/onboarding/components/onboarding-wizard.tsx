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
 * CoreCode fork: the three-step wizard a new customer sees once after sign-up
 * and can reopen from the overview while they have no request: choose the
 * client, get a key and its config, then watch for the first request. It is
 * loaded only when it opens (onboarding-launcher.tsx).
 */
import { Bot, ChevronLeft, Code2, Plug, Terminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ApiKey } from '@/features/keys/types'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { ONBOARDING_CLIENTS, type OnboardingClient } from '../lib/onboarding'
import { OnboardingKeyStep } from './onboarding-key-step'
import { OnboardingWaitStep } from './onboarding-wait-step'

type Step = 'client' | 'key' | 'wait'

const STEPS: Step[] = ['client', 'key', 'wait']

const CLIENT_ICONS: Record<OnboardingClient, ReactNode> = {
  'claude-code': <Terminal className='size-4' aria-hidden />,
  'cc-switch': <Plug className='size-4' aria-hidden />,
  agent: <Bot className='size-4' aria-hidden />,
  openai: <Code2 className='size-4' aria-hidden />,
}

export function OnboardingWizard(props: { onClose: () => void }) {
  const { t } = useTranslation()
  const [step, setStep] = useState<Step>('client')
  const [client, setClient] = useState<OnboardingClient>('claude-code')
  const [createdKeys, setCreatedKeys] = useState<ApiKey[]>([])
  // Fixed when the wizard opens, so the first request is the one after it.
  const [baselineRequests] = useState(() =>
    Number(useAuthStore.getState().auth.user?.request_count ?? 0)
  )

  const clientCopy: Record<OnboardingClient, { title: string; hint: string }> =
    {
      'claude-code': {
        title: 'Claude Code',
        hint: t('The CLI, the VS Code extension and the JetBrains plugin'),
      },
      'cc-switch': {
        title: t('CC Switch'),
        hint: t('Import the provider with one click'),
      },
      agent: {
        title: t('Let my AI agent set it up'),
        hint: t('Paste one prompt into Claude Code, Codex or Cursor'),
      },
      openai: {
        title: t('OpenAI-compatible client'),
        hint: t('Cursor, Cherry Studio and other tools that take a base URL'),
      },
    }
  const stepTitles: Record<Step, string> = {
    client: t('Choose your client'),
    key: t('Your key and config'),
    wait: t('Waiting for your first request'),
  }
  const stepIndex = STEPS.indexOf(step)

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <p className='text-muted-foreground text-xs'>
            {t('Step {{current}} of {{total}}', {
              current: stepIndex + 1,
              total: STEPS.length,
            })}
          </p>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            {step === 'client' &&
              t('Pick the tool you will use. You can change it later.')}
            {step === 'key' && clientCopy[client].title}
            {step === 'wait' &&
              t('Send a request from your tool and this turns green.')}
          </DialogDescription>
          <div className='flex gap-1.5' aria-hidden>
            {STEPS.map((item, index) => (
              <span
                key={item}
                className={cn(
                  'h-1 flex-1 rounded-full',
                  index <= stepIndex ? 'bg-primary' : 'bg-muted'
                )}
              />
            ))}
          </div>
        </DialogHeader>

        {step === 'client' && (
          <div className='grid gap-2' role='group' aria-label={t('Client')}>
            {ONBOARDING_CLIENTS.map((item) => (
              <button
                key={item}
                type='button'
                onClick={() => {
                  setClient(item)
                  setStep('key')
                }}
                className='hover:bg-muted/60 focus-visible:ring-ring/50 flex items-start gap-3 rounded-xl border px-3.5 py-3 text-start outline-none focus-visible:ring-3'
              >
                <span className='bg-muted mt-0.5 rounded-md p-1.5'>
                  {CLIENT_ICONS[item]}
                </span>
                <span className='flex flex-col gap-0.5'>
                  <span className='text-sm font-medium'>
                    {clientCopy[item].title}
                  </span>
                  <span className='text-muted-foreground text-xs'>
                    {clientCopy[item].hint}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {step === 'key' && (
          <OnboardingKeyStep
            client={client}
            createdKeys={createdKeys}
            onCreated={(key) => setCreatedKeys((keys) => [...keys, key])}
          />
        )}
        {step === 'wait' && (
          <OnboardingWaitStep
            client={client}
            baselineRequests={baselineRequests}
          />
        )}

        <DialogFooter className='sm:justify-between'>
          {step === 'client' ? (
            <Button variant='ghost' onClick={props.onClose}>
              {t('Not now')}
            </Button>
          ) : (
            <Button
              variant='ghost'
              onClick={() => setStep(STEPS[stepIndex - 1])}
            >
              <ChevronLeft data-icon='inline-start' />
              {t('Back')}
            </Button>
          )}
          {step === 'key' && (
            <Button onClick={() => setStep('wait')}>
              {t("I've pasted it — next")}
            </Button>
          )}
          {step === 'wait' && (
            <Button variant='outline' onClick={props.onClose}>
              {t('Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
