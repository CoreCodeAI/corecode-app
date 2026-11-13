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
 * CoreCode fork: the IQ test dialog. It sends one fixed question to a chosen
 * model with this key, through /v1, so the customer pays the key's group
 * price and the call shows in their logs. The keys page loads it on demand.
 */
import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { groupText } from '@/lib/group-text'

import {
  IQ_QUESTIONS,
  extractFinalAnswer,
  extractHtml,
  iqTestModels,
  runIqTest,
  type IqQuestionId,
  type IqStreamUsage,
} from '../../lib/iq-test'
import { useSetupClients } from '../../lib/use-setup-clients'
import type { ApiKey } from '../../types'
import { useApiKeys } from '../api-keys-provider'

type Phase = 'idle' | 'running' | 'done' | 'stopped' | 'error'

type Props = {
  apiKey: ApiKey
  onOpenChange: (open: boolean) => void
}

export function IqTestDialog(props: Props) {
  const { t } = useTranslation()
  const { resolveRealKey } = useApiKeys()
  const { models: groupModels } = useSetupClients(props.apiKey)
  const [questionId, setQuestionId] = useState<IqQuestionId>(IQ_QUESTIONS[0].id)
  const [model, setModel] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [content, setContent] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [usage, setUsage] = useState<IqStreamUsage | null>(null)
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const startedAtRef = useRef(0)

  const question =
    IQ_QUESTIONS.find((item) => item.id === questionId) ?? IQ_QUESTIONS[0]
  const running = phase === 'running'

  const modelOptions = useMemo(
    () =>
      iqTestModels(groupModels, props.apiKey).map((value) => ({
        value,
        label: value,
      })),
    [groupModels, props.apiKey]
  )

  // A closed dialog stops its request.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [running])

  const start = async () => {
    if (!model || running) return
    const realKey = await resolveRealKey(props.apiKey.id)
    if (!realKey) return
    const controller = new AbortController()
    abortRef.current = controller
    setContent('')
    setReasoning('')
    setUsage(null)
    setError('')
    setElapsed(0)
    startedAtRef.current = Date.now()
    setPhase('running')
    try {
      await runIqTest({
        apiKey: realKey,
        model,
        question,
        signal: controller.signal,
        handlers: {
          onContent: (delta) => setContent((prev) => prev + delta),
          onReasoning: (delta) => setReasoning((prev) => prev + delta),
          onUsage: setUsage,
        },
      })
      setPhase('done')
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase('stopped')
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000))
    }
  }

  const stop = () => abortRef.current?.abort()

  const selectQuestion = (value: string) => {
    if (running) return
    setQuestionId(value as IqQuestionId)
    setPhase('idle')
    setContent('')
    setReasoning('')
    setUsage(null)
    setError('')
  }

  const groupLabel = props.apiKey.group
    ? groupText(t, props.apiKey.group)
    : t('Account default group')
  let startLabel = t('Start test')
  if (phase !== 'idle') startLabel = t('Test again')

  return (
    <Dialog
      open
      onOpenChange={props.onOpenChange}
      title={t('IQ test')}
      description={t(
        'Sends one fixed question to the chosen model with this key. It is charged to your own balance at the price of the key’s group.'
      )}
      contentClassName='sm:max-w-2xl'
      contentHeight='auto'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Close')}
          </Button>
          {running ? (
            <Button variant='destructive' onClick={stop}>
              {t('Stop')}
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={!model}>
              {startLabel}
            </Button>
          )}
        </>
      }
    >
      <div className='space-y-5'>
        <div className='space-y-1'>
          <Label>{t('API Key')}</Label>
          <div className='text-sm font-medium'>{props.apiKey.name}</div>
          <p className='text-muted-foreground text-xs'>
            {t('Group: {{group}} · billed at this group’s price', {
              group: groupLabel,
            })}
          </p>
        </div>

        <div className='space-y-2'>
          <Label>{t('Question')}</Label>
          <RadioGroup
            value={questionId}
            onValueChange={selectQuestion}
            className='flex flex-wrap gap-x-6 gap-y-2'
          >
            {IQ_QUESTIONS.map((item) => (
              <div key={item.id} className='flex items-center gap-2'>
                <RadioGroupItem
                  value={item.id}
                  id={`iq-question-${item.id}`}
                  disabled={running}
                />
                <Label
                  htmlFor={`iq-question-${item.id}`}
                  className='cursor-pointer font-normal'
                >
                  {t(item.labelKey)}
                </Label>
              </div>
            ))}
          </RadioGroup>
          <div className='bg-muted/50 max-h-48 overflow-y-auto rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap'>
            {question.prompt}
          </div>
          <p className='text-muted-foreground text-xs'>
            {t('At most {{tokens}} output tokens', {
              tokens: question.maxTokens,
            })}
          </p>
        </div>

        <div className='space-y-2'>
          <Label htmlFor='iq-test-model' required>
            {t('Model')}
          </Label>
          <Combobox
            id='iq-test-model'
            aria-label={t('Model')}
            options={modelOptions}
            value={model}
            onValueChange={(value) => setModel(value ?? '')}
            placeholder={t('Search models')}
            emptyText={t('No models found')}
          />
        </div>

        {phase !== 'idle' && (
          <IqTestResult
            phase={phase}
            kind={question.kind}
            expectedAnswer={question.expectedAnswer}
            content={content}
            reasoning={reasoning}
            usage={usage}
            error={error}
            elapsed={elapsed}
          />
        )}
      </div>
    </Dialog>
  )
}

