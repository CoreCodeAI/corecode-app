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
import { zodResolver } from '@hookform/resolvers/zod'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { ArrowLeft, ArrowRight, Loader2, Mail, MailCheck } from 'lucide-react'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { z } from 'zod'

import { Turnstile } from '@/components/turnstile'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { requestMagicLink, signInWithMagicLinkCode } from '@/features/auth/api'
import { LegalConsent } from '@/features/auth/components/legal-consent'
import { OAuthProviders } from '@/features/auth/components/oauth-providers'
import {
  forgotPasswordFormSchema,
  MAGIC_LINK_CODE_LENGTH,
  MAGIC_LINK_COUNTDOWN,
} from '@/features/auth/constants'
import { useAuthRedirect } from '@/features/auth/hooks/use-auth-redirect'
import { useProofOfWork } from '@/features/auth/hooks/use-proof-of-work'
import { useTurnstile } from '@/features/auth/hooks/use-turnstile'
import {
  AFFILIATE_CODE_MAX_LENGTH,
  captureAffiliateCodeFromUrl,
  getAffiliateCode,
  saveAffiliateCode,
} from '@/features/auth/lib/storage'
import { useCountdown } from '@/hooks/use-countdown'
import { useStatus } from '@/hooks/use-status'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError, authErrorMessage } from '@/lib/secure-verification'
import { createServerError } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

