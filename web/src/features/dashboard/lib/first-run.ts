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
/** CoreCode fork: what the first-run checklist asks of a new customer. */
export const SETUP_SECTION_ID = 'overview-setup'

export type FirstRunStepId = 'balance' | 'key' | 'config' | 'verify'

export type FirstRunStep = { id: FirstRunStepId; done: boolean }

/** Whether the account has never made a request or spent anything. */
export function isFirstRun(user: {
  request_count?: number
  used_quota?: number
}): boolean {
  return (
    Number(user.request_count ?? 0) === 0 && Number(user.used_quota ?? 0) === 0
  )
}

/**
 * The checklist's steps and which are done. Pasting the config leaves no
 * trace on our side, so that step counts as done once a request has arrived,
 * the same moment the verify step does.
 */
export function getFirstRunSteps(input: {
  available: number
  keyCount: number
  requestCount: number
}): FirstRunStep[] {
  const requested = input.requestCount > 0
  return [
    { id: 'balance', done: input.available > 0 },
    { id: 'key', done: input.keyCount > 0 },
    { id: 'config', done: requested },
    { id: 'verify', done: requested },
  ]
}
