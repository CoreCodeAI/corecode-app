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
import axios from 'axios'

import { api, refreshAuthentication, type RefreshOutcome } from '@/lib/api'
import { AuthOperationError } from '@/lib/secure-verification'
import {
  getServerErrorMessageKey,
  getServerMessage,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  clearPasswordEncryptionCache,
  encryptPassword,
} from './lib/password-encryption'
import { type PowChallenge, powSolutionHeaders } from './lib/proof-of-work'
import { getAffiliateCode } from './lib/storage'
import type { TelegramAuthorization } from './lib/telegram-login'
import type { VerificationOperation } from './secure-verification/types'
import type {
  LoginPayload,
  LoginResponse,
  Login2FAResponse,
  TwoFAPayload,
  RegisterRequest,
  ApiResponse,
  MagicLinkResponse,
} from './types'

// ============================================================================
// Authentication APIs
// ============================================================================

// ----------------------------------------------------------------------------
// Login & Logout
// ----------------------------------------------------------------------------

// User login with username and password
export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const turnstile = payload.turnstile ?? ''
  try {
    let passwordFields:
      | { password: string }
      | { password_encrypted: string; encryption_key_id: string }
    if (payload.passwordEncryptionEnabled) {
      const encryptedPassword = await encryptPassword(payload.password)
      passwordFields = {
        password_encrypted: encryptedPassword.password_encrypted,
        encryption_key_id: encryptedPassword.encryption_key_id,
      }
    } else {
      passwordFields = { password: payload.password }
    }
    const res = await api.post<LoginResponse>(
      `/api/user/login?turnstile=${turnstile}`,
      {
        username: payload.username,
        ...passwordFields,
      },
      { skipAuthRefresh: true, headers: powSolutionHeaders(payload.pow) }
    )
    if (payload.passwordEncryptionEnabled && !res.data?.success) {
      clearPasswordEncryptionCache()
    }
    return res.data
  } catch (error: unknown) {
    if (payload.passwordEncryptionEnabled) {
      clearPasswordEncryptionCache()
    }
    throw error
  }
}

// Two-factor authentication login
export async function login2fa(payload: TwoFAPayload) {
  const res = await api.post<Login2FAResponse>('/api/user/login/2fa', payload, {
    skipAuthRefresh: true,
  })
  return res.data
}

interface LogoutRuntime {
  getExpectedSID: () => string | undefined
  request: (expectedSID?: string) => Promise<ApiResponse>
  refresh: () => Promise<RefreshOutcome>
}

export async function executeLogout(
  runtime: LogoutRuntime,
  allowMismatchRecovery = true
): Promise<ApiResponse> {
  try {
    return await runtime.request(runtime.getExpectedSID())
  } catch (error: unknown) {
    const code = axios.isAxiosError(error)
      ? error.response?.data?.code
      : undefined
    if (
      allowMismatchRecovery &&
      axios.isAxiosError(error) &&
      error.response?.status === 409 &&
      code === 'AUTH_SESSION_MISMATCH'
    ) {
      const outcome = await runtime.refresh()
      if (outcome.kind === 'authenticated') {
        return executeLogout(runtime, false)
      }
      if (outcome.kind === 'anonymous') {
        return { success: true, message: '' }
      }
    }
    throw error
  }
}

// User logout
export async function logout(): Promise<ApiResponse> {
  return executeLogout({
    getExpectedSID: () => useAuthStore.getState().auth.session?.sid,
    request: async (sid) => {
      const res = await api.post('/api/user/auth/logout', undefined, {
        headers: sid ? { 'X-Auth-Session': sid } : undefined,
        skipAuthRefresh: true,
        skipErrorHandler: true,
      })
      return res.data
    },
    refresh: refreshAuthentication,
  })
}

// ----------------------------------------------------------------------------
// Password Management
// ----------------------------------------------------------------------------

// Send password reset email
export async function sendPasswordResetEmail(
  email: string,
  turnstile?: string,
  pow?: string
): Promise<ApiResponse> {
  const res = await api.get('/api/reset_password', {
    params: { email, turnstile },
    headers: powSolutionHeaders(pow),
  })
  return res.data
}

// ----------------------------------------------------------------------------
// Email Link Sign-in
// ----------------------------------------------------------------------------

// Request a one-time sign-in link. The response is the same whether the
// address has an account, so it never confirms registration. redirect is the
// in-app path the link should continue to after it lands. aff is the inviter's
// code; the server uses it only when the link registers a new account.
// turnstile and pow answer the human checks while they are enabled.
export async function requestMagicLink(
  email: string,
  redirect?: string,
  aff?: string,
  turnstile?: string,
  pow?: string
): Promise<MagicLinkResponse> {
  const res = await api.post(
    '/api/magic_link/send',
    { email, redirect, aff },
    {
      skipAuthRefresh: true,
      params: turnstile ? { turnstile } : undefined,
      headers: powSolutionHeaders(pow),
    }
  )
  return res.data
}