// The cooldown belongs to the mailbox the code went to; a different address
// can send at once (the server still rate-limits it).
function sameMailbox(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

type MagicLinkFormProps = {
  className?: string
  redirectTo?: string
  registrationEnabled?: boolean
  // OAuth sits beside the link, not behind "another way": both can open an
  // account, so a new customer sees every way in at once.
  showOAuthProviders?: boolean
}

// One field signs customers in and registers them: an unknown address creates
// the account when the operator allows registration. The mail carries a code
// and a link to the same credential, so the customer can type the code here or
// open the link on any device.
export function MagicLinkForm({
  className,
  redirectTo,
  registrationEnabled = true,
  showOAuthProviders = false,
}: MagicLinkFormProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(false)
  const [sentTo, setSentTo] = useState('')
  // The address the running cooldown was started for.
  const [cooldownEmail, setCooldownEmail] = useState('')
  // Consent starts checked; the customer can still uncheck it.
  const [agreedToLegal, setAgreedToLegal] = useState(true)
  // An invitation link (?aff=CODE or ?ref=CODE) lands here; keep its code for the send below.
  const [inviteCode, setInviteCode] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : captureAffiliateCodeFromUrl(window.location.search)
  )
  const [inviteOpen, setInviteOpen] = useState(false)
  const inviteId = useId()

  const { status } = useStatus()
  const requiresLegalConsent = Boolean(
    status?.user_agreement_enabled || status?.privacy_policy_enabled
  )
  const legalConsentErrorMessage = t('Please agree to the legal terms first')

  const countdown = useCountdown({ initialSeconds: MAGIC_LINK_COUNTDOWN })

  const {
    isTurnstileEnabled,
    turnstileSiteKey,
    turnstileToken,
    setTurnstileToken,
    validateTurnstile,
  } = useTurnstile()
  const { takeProof } = useProofOfWork()
  // A token passes the server check once, so every send renders a new widget.
  const [turnstileWidgetKey, setTurnstileWidgetKey] = useState(0)
  const clearTurnstileToken = useCallback(
    () => setTurnstileToken(''),
    [setTurnstileToken]
  )
  const turnstileWidget = isTurnstileEnabled ? (
    <Turnstile
      key={turnstileWidgetKey}
      siteKey={turnstileSiteKey}
      onVerify={setTurnstileToken}
      onExpire={clearTurnstileToken}
    />
  ) : null

  const form = useForm<z.infer<typeof forgotPasswordFormSchema>>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: '' },
  })
  const typedEmail = form.watch('email')
  const cooldownBlocksSend =
    countdown.isActive && sameMailbox(typedEmail ?? '', cooldownEmail)

  async function sendMail(email: string) {
    // A link that can open an account is a registration entry, so the same
    // consent gate as the password form applies before the send is spent.
    if (requiresLegalConsent && !agreedToLegal) {
      toast.error(legalConsentErrorMessage)
      return
    }
    if (!validateTurnstile()) return
    const submittedTurnstileToken = turnstileToken
    if (isTurnstileEnabled) {
      setTurnstileToken('')
      setTurnstileWidgetKey((current) => current + 1)
    }

    setIsLoading(true)
    try {
      const pow = await takeProof()
      if (pow === null) return
      const res = await requestMagicLink(
        email,
        redirectTo,
        getAffiliateCode() || undefined,
        submittedTurnstileToken || undefined,
        pow
      )
      if (res?.success) {
        setSentTo(email)
        setCooldownEmail(email)
        countdown.start(res.resend_after)
        toast.success(t('Sign-in code sent, please check your inbox'))
      } else {
        handleServerError(
          createServerError(res, t('Failed to send sign-in link'))
        )
      }
    } catch (error: unknown) {
      handleServerError(
        AuthOperationError.from(error, t('Failed to send sign-in link'))
      )
    } finally {
      setIsLoading(false)
    }
  }

  if (sentTo) {
    return (
      <MagicLinkCodeStep
        className={className}
        email={sentTo}
        redirectTo={redirectTo}
        isResending={isLoading}
        resendSecondsLeft={countdown.isActive ? countdown.secondsLeft : 0}
        humanCheck={turnstileWidget}
        humanCheckPending={isTurnstileEnabled && !turnstileToken}
        onResend={() => sendMail(sentTo)}
        onChangeEmail={() => setSentTo('')}
      />
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => sendMail(data.email))}
        className={cn('grid gap-5', className)}
      >
        {showOAuthProviders && (
          <OAuthProviders
            status={status}
            redirectTo={redirectTo}
            disabled={isLoading || (requiresLegalConsent && !agreedToLegal)}
            consentMissing={requiresLegalConsent && !agreedToLegal}
            separatorLabel={t('Or continue with email')}
          />
        )}

        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Email')}</FormLabel>
              <div className='relative'>
                <Mail
                  aria-hidden='true'
                  className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
                />
                <FormControl>
                  <Input
                    type='email'
                    autoComplete='email'
                    className='h-11 pl-9'
                    placeholder='name@example.com'
                    {...field}
                  />
                </FormControl>
              </div>
              <FormDescription>
                {registrationEnabled
                  ? t(
                      'We will email you a sign-in code and link. New email addresses create an account automatically.'
                    )
                  : t('We will email you a one-time sign-in code and link.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {registrationEnabled &&
          (inviteCode || inviteOpen ? (
            <div className='grid gap-2'>
              <label htmlFor={inviteId} className='text-sm font-medium'>
                {t('Invitation code (optional)')}
              </label>
              <Input
                id={inviteId}
                autoComplete='off'
                maxLength={AFFILIATE_CODE_MAX_LENGTH}
                className='h-11'
                value={inviteCode}
                onChange={(event) => {
                  const value = event.target.value.trim()
                  setInviteOpen(true)
                  setInviteCode(value)
                  saveAffiliateCode(value)
                }}
              />
            </div>
          ) : (
            <Button
              type='button'
              variant='link'
              className='text-muted-foreground hover:text-foreground h-auto justify-self-start p-0 text-sm'
              onClick={() => setInviteOpen(true)}
            >
              {t('Have an invitation code?')}
            </Button>
          ))}

        <LegalConsent
          status={status}
          checked={agreedToLegal}
          onCheckedChange={setAgreedToLegal}
        />

        {turnstileWidget}

        <Button
          type='submit'
          size='lg'
          className='h-11'
          disabled={isLoading || cooldownBlocksSend}
        >
          {isLoading && <Loader2 className='animate-spin' />}
          {cooldownBlocksSend
            ? t('Resend code ({{seconds}}s)', {
                seconds: countdown.secondsLeft,
              })
            : t('Send sign-in code')}
          {!isLoading && <ArrowRight />}
        </Button>
      </form>
    </Form>
  )
}

type MagicLinkCodeStepProps = {
  className?: string
  email: string
  redirectTo?: string
  isResending: boolean
  resendSecondsLeft: number
  // The Turnstile widget a resend needs. It mounts with the step, so its token
  // is ready by the time the cooldown ends.
  humanCheck?: ReactNode
  humanCheckPending?: boolean
  onResend: () => void
  onChangeEmail: () => void
}

