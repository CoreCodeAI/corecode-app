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
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import {
  failureTone,
  joinSentences,
  TONES,
  useInsightsFormat,
  useTabLabel,
  type InsightsTab,
} from '../lib'
import {
  finishedTasks,
  preTaskFailures,
  tasksJudged,
} from '../quality-analysis'
import type {
  QualityRefusals,
  TaskOutcome,
  TaskOutcomes,
  VendorQuality,
} from '../types'
import { SampleNote } from './insight-kit'
import { Breakdown, Panel, SimpleTable } from './shared'

const LINK = 'text-primary font-medium hover:underline'

/** Seconds from submission to finish, short: seconds under two minutes, then minutes. */
function useFinishTime(): (seconds: number) => string {
  const { t } = useTranslation()
  return (seconds: number) => {
    if (seconds <= 0) return '—'
    if (seconds < 120) return `${seconds}s`
    return t('{{value}} min', { value: Math.round(seconds / 60) })
  }
}

function OpenTab(props: {
  tab: InsightsTab
  onOpen?: (tab: InsightsTab) => void
}) {
  const tabLabel = useTabLabel()
  const open = props.onOpen
  if (!open) return null
  return (
    <button type='button' className={LINK} onClick={() => open(props.tab)}>
      {tabLabel(props.tab)} →
    </button>
  )
}

/**
 * How the image and video tasks submitted in the range stand now, per
 * model: what finished, failed, timed out or still runs, and how long a
 * success took. A rate is coloured only from MIN_TASKS finished tasks.
 */
