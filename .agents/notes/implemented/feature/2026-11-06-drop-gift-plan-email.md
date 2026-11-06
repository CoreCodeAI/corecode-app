# Agent Note: Stop emailing invitees about the sign-up gift

Status: implemented

## Problem

On 2026-11-06 the linux.do launch brought a burst of sign-ups. Every channel
invitee cost two emails, the sign-in link and the gift notice, and Resend's
daily sending quota ran out at 07:36 UTC. After that every magic-link sign-in
failed with `550 "You have reached your daily email sending quota."`, so
customers who sign in only by email could not reach the console. By 08:14 the
log held 13 failed sign-in links and 14 failed gift notices.

## Decision

- **The gift notice is removed.** `giveAffiliateSignupGift` still gives the
  plan and logs a failure, but it sends no email. The gift is visible in the
  wallet, and the invitee has just signed in.
- **Its code goes with it**: `service/affiliate_gift_mail.go`, its test, the
  `email.affiliate_gift.*` keys and their en, zh-CN and zh-TW strings. This
  supersedes `2026-10-27-gift-plan-email.md` and the emailing part of
  `2026-10-28-channel-tiers-and-signup-gift.md`.
- **The sending quota goes to mail a customer needs**: sign-in links,
  verification codes, password resets and quota notices.

## Alternatives considered

- **A setting that turns the notice off.** The maintainer does not want the
  notice back, and an unused setting is one more thing to keep working.
- **Only a larger Resend plan.** It raises the ceiling but still spends half of
  every invitee's mail on a notice nobody needs.

## Verification

- `go vet ./controller ./service ./i18n ./model`.
- `go test ./controller -run 'MagicLink|Affiliate'`;
  `TestMagicLinkSignUpGivesTheChannelGiftPlan` still checks that the plan is
  given at sign-up.
- `go test ./service ./i18n`.
