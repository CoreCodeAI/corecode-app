# Agent Note: Give the channel sign-up gift only to OAuth sign-ups, one per network

Status: implemented

## Problem

From 2026-11-08 00:00 CST a farm registered about 140 accounts through the linux.do channel's code (inviter 964), in batches at :00 and :08 each hour. Each one collected the retail gift plan, $3 for 7 days. Every account signed up through the emailed sign-in link with a Gmail address; usernames such as `bruce58foster8996` and `hongtungvuychmong736` look generated. None used Google or linux.do sign-in. Their addresses rotated within a few subnets (104.207, 216.26, 209.50, 45.3, 65.111, 151.123), so the one-gift-per-address limit withheld only a handful. 58 accounts of the first hour had already created API keys; none had spent the gift. An administrator cancelled 134 of these gifts through the admin invalidate endpoint.

An earlier wave on 2026-11-06 to 11-07 used random `@hotmail.com` names the same way, mostly stopped by the address limit.

## Decision

- **OAuth sign-ups only.** `GiveAffiliateSignupGift` takes `viaOAuth`. The emailed link and password registration pass false and record the row as `email_signup`, which is withheld and never given later. The OAuth callback passes true. A Google or linux.do account costs a farm far more than an email address it can buy in bulk; neither wave used one.
- **One gift per network.** The 24-hour address limit now counts the address's IPv4 /24 or IPv6 /64, stored in the new `network` column. Rows from before the column existed have it empty and still match by `ip`, so the change does not reopen addresses gifted in the last day.
- A withheld email sign-up does not use up its network: only `gifted` rows count.

This reverses part of `2026-10-28-channel-tiers-and-signup-gift.md`, which gave the gift on every sign-up path.

## Alternatives considered

**Block the email domains.** `gift_blocked_email_domains` already exists, but the farm used gmail.com, which real customers use too.

**Daily cap only.** `gift_daily_cap` bounds the loss per channel but lets the farm take the whole cap before real invitees arrive.

**Block datacenter or proxy ranges.** Needs an IP reputation source, and many real customers in China reach the site through commercial proxies.

## Consequences

- Real customers who sign up by email through a channel link (qq.com, 163.com) no longer receive the gift. They are still bound to the channel, so commission works, and they can buy the newcomer plan.
- Customers behind one shared proxy exit or campus NAT /24 now share one gift a day.
- The affiliate overview counts `email_signup` among the withheld gifts.

## Verification

- `go test ./model ./controller`. `TestAffiliateSignupGiftDatabaseMatrix` passes on SQLite, MySQL 8 and Postgres 16 (local containers, `TEST_MYSQL_DSN` and `TEST_POSTGRES_DSN`).
- New cases: another address in a gifted /24 is withheld; an old row without a network still matches by address; an email sign-up is withheld as `email_signup` and leaves its network free. `TestSignupGiftNetwork` covers IPv4, IPv4-mapped IPv6, IPv6 /64 and unparsable input.
- `TestMagicLinkSignUpWithholdsTheChannelGiftPlan` replaces the test that expected a gift: the account is bound to the channel and has no subscription.
- Mutation checks: ignoring `viaOAuth`, matching by address only, and dropping the address fallback each fail the matrix test.