// The second step after the mail is sent: the code is typed or pasted here,
// and the mailed link remains the alternative that needs no transcription.
function MagicLinkCodeStep({
  className,
  email,
  redirectTo,
  isResending,
  resendSecondsLeft,
  humanCheck,
  humanCheckPending = false,
  onResend,
  onChangeEmail,
}: MagicLinkCodeStepProps) {
  const { t } = useTranslation()
  const { handleLoginResult } = useAuthRedirect()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const otpRef = useRef<HTMLInputElement>(null)
  // The field is disabled while a code is checked, which drops focus; a failed
  // check asks for it back once the field is enabled again.
  const [refocusCount, setRefocusCount] = useState(0)
  useEffect(() => {
    if (refocusCount > 0) otpRef.current?.focus()
  }, [refocusCount])
  const codeId = useId()
  const errorId = useId()

  async function verify(value: string) {
    if (value.length !== MAGIC_LINK_CODE_LENGTH || isVerifying) return
    setIsVerifying(true)
    setError('')
    try {
      const res = await signInWithMagicLinkCode(email, value)
      if (res?.success) {
        await handleLoginResult(res.data, redirectTo)
        return
      }
      setError(t('Code is incorrect or has expired'))
      setCode('')
      setRefocusCount((count) => count + 1)
    } catch (err: unknown) {
      setError(authErrorMessage(err, t('Code is incorrect or has expired')))
      setCode('')
      setRefocusCount((count) => count + 1)
    } finally {
      setIsVerifying(false)
    }
  }

  let resendLabel = t('Resend code')
  if (resendSecondsLeft > 0) {
    resendLabel = t('Resend code ({{seconds}}s)', {
      seconds: resendSecondsLeft,
    })
  } else if (humanCheckPending) {
    resendLabel = t('Verifying…')
  }

  return (
    <form
      className={cn('grid gap-6', className)}
      onSubmit={(event) => {
        event.preventDefault()
        void verify(code)
      }}
    >
      <div className='flex items-start gap-3'>
        <div className='bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full'>
          <MailCheck aria-hidden='true' className='size-5' />
        </div>
        <div className='min-w-0 space-y-1'>
          <h2 className='text-base font-semibold'>{t('Check your email')}</h2>
          <p className='text-muted-foreground truncate text-sm' title={email}>
            {email}
          </p>
        </div>
      </div>

      <div className='grid gap-3'>
        <label htmlFor={codeId} className='text-sm font-medium'>
          {t('Sign-in code')}
        </label>
        <InputOTP
          ref={otpRef}
          id={codeId}
          autoFocus
          maxLength={MAGIC_LINK_CODE_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode='numeric'
          autoComplete='one-time-code'
          value={code}
          disabled={isVerifying}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(value) => {
            setCode(value)
            if (error) setError('')
          }}
          onComplete={(value: string) => void verify(value)}
          containerClassName='w-full'
        >
          <InputOTPGroup className='w-full'>
            {Array.from({ length: MAGIC_LINK_CODE_LENGTH }, (_, index) => (
              <InputOTPSlot
                key={index}
                index={index}
                aria-invalid={error ? true : undefined}
                className='h-12 flex-1 font-mono text-lg font-medium'
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error ? (
          <p id={errorId} role='alert' className='text-destructive text-sm'>
            {error}
          </p>
        ) : (
          <p className='text-muted-foreground text-sm'>
            {t(
              'Enter the 6-digit code from the email. It works once and expires in 10 minutes.'
            )}
          </p>
        )}
      </div>

      <Button
        type='submit'
        size='lg'
        className='h-11'
        disabled={isVerifying || code.length !== MAGIC_LINK_CODE_LENGTH}
      >
        {isVerifying && <Loader2 className='animate-spin' />}
        {t('Sign in')}
      </Button>

      <div className='text-muted-foreground bg-muted/50 space-y-1 rounded-lg px-3 py-2.5 text-sm'>
        <p>{t('You can also open the link in the email to sign in.')}</p>
        <p>{t('No email? Check your spam or junk folder.')}</p>
      </div>

      {humanCheck && <div className='min-h-[65px]'>{humanCheck}</div>}

      <div className='flex items-center justify-between gap-2 text-sm'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground -ml-2'
          onClick={onChangeEmail}
        >
          <ArrowLeft aria-hidden='true' />
          {t('Use a different email')}
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='text-muted-foreground hover:text-foreground -mr-2'
          disabled={isResending || resendSecondsLeft > 0 || humanCheckPending}
          onClick={onResend}
        >
          {isResending && <Loader2 className='animate-spin' />}
          {resendLabel}
        </Button>
      </div>
    </form>
  )
}