function IqTestResult(props: {
  phase: Exclude<Phase, 'idle'>
  kind: 'html' | 'answer'
  expectedAnswer?: number
  content: string
  reasoning: string
  usage: IqStreamUsage | null
  error: string
  elapsed: number
}) {
  const { t } = useTranslation()
  const outputRef = useRef<HTMLPreElement>(null)
  const running = props.phase === 'running'

  // Keep the newest output in view while it streams.
  useEffect(() => {
    if (running && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [running, props.content, props.reasoning])

  let status = t('Generating… {{seconds}}s', { seconds: props.elapsed })
  if (props.phase === 'done') {
    status = t('Finished in {{seconds}}s', { seconds: props.elapsed })
  } else if (props.phase === 'stopped') {
    status = t('Stopped after {{seconds}}s', { seconds: props.elapsed })
  } else if (props.phase === 'error') {
    status = t('Failed')
  }
  const tokens = props.usage
    ? t('Input {{input}} · output {{output}} tokens', {
        input: props.usage.prompt_tokens ?? 0,
        output: props.usage.completion_tokens ?? 0,
      })
    : ''

  const html =
    props.kind === 'html' && props.phase === 'done'
      ? extractHtml(props.content)
      : null

  return (
    <div className='space-y-3 border-t pt-4'>
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
        <span className='flex items-center gap-1.5 font-medium'>
          {running && <Loader2 className='size-4 animate-spin' />}
          {status}
        </span>
        {tokens && <span className='text-muted-foreground'>{tokens}</span>}
      </div>

      {props.phase === 'error' && (
        <p className='text-destructive text-sm break-words'>{props.error}</p>
      )}

      {props.reasoning && (
        <details className='text-sm'>
          <summary className='text-muted-foreground cursor-pointer'>
            {t('Reasoning')}
          </summary>
          <pre className='bg-muted/50 text-muted-foreground mt-2 max-h-48 overflow-y-auto rounded-lg p-3 text-xs whitespace-pre-wrap'>
            {props.reasoning}
          </pre>
        </details>
      )}

      {props.kind === 'answer' && props.phase === 'done' && (
        <AnswerVerdict
          answer={extractFinalAnswer(props.content)}
          expected={props.expectedAnswer}
        />
      )}

      {html ? (
        <HtmlResult html={html} />
      ) : (
        props.content && (
          <pre
            ref={outputRef}
            className='bg-muted/50 max-h-80 overflow-y-auto rounded-lg p-3 font-sans text-sm whitespace-pre-wrap'
          >
            {props.content}
          </pre>
        )
      )}

      {props.kind === 'html' && props.phase === 'done' && !html && (
        <p className='text-muted-foreground text-sm'>
          {t('The answer contains no HTML to preview.')}
        </p>
      )}
    </div>
  )
}

function AnswerVerdict(props: { answer: number | null; expected?: number }) {
  const { t } = useTranslation()
  if (props.answer === null) {
    return (
      <p className='text-sm text-amber-600 dark:text-amber-400'>
        {t('No final answer line found.')}
      </p>
    )
  }
  const correct = props.answer === props.expected
  return (
    <div
      className={
        correct
          ? 'flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400'
          : 'text-destructive flex items-center gap-2 text-sm font-medium'
      }
    >
      {correct ? (
        <CheckCircle2 className='size-4' />
      ) : (
        <XCircle className='size-4' />
      )}
      {correct
        ? t('Final answer {{answer}}: correct', { answer: props.answer })
        : t(
            'Final answer {{answer}}: wrong, the correct answer is {{expected}}',
            {
              answer: props.answer,
              expected: props.expected,
            }
          )}
    </div>
  )
}

function HtmlResult(props: { html: string }) {
  const { t } = useTranslation()

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([props.html], { type: 'text/html;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'iq-test.html'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Tabs defaultValue='preview'>
      <div className='flex items-center justify-between gap-2'>
        <TabsList>
          <TabsTrigger value='preview'>{t('Preview')}</TabsTrigger>
          <TabsTrigger value='source'>{t('Source code')}</TabsTrigger>
        </TabsList>
        <Button variant='outline' size='sm' onClick={download}>
          <Download className='size-4' />
          {t('Download HTML')}
        </Button>
      </div>
      <TabsContent value='preview'>
        {/* The page is model output: scripts may run, but without
            allow-same-origin it cannot read the console's cookies or storage. */}
        <iframe
          title={t('Preview')}
          sandbox='allow-scripts'
          srcDoc={props.html}
          className='h-[420px] w-full rounded-lg border bg-white'
        />
      </TabsContent>
      <TabsContent value='source'>
        <pre className='bg-muted/50 max-h-[420px] overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap'>
          {props.html}
        </pre>
      </TabsContent>
    </Tabs>
  )
}