// Turn a sign-in link into a browser session. The token is posted rather than
// fetched so it never reaches a server access log through a GET query string.
export async function signInWithMagicLink(
  token: string
): Promise<LoginResponse> {
  const res = await api.post(
    '/api/magic_link/login',
    { token },
    {
      skipAuthRefresh: true,
    }
  )
  return res.data
}

// Sign in with the six-digit code mailed beside the link, for a customer reading
// mail on another device. The code and the link spend the same credential.
export async function signInWithMagicLinkCode(
  email: string,
  code: string
): Promise<LoginResponse> {
  const res = await api.post(
    '/api/magic_link/code',
    { email, code },
    { skipAuthRefresh: true }
  )
  return res.data
}

// ----------------------------------------------------------------------------
// OAuth
// ----------------------------------------------------------------------------

// Start GitHub OAuth flow
export async function githubOAuthStart(clientId: string, state: string) {
  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}&scope=user:email`
  window.open(url)
}

// Get OAuth state for CSRF protection
export async function createOAuthAuthorization(
  provider: string,
  intent: 'login' | 'bind' | 'verify',
  operation?: VerificationOperation,
  signal?: AbortSignal,
  proofToken?: string
): Promise<{ state: string; authorizationUrl?: string }> {
  const aff = intent === 'login' ? getAffiliateCode() : ''
  const res = await api.post(
    '/api/oauth/state',
    {
      provider,
      intent,
      aff: aff || undefined,
      scope: operation?.scope,
      ...(operation?.context ? { context: operation.context } : {}),
    },
    {
      skipAuthRefresh: intent === 'login',
      ...(proofToken ? { headers: { 'X-Security-Proof': proofToken } } : {}),
      singleUseAuthorization: intent === 'bind',
      signal,
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  if (res.data?.success) {
    if (typeof res.data.data === 'string') return { state: res.data.data }
    if (typeof res.data.data?.flow_token === 'string') {
      return {
        state: res.data.data.flow_token,
        authorizationUrl: res.data.data.authorization_url,
      }
    }
  }
  throw new AuthOperationError(
    getServerErrorMessageKey(res.data) ||
      getServerMessage(res.data) ||
      'Failed to initialize OAuth',
    res.data?.code
  )
}

export async function createOAuthFlow(
  provider: string,
  intent: 'login' | 'bind' | 'verify',
  operation?: VerificationOperation,
  signal?: AbortSignal
): Promise<string> {
  return (await createOAuthAuthorization(provider, intent, operation, signal))
    .state
}

// WeChat login by authorization code
export async function wechatLoginByCode(code: string): Promise<ApiResponse> {
  const res = await api.get('/api/oauth/wechat', { params: { code } })
  return res.data
}

export async function telegramLogin(
  authorization: TelegramAuthorization
): Promise<ApiResponse> {
  const res = await api.get('/api/oauth/telegram/login', {
    params: authorization,
    disableDuplicate: true,
    skipAuthRefresh: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  return res.data
}

// ----------------------------------------------------------------------------
// Registration
// ----------------------------------------------------------------------------

// User registration
export async function register({
  pow,
  ...payload
}: RegisterRequest): Promise<ApiResponse> {
  const res = await api.post(`/api/user/register`, payload, {
    params: { turnstile: payload.turnstile ?? '' },
    headers: powSolutionHeaders(pow),
  })
  return res.data
}

// Send email verification code
export async function sendEmailVerification(
  email: string,
  turnstile?: string,
  pow?: string
): Promise<ApiResponse> {
  const res = await api.get('/api/verification', {
    params: { email, turnstile },
    headers: powSolutionHeaders(pow),
  })
  return res.data
}

// A proof-of-work challenge for the anonymous account routes.
export async function requestPowChallenge(): Promise<PowChallenge> {
  const res = await api.get('/api/pow/challenge', {
    skipAuthRefresh: true,
    skipBusinessError: true,
    skipErrorHandler: true,
  })
  if (!res.data?.success) {
    throw new Error(
      res.data?.message || 'Failed to get a proof-of-work challenge'
    )
  }
  return res.data.data
}

// Confirm an authenticated, server-owned email binding flow.
export async function bindEmail(
  flowToken: string,
  newCode: string,
  oldCode = '',
  signal?: AbortSignal
): Promise<ApiResponse> {
  const res = await api.post(
    '/api/oauth/email/bind',
    {
      flow_token: flowToken,
      new_code: newCode,
      old_code: oldCode,
    },
    { singleUseAuthorization: true, signal }
  )
  return res.data
}

// Record that the signed-in user accepted the current terms version.
export async function acceptTermsConsent(
  version: string
): Promise<ApiResponse<{ terms_version: string }>> {
  const res = await api.post(
    '/api/user/terms/consent',
    { version },
    { skipErrorHandler: true }
  )
  return res.data
}
