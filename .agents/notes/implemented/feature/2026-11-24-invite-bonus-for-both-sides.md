# Agent Note: New inviters give both sides a fixed bonus, and one address gets five gifts a month

Status: implemented

## Problem

Every customer invites at the default 5% of what invitees pay for and use. The owner wants a simpler offer for new inviters: the invitee and the inviter each receive $5. Inviters who already earn a rate keep it. On 2026-11-24, 105 `affiliates` rows were channels (13), administrator grants, or users who had invited someone, and 3,540 default-rate rows had invited no one.

A fixed bonus is cash for a new account, so it needs a farm limit. The channel gift plan was limited to one gift per IPv4 /24 or IPv6 /64 in 24 hours, so one address still collected up to eight gifts in 30 days. The owner set one limit for every sign-up gift: five per address in 30 days. The newcomer plans already allow five holders per address in 30 days (`limited_plan_address_setting.threshold`) and are unchanged.

## Decision

- **`affiliates.reward` holds the reward, fixed once set.** `commission` keeps the rate; `bonus` makes the rate an invite right only. `MigrateAffiliateRewards` runs at startup and fills empty rows: `commission` for a channel tier, a grant (`granted_by > 0`), or a user anyone names as inviter, and `bonus` for the rest. A row's reward does not change when its user invites someone later. `ensureDefaultAffiliateWithTx` creates new rows on `bonus`. `SetAffiliate`, the administrator's grant, sets `commission`.
- **Only `commission` earns level-1 commission.** `affiliateCreditsFor` skips the inviter on `bonus`. The distributor's second level is unchanged, because channels are on `commission`.
- **The invitee's bonus is a sign-up gift.** `GiveAffiliateSignupGift` gives an inviter's invitee the channel plan if the inviter is a channel, or `InviteBonus` in the wallet if the inviter is on `bonus`. Both write one `affiliate_signup_gifts` row per invitee: a plan row carries `plan_id`, and a bonus row carries `quota`. Both kinds share the same limits: OAuth sign-ups only, blocked email domains, the per-inviter daily cap, and `GiftIpLimit` given gifts per exact address in 30 days.
- **The inviter's bonus waits for the invitee's payment.** The hourly settlement task lists invitees of `bonus` inviters who have a paid top-up and no `affiliate_invite_bonus` row (GORM does not pluralize "bonus") (`AffiliateInviteBonusesDue`). `PayAffiliateInviteBonus` pays `InviteBonus` into the inviter's wallet when the invitee has paid at least that amount through a gateway since the referral started. An inviter who shares an address with the invitee is recorded as `self_invited` and never paid, unless a root user exempted them. The unique row per invitee pays it once, even if both release colors run the task.
- **Settings.** `affiliate_setting.invite_bonus` is in display currency and defaults to 5, so 2,500,000 quota at 500,000 per unit. `affiliate_setting.gift_ip_limit` defaults to 5. 0 turns either off. Both are in the admin invitation settings.
- **The console reads `reward`.** The wallet card and the invitations page show "{{bonus}} each", the terms, and the bonuses earned for `bonus`. They show commission figures only for `commission`, or when commission was earned before.

## Alternatives considered

**Pay both bonuses at sign-up.** That gives $10 for each OAuth account, and the only protection would be the address limit. Paying the inviter after a real payment means a farm earns nothing for the inviter side.

**Put the inviter's bonus in the commission balance.** The commission records would then show it. The owner chose the wallet for both sides. Commission is moved to the wallet anyway for a non-channel inviter, and the summary reports `invite_bonus_earned`.

**Decide by whether the user has invitees at each settlement.** A default-rate user without invitees would then switch to commission on their first invite. The reward is frozen at the migration instead.

## Consequences

- A `bonus` inviter's invitees earn the inviter nothing beyond the one bonus each, however much they spend.
- The channel gift plan is looser for a single address: five gifts in 30 days, not one per /24 per day. Other addresses in a /24 no longer count. `network` is still recorded on each row.
- A row created by the old release color during a release has an empty reward until the next start. The sign-up gift reads it as `bonus`. The inviter-bonus query excludes only `commission`, so it reads the row as `bonus` too.

## Verification

- `TestAffiliateRewardMigrationDatabaseMatrix` and `TestAffiliateInviteBonusDatabaseMatrix` cover the migration, the sign-up bonus, the shared address limit across plan and bonus, the payment threshold, offline payments, self-invites and the exemption, concurrent payment, and the switches. The existing commission, inviter, tier, signup gift, and self-invited tests were updated: their legacy inviters are kept on `commission`, and the gift test uses the new address limit.
- The affiliate, self-invited, limited-plan, risk signal, and site insight groups passed on SQLite 3.50.4, MySQL 8.0.46, and PostgreSQL 17.11, each group on fresh databases. A full `./model` run on the shared MySQL and Postgres databases failed 304 subtests on both this branch and origin/main 298b030ee, because the tests leave data behind for each other. `go test ./model ./controller ./service ./router ./middleware ./setting/...` passed on SQLite.
- Upgrade: an `affiliates` table without `reward` and an `affiliate_signup_gifts` table without `quota`, with rows, were migrated twice on MySQL 8.0 and PostgreSQL 17. Each row got the expected reward, and the existing gift kept its plan.
- Mutation checks: removing the commission gate, ignoring the self-invite, paying on any payment, and allowing one gift over the address limit each failed a test. Treating no account as on `bonus` failed the console card test.
- Console: `typecheck`, `lint:check`, `format`, `build`, and `first-load:check` passed (`/dashboard/overview` 562 bytes left). The wallet and invitations tests passed. Only the two server-sent log keys are in the `core` locale part.
