# Agent Note: Merge refusals into a warning for two minutes, not ten

Status: implemented

## Problem

After a lenient warning, every refusal within ten minutes merged into it, new
conversations included (`2026-11-07-warn-per-category-within-a-day.md`). The window was
meant for the parallel requests of one incident. In production it also absorbed customers
who kept opening new conversations the upstream refused: user 2919 on 2026-11-11 had 20
refusals across 12 new conversations in the ten minutes after one warning, and user 2023 on
2026-11-08 had 13 across 8 conversations in four minutes. All were `merged`, counted
nothing, and each reached a pool account.

## Decision

`warningMergeSeconds` (120) replaces `minViolationMergeSeconds` as the merge period a
warning leaves. `minViolationMergeSeconds` still sets the merge period of a strike when
suspension is off. A refusal of a new conversation more than two minutes after a warning
starts a new incident, so the existing ladder applies: the second incident of the day is a
warning, and the third suspends.

## Alternatives considered

- **60 seconds.** In the replay below, 60 s avoided about 24 more refusals than 120 s but
  suspended two more users. The owner chose 120 s.
- **A separate breaker on refused conversations per hour.** That would be a second
  mechanism next to the incident ladder, and the ladder already does the job once merging
  stops absorbing new incidents.

## Consequences

The 30-day replay of production refusals (2026-10-16 to 2026-11-15, enforce mode,
customers, through the guard's rules including the resend block of app #309) gives 164
refusals with 120 s against 203 with ten minutes. Suspended users rise from 7 to 11. The
four added are 546, 1807, 2925 and 3390, whose refusals were all upstream classifier
refusals.

## Verification

`go test ./service/ -run TestViolation` passes (sqlite). The new case "new conversations
refused minutes after a warning are new incidents" fails against `origin/main`'s
`service/violation_guard.go`.
