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
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { useInsightsFormat } from '../lib'
import type {
  ExperienceFeedback,
  ExperienceInsights,
  ExperienceLapsed,
  ExperienceWaiting,
} from '../types'
import {
  useCategoryLabel,
  useStatusLabel,
  useWaitFormat,
} from '../verdicts/experience'
import { stayedShare } from './experience-analysis'
import { UserActions } from './risk-insights'
import {
  Breakdown,
  Panel,
  SimpleTable,
  UserLabel,
  type TableState,
} from './shared'

const LINK = 'text-primary font-medium hover:underline'

/** Where the reports stand now, and how fast the first reply came. */
export function FeedbackStatus(props: {
  feedback: ExperienceFeedback | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const wait = useWaitFormat()
  const statusLabel = useStatusLabel()
  const categoryLabel = useCategoryLabel()
  const feedback = props.feedback
  let replies: string | undefined
  if (feedback) {
    replies =
      feedback.replied > 0
        ? t(
            'First reply: median {{p50}}, slowest tenth {{p90}}, over {{count}} replied reports.',
            {
              p50: wait(feedback.first_reply_p50),
              p90: wait(feedback.first_reply_p90),
              count: fmt.num(feedback.replied),
            }
          )
        : t('No report of this range has a reply yet.')
  }
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Panel
        title={t('Reports by status')}
        description={replies}
        help={t(
          'Reports filed in the range, by where they stand now. The first reply is the time to the first change an administrator made to the report.'
        )}
      >
        <Breakdown
          items={feedback?.statuses}
          label={statusLabel}
          state={props.state}
          empty={t('No reports in this range')}
        />
      </Panel>
      <Panel
        title={t('Reports by category')}
        description={
          feedback && feedback.rewarded > 0
            ? t('{{count}} earned a reward, {{amount}} in all.', {
                count: fmt.num(feedback.rewarded),
                amount: fmt.usd(feedback.reward_usd),
              })
            : undefined
        }
      >
        <Breakdown
          items={feedback?.categories}
          label={categoryLabel}
          state={props.state}
          empty={t('No reports in this range')}
        />
      </Panel>
    </div>
  )
}

/** Whether the people who wrote in kept sending requests, and what they spent before and after. */
export function FeedbackRetention(props: {
  feedback: ExperienceFeedback | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const feedback = props.feedback
  const stayed = feedback ? stayedShare(feedback) : null
  let description: string | undefined
  if (feedback) {
    description =
      stayed == null
        ? t('No sender of this range has been followed for a full week yet.')
        : t(
            '{{active}} of {{judged}} senders sent a request in the 7 days after their first report ({{share}}).',
            {
              active: fmt.num(feedback.active),
              judged: fmt.num(feedback.judged),
              share: fmt.pct(stayed),
            }
          )
  }
  return (
    <Panel
      title={t('Did senders stay?')}
      description={description}
      help={t(
        'Each customer who filed a report is followed for the 7 days after their first report of the range. Senders whose week is not over are left out. Spend is the quota the customer used in the 7 days before and after.'
      )}
    >
      {feedback && stayed != null ? (
        <dl className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
          <Figure
            label={t('Still sending')}
            value={fmt.pct(stayed)}
            hint={t('{{count}} followed', { count: fmt.num(feedback.judged) })}
          />
          <Figure
            label={t('Spent in the week before')}
            value={fmt.usd(feedback.before_usd)}
          />
          <Figure
            label={t('Spent in the week after')}
            value={fmt.usd(feedback.after_usd)}
          />
          <Figure
            label={t('Week not over yet')}
            value={fmt.num(feedback.pending)}
          />
        </dl>
      ) : (
        <Breakdown
          items={undefined}
          state={props.state}
          empty={
            feedback
              ? t(
                  'No sender of this range has been followed for a full week yet.'
                )
              : ''
          }
        />
      )}
    </Panel>
  )
}

function Figure(props: { label: string; value: string; hint?: string }) {
  return (
    <div className='grid gap-0.5'>
      <dt className='text-muted-foreground text-xs'>{props.label}</dt>
      <dd className='text-lg font-semibold tabular-nums'>{props.value}</dd>
      {props.hint && (
        <dd className='text-muted-foreground text-xs'>{props.hint}</dd>
      )}
    </div>
  )
}

/** Reports nobody has touched for a day, oldest first, each with a link to answer it. */
export function WaitingReports(props: {
  data: ExperienceInsights | undefined
  /** The range's end, unix seconds: a report's age is read against it. */
  end: number
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const wait = useWaitFormat()
  const categoryLabel = useCategoryLabel()
  const feedback = props.data?.feedback
  return (
    <Panel
      title={t('Waiting for a reply')}
      description={
        feedback && feedback.unanswered_24h > 0
          ? t('{{count}} reports are over a day old with no reply.', {
              count: fmt.num(feedback.unanswered_24h),
            })
          : undefined
      }
      actions={
        <Link
          to='/feedback-admin'
          search={{ status: 'pending' }}
          className={`${LINK} text-xs`}
        >
          {t('Open feedback review')}
        </Link>
      }
    >
      <SimpleTable<ExperienceWaiting>
        rows={feedback?.waiting}
        rowKey={(row) => row.id}
        state={props.state}
        empty={t('No report is waiting more than a day')}
        columns={[
          {
            key: 'age',
            label: t('Waiting'),
            render: (row) => (
              <span className='whitespace-nowrap'>
                {wait(Math.max(0, props.end - row.created_time))}
              </span>
            ),
          },
          {
            key: 'user',
            label: t('Customer'),
            render: (row) => (
              <UserLabel user_id={row.user_id} username={row.username} />
            ),
          },
          {
            key: 'category',
            label: t('Category'),
            render: (row) => categoryLabel(row.category),
          },
          {
            key: 'title',
            label: t('Title'),
            render: (row) => (
              <span className='block max-w-64 truncate' title={row.title}>
                {row.title}
              </span>
            ),
          },
        ]}
      />
    </Panel>
  )
}

/** Customers who wrote in and then sent nothing for a week: the ones worth a message. */
export function LapsedSenders(props: {
  rows: ExperienceLapsed[] | undefined
  state?: TableState
}) {
  const { t } = useTranslation()
  const fmt = useInsightsFormat()
  const categoryLabel = useCategoryLabel()
  return (
    <Panel
      title={t('Wrote in, then went quiet')}
      description={t(
        'Senders with no request in the 7 days after their first report, by what they spent the week before.'
      )}
    >
      <SimpleTable<ExperienceLapsed>
        rows={props.rows}
        rowKey={(row) => row.user_id}
        state={props.state}
        empty={t('Every follow-up sender kept sending')}
        columns={[
          {
            key: 'user',
            label: t('Customer'),
            render: (row) => (
              <UserLabel user_id={row.user_id} username={row.username} />
            ),
          },
          {
            key: 'category',
            label: t('Category'),
            render: (row) => categoryLabel(row.category),
          },
          {
            key: 'at',
            label: t('First report'),
            render: (row) => (
              <span className='whitespace-nowrap'>{fmt.time(row.at)}</span>
            ),
          },
          {
            key: 'before',
            label: t('Spent the week before'),
            align: 'right',
            render: (row) => fmt.usd(row.before_usd),
          },
          {
            key: 'actions',
            label: '',
            render: (row) => (
              <UserActions user_id={row.user_id} username={row.username} />
            ),
          },
        ]}
      />
    </Panel>
  )
}
