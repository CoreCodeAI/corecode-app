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
import type { SystemStatus } from '../types'

// The browser remembers the terms version a visitor agreed to on the sign-in
// page, so the console can record it once the visitor is signed in.
const TERMS_CONSENT_STORAGE_KEY = 'corecode_terms_consent'

export type StoredTermsConsent = {
  version: string
  accepted_at: string
}

/** The terms version customers must accept; empty when the gate is off. */
export function getTermsVersion(status: SystemStatus | null | undefined) {
  const version = status?.terms_version ?? status?.data?.terms_version
  return typeof version === 'string' ? version.trim() : ''
}

export function readStoredTermsConsent(): StoredTermsConsent | null {
  try {
    const raw = localStorage.getItem(TERMS_CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      typeof parsed.version === 'string'
    ) {
      return parsed as StoredTermsConsent
    }
  } catch {
    // Unreadable storage counts as no consent.
  }
  return null
}

export function hasStoredTermsConsent(version: string): boolean {
  return Boolean(version) && readStoredTermsConsent()?.version === version
}

export function storeTermsConsent(version: string): void {
  try {
    const consent: StoredTermsConsent = {
      version,
      accepted_at: new Date().toISOString(),
    }
    localStorage.setItem(TERMS_CONSENT_STORAGE_KEY, JSON.stringify(consent))
  } catch {
    // Without storage the dialog asks again on the next visit.
  }
}
