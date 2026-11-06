# Agent Note: Email an invitee when a channel gifts them a plan

Status: implemented

Superseded on 2026-11-06 by `2026-11-06-drop-gift-plan-email.md`: the notice is
no longer sent.

## Problem

A promotion channel can gift its invitees the gift plan
(`2026-10-26-inviter-change-and-gift-plan.md`), but the invitee learns of it
only from a system log entry. Most invitees never open the logs, so a gift
sits unused until it expires.

## Decision

- **A successful gift emails the invitee when the account has an email
  address.** `GiftSelfAffiliateInvitee` sends it after the subscription is
  committed; an invitee without an address gets nothing, and nothing changes
  for the inviter.
- **The mail never decides the gift.** It is sent in the background
  (`gopool`), so a slow or failing mail server neither delays nor fails the
  gift. A failure is a server log line. The mail goes to the
  account email, not the notification email in the user's settings, because
  this is a one-time account event rather than a usage notice.
- **`GiftAffiliatePlan` returns the subscription it created**, so the mail
  states the end date of that subscription rather than recomputing it.
- **Content.** `service/affiliate_gift_mail.go` renders a branded HTML mail:
  who gave which plan, that it is active and free, the plan's subtitle, its
  quota when it has one, and its end date. A button opens `/wallet`, where
  the subscription is shown, and three steps link to `/keys` and the Claude
  Code setup guide in the reader's language. The footer says the gift never
  charges the reader, so a stranger's gift reads as harmless rather than as
  phishing.
- **Language.** The invitee's saved language, else the language of the
  inviter's request (`AccountMailLanguage`). A channel and its invitees
  usually share one.
- **The end date is in UTC+8**, a fixed offset, because the customers are in
  mainland China and the server runs in UTC.
- **What the inviter typed is escaped.** The inviter's display name (or
  username) and the plan's title and subtitle are HTML-escaped before they
  enter the templates, which go-i18n renders with `text/template`.

## Alternatives considered

- **Send through `NotifyUser`.** It honors the user's notification channel
  (webhook, Bark, Gotify) and the per-type rate limit, which suit usage
  alerts. The request was an email to the account's address.
- **Send inside the request.** The inviter would wait on SMTP, and a mail
  error after a committed gift would read as a failed gift.
- **Format the end date in the server's zone.** Production runs in UTC, so
  a customer would read a date eight hours off.

## Verification

- `TestAffiliateGiftMail` covers the zh-CN and en subjects, escaping of the
  inviter's name and the plan's subtitle, the quota shown and omitted, the
  UTC+8 date, and the wallet, keys and per-language guide links.
- `TestAffiliateGiftDatabaseMatrix` checks the returned subscription and
  passes on SQLite 3.50.4, MySQL 8.0.46 and PostgreSQL 16.15. The change
  adds no table, column or query.
