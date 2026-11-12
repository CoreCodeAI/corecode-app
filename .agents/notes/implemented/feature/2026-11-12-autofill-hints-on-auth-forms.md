# Agent Note: Autofill hints on the password and sign-up forms

Status: implemented

## Problem

The password sign-in form, the sign-up form and the forgot-password form (upstream code)
left password managers to guess their fields: no `autocomplete` on the username and
password inputs, so iOS did not offer a strong password at sign-up, and the sign-up email
code had only a placeholder, no accessible name and no `one-time-code`. The
forgot-password address was a plain text field, so phones showed the text keyboard.

## Decision

- Sign-in: `username` and `current-password`.
- Sign-up: `username`, `new-password` on both password fields, `email` on the address, and
  on the emailed code `one-time-code`, `autoCapitalize="none"`, no spell check and an
  `aria-label` from the existing "Verification code" key.
- Forgot password: `autocomplete="email"` and `inputMode="email"`.
- Attributes only; no markup, layout or validation changes.

## Alternatives considered

- **`inputMode="numeric"` on the sign-up code, as the audit proposed.** The code is six
  hex characters (`common.GenerateVerificationCode(6)` cuts a UUID), so a numeric keyboard
  would hide the letters a to f. `VerifyCodeWithKey` compares case-sensitively, hence
  `autoCapitalize="none"`.
- **`type="email"` on the forgot-password field.** The form has no `noValidate`, so the
  browser's own message would replace the zod one on an invalid address. `inputMode` gives
  the same keyboard without changing validation.

## Consequences

- The magic-link form, the WeChat code and the two-factor `InputOTP` already carried their
  hints and are unchanged. The reset-confirm page shows a server-generated password in a
  disabled field, so it has no password to autofill.

## Verification

- `auth/__tests__/autofill.test.tsx`: 3 passed; with the three form files from main, all
  3 fail.
- Headless Chrome against a local server: the password form's fields report
  `autocomplete` `username` and `current-password`, and the emailed-link field `email`.
- `/sign-in` first load: 361,634 bytes of 363,520, with the three other changes in the
  same pull request.

Not checked with a password manager or on a phone keyboard.
