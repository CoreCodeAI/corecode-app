# Agent Note: Operator content in the console language

Status: implemented

## Problem

- The console translates its own strings, but the content an operator
  writes is one string per option: the home page (`HomePageContent`), the
  footer (`Footer`), and the dashboard's announcements, API info and FAQ
  panels. A CoreCode visitor on the English console still read that content
  in Chinese.

## Decision

- **`HomePageContent` and `Footer` may hold a JSON object of locale → text**
  (`{"zh":"…","en":"…"}`). `resolveLocalizedOption` picks the entry for
  `i18n.language` with the fallback `resolveLocalizedText` already used for
  marketplace copy: exact tag, primary subtag, `en`, then the first sorted
  key. A value that is not such an object, including a URL, Markdown, HTML or
  JSON of another shape, renders unchanged, so existing installations need
  no migration. The home page decides between iframe and inline content
  after resolving, so each locale may be a URL.
- **Announcement, API info and FAQ items may carry `i18n`**, an object of
  locale → field overrides (`{"en": {"answer": "…"}}`). `localizeItem`
  overlays the matched locale's non-empty string fields on the item.
- **The backend validates every translation as an item.**
  `withTranslations` lays each locale over the base item, and the merged copy
  runs the same checks as the base: required fields, lengths, URL and
  dangerous-content checks, colors and dates. A translation therefore cannot
  bypass a limit the console relies on. Malformed `i18n` is reported through
  the existing `Invalid … format: {{error}}` messages, so no locale strings
  were added. At most 10 locales per item.
- **Announcement read state stays keyed on the stored item.** The
  notification hook computes keys from the raw announcements and only
  returns localized copies for display, so switching language does not mark
  announcements unread.

## Alternatives considered

Not recorded when the change shipped.

## Files

| Path | Why |
| --- | --- |
| `web/src/lib/localized-text.ts` | `resolveLocalizedOption`, `localizeItem`, shared locale picker |
| `web/src/features/home/hooks/use-home-page-content.ts` | home page content resolved per language |
| `web/src/components/layout/components/footer.tsx` | footer HTML resolved per language |
| `web/src/features/dashboard/hooks/use-status-data.ts` | panel items localized |
| `web/src/hooks/use-notifications.ts` | announcement popover localized, read keys unchanged |
| `setting/console_setting/validation.go` | translations validated through the item checks |

## Consequences

- The admin settings forms still edit the base fields only. A bilingual
  value is written through the options API, which CoreCode does with
  `brand-newapi.sh` in `corecode-infra`.