export function TaskOutcomesPanel(props: {
  tasks: TaskOutcomes
  /** The media vendor's requests in the range; its failures before a task are the ones the tasks do not account for. */
  media?: VendorQuality | null
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const finish = useFinishTime()
  const total = props.tasks.total
  const rows = (props.tasks.models ?? []).filter((row) => row.submitted > 0)
  const preTask = preTaskFailures(props.media, total)
  const rateText = (row: TaskOutcome) =>
    finishedTasks(row) > 0 ? fmt.pct(row.failure_rate) : '—'
  let summary: string | undefined
  if (total.submitted > 0) {
    summary = joinSentences(
      t(
        '{{submitted}} submitted: {{succeeded}} succeeded, {{failed}} failed ({{timedOut}} timed out), {{running}} still running.',
        {
          submitted: fmt.num(total.submitted),
          succeeded: fmt.num(total.succeeded),
          failed: fmt.num(total.failed),
          timedOut: fmt.num(total.timed_out),
          running: fmt.num(total.running),
        }
      ),
      tasksJudged(total)
        ? t('Failure rate {{rate}} of finished tasks.', {
            rate: fmt.pct(total.failure_rate),
          })
        : t('Too few finished tasks to judge a failure rate.')
    )
  }
  return (
    <Panel
      title={t('Image and video tasks')}
      description={summary}
      help={t(
        'Async tasks submitted in the range, as they stand now, every user’s, root included; the model filter does not narrow them. Failed includes timed out. A task counts as a success or failure only when it finished; the failure rate is failed over finished, colored above 2% and red above 5% from 20 finished tasks. Time to finish is from submission to finish, successes only. The request figures above see only the submission, so a task that failed later reads as a success there.'
      )}
      actions={<OpenTab tab='upstream' onOpen={props.onOpen} />}
    >
      <div className='grid gap-2'>
        {preTask && preTask.before > 0 && (
          <p className='text-muted-foreground text-xs'>
            {t(
              'Failed before a task was created: {{before}}. Media requests failed {{failed}} of {{requests}}; tasks failed {{taskFailed}} of {{submitted}} submitted.',
              {
                before: fmt.num(preTask.before),
                failed: fmt.num(preTask.failed),
                requests: fmt.num(preTask.requests),
                taskFailed: fmt.num(preTask.taskFailed),
                submitted: fmt.num(preTask.submitted),
              }
            )}
          </p>
        )}
        {total.stalled > 0 && (
          <p className={cn('text-xs', TONES.warning)}>
            {t(
              '{{count}} tasks have run over 30 minutes and may be stuck at the supplier.',
              { count: fmt.num(total.stalled) }
            )}
          </p>
        )}
        {props.tasks.truncated && (
          <SampleNote>
            {t(
              'Only the range’s first 50,000 tasks are counted; later ones are left out.'
            )}
          </SampleNote>
        )}
        <SimpleTable
          rows={rows}
          rowKey={(row) => row.model ?? ''}
          empty={t('No tasks submitted in this range')}
          faded={(row) => !tasksJudged(row)}
          columns={[
            {
              key: 'model',
              label: t('Model'),
              render: (row) => (
                <span className='font-mono text-xs'>{row.model}</span>
              ),
            },
            {
              key: 'submitted',
              label: t('Submitted'),
              align: 'right',
              render: (row) => fmt.num(row.submitted),
            },
            {
              key: 'succeeded',
              label: t('Succeeded'),
              align: 'right',
              render: (row) => fmt.num(row.succeeded),
            },
            {
              key: 'failed',
              label: t('Failed'),
              hint: t('Timed-out tasks in brackets; they are part of failed.'),
              align: 'right',
              render: (row) =>
                row.timed_out > 0
                  ? `${fmt.num(row.failed)} (${fmt.num(row.timed_out)})`
                  : fmt.num(row.failed),
            },
            {
              key: 'running',
              label: t('Running'),
              hint: t(
                'Not finished yet; in brackets, those running over 30 minutes.'
              ),
              align: 'right',
              render: (row) => (
                <span className={cn(row.stalled > 0 && TONES.warning)}>
                  {row.stalled > 0
                    ? `${fmt.num(row.running)} (${fmt.num(row.stalled)})`
                    : fmt.num(row.running)}
                </span>
              ),
            },
            {
              key: 'rate',
              label: t('Failure rate'),
              align: 'right',
              render: (row) => (
                <span
                  className={cn(
                    tasksJudged(row) && TONES[failureTone(row.failure_rate)]
                  )}
                >
                  {rateText(row)}
                </span>
              ),
            },
            {
              key: 'finish',
              label: t('Time to finish p50 / p95'),
              align: 'right',
              render: (row) =>
                row.succeeded > 0
                  ? `${finish(row.finish_p50_s)} / ${finish(row.finish_p95_s)}`
                  : '—',
            },
            {
              key: 'reason',
              label: t('Top failure reason'),
              render: (row) => {
                const top = row.reasons?.[0]
                if (!top) return '—'
                const text = `${top.name} (${fmt.num(top.count)})`
                return (
                  <span className='block max-w-40 truncate' title={text}>
                    {text}
                  </span>
                )
              },
            },
          ]}
        />
        {(total.reasons?.length ?? 0) > 0 && (
          <div className='grid gap-2'>
            <h4 className='text-muted-foreground text-xs'>
              {t('Why tasks failed')}
            </h4>
            <Breakdown
              items={total.reasons}
              empty={t('No failed tasks in this range')}
            />
            {total.failed >
              (total.reasons ?? []).reduce(
                (sum, item) => sum + item.count,
                0
              ) && (
              <SampleNote>
                {t(
                  'The five most common reasons; shares are of these, not of every failed task.'
                )}
              </SampleNote>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

/**
 * Requests turned away before any channel was tried: no channel of the
 * customer's group serves the model, or the risk gate blocked them. Each
 * links to where it is fixed.
 */
export function RefusalsPanel(props: {
  refusals: QualityRefusals
  onOpen?: (tab: InsightsTab) => void
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const refusals = props.refusals
  return (
    <Panel
      title={t('Refused before a channel')}
      help={t(
        'No channel: customers’ requests (root and staff left out) that no channel of their group serves; they are already in the requests and failures above. Risk gate: requests the risk gate blocked, every user’s, observe-mode hits left out; they never became requests, so they are not in the figures above. Neither follows the model filter.'
      )}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='grid content-start gap-1'>
          <p className='text-muted-foreground text-xs'>{t('No channel')}</p>
          <p
            className={cn(
              'text-xl font-semibold tabular-nums',
              refusals.no_channel > 0 && TONES.warning
            )}
          >
            {fmt.num(refusals.no_channel)}
          </p>
          <p className='text-muted-foreground text-xs'>
            {refusals.no_channel > 0
              ? t(
                  'Every channel of the group is off, or none lists the model. Check the channels.'
                )
              : t('Every request found a channel.')}
          </p>
          <p className='text-xs'>
            <OpenTab tab='upstream' onOpen={props.onOpen} />
          </p>
        </div>
        <div className='grid content-start gap-1'>
          <p className='text-muted-foreground text-xs'>{t('Risk gate')}</p>
          <p className='text-xl font-semibold tabular-nums'>
            {fmt.num(refusals.risk_gate)}
          </p>
          {refusals.risk_gate > 0 ? (
            <Breakdown
              items={refusals.risk_gate_stages}
              empty={t('No stage recorded')}
            />
          ) : (
            <p className='text-muted-foreground text-xs'>
              {t('The risk gate blocked nothing.')}
            </p>
          )}
          <p className='text-xs'>
            <a href='/risk-control#audit' className={LINK}>
              {t('Risk Control')} →
            </a>
          </p>
        </div>
      </div>
    </Panel>
  )
}
