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
// ============================================================================
// Wallet Type Definitions
// ============================================================================

/**
 * Generic API response
 */
export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

/**
 * Standard API response types
 */
export type TopupInfoResponse = ApiResponse<TopupInfo>
export type RedemptionResponse = ApiResponse<number>
export type AmountResponse = ApiResponse<string>
export type PaymentResponse = ApiResponse<Record<string, unknown>> & {
  url?: string
}
export type StripePaymentResponse = ApiResponse<{ pay_link: string }>
export type AffiliateCodeResponse = ApiResponse<string>
export type AffiliateTransferResponse = ApiResponse
export type CreemPaymentResponse = ApiResponse<{ checkout_url: string }>
export type WaffoPaymentResponse = ApiResponse<
  { payment_url?: string } | string
>
export type WaffoPancakePaymentResponse = ApiResponse<
  | {
      checkout_url?: string
      session_id?: string
      expires_at?: number | string
      order_id?: string
      // Self-service session token + expiry — surfaced by the backend so
      // future flows (refund / cancel from new-api's own UI) can use them
      // without re-issuing checkout. Not consumed by the current handler.
      token?: string
      token_expires_at?: number | string
    }
  | string
>

/**
 * Creem product configuration
 */
export interface CreemProduct {
  /** Product display name */
  name: string
  /** Creem product ID */
  productId: string
  /** Product price */
  price: number
  /** Quota amount to credit */
  quota: number
  /** Currency (USD or EUR) */
  currency: 'USD' | 'EUR'
}

/**
 * Creem payment request
 */
export interface CreemPaymentRequest {
  /** Creem product ID */
  product_id: string
  /** Payment method identifier */
  payment_method: 'creem'
}

/**
 * Payment method configuration
 */
export interface PaymentMethod {
  /** Display name of payment method */
  name: string
  /** Payment method type identifier */
  type: string
  /** Legacy optional color for UI display */
  color?: string
  /** Minimum topup amount for this payment method */
  min_topup?: number
  /** Optional react-icons component name or safe icon URL */
  icon?: string
  /**
   * CoreCode: on a Stripe method with an epay twin, the CNY price at or below
   * which an order goes through epay instead
   */
  epay_max_money?: number
}

/**
 * Waffo payment method configuration
 */
export interface WaffoPayMethod {
  /** Display name of payment method */
  name: string
  /** Optional icon path */
  icon?: string
  /** Waffo pay method type */
  payMethodType?: string
  /** Waffo pay method name */
  payMethodName?: string
}

/**
 * Topup configuration information
 */
export interface TopupInfo {
  /** Whether online topup is enabled */
  enable_online_topup: boolean
  /** Whether Stripe topup is enabled */
  enable_stripe_topup: boolean
  /** Available payment methods */
  pay_methods: PaymentMethod[]
  /** Minimum topup amount for online topup */
  min_topup: number
  /** Minimum topup amount for Stripe */
  stripe_min_topup: number
  /** Preset amount options */
  amount_options: number[]
  /** Discount rates by amount */
  discount: Record<number, number>
  /** Bonus rates (fractions) by minimum amount; applies to epay topups only */
  bonus?: Record<number, number>
  /** Operator headline for a limited-time bonus; shown above the amounts while set */
  bonus_campaign?: string
  /** Optional topup link for purchasing codes */
  topup_link?: string
  /** Whether Creem topup is enabled */
  enable_creem_topup?: boolean
  /** Available Creem products */
  creem_products?: CreemProduct[]
  /** Whether Waffo topup is enabled */
  enable_waffo_topup?: boolean
  /** Available Waffo payment methods */
  waffo_pay_methods?: WaffoPayMethod[]
  /** Minimum topup amount for Waffo */
  waffo_min_topup?: number
  /** Whether Waffo Pancake topup is enabled */
  enable_waffo_pancake_topup?: boolean
  /** Minimum topup amount for Waffo Pancake */
  waffo_pancake_min_topup?: number
  /** Stablecoin networks offered through NOWPayments; empty when it is off */
  nowpayments_currencies?: NowPaymentsCurrency[]
  /** Whether redemption code usage is enabled */
  enable_redemption?: boolean
  /** Whether compliance confirmation has been completed */
  payment_compliance_confirmed?: boolean
  /** Current compliance terms version */
  payment_compliance_terms_version?: string
  /** The customer's concurrency limit and the tiers that raise it */
  concurrency?: UserConcurrency
}

/**
 * How many requests a customer may run at once across all API keys, and the
 * paid-total tiers that raise it. Amounts are in the payment currency.
 */
export interface UserConcurrency {
  /** Current limit; 0 means unlimited */
  limit: number
  /** "user" for a limit set by an operator, "tier" or "group" otherwise */
  source: 'user' | 'tier' | 'group'
  group_limit: number
  paid_total: number
  /** Empty when the limit cannot be raised by paying */
  tiers: { min_paid: number; limit: number }[]
}

/**
 * Preset amount option with optional discount
 */
export interface PresetAmount {
  /** Preset amount value */
  value: number
  /** Optional discount rate (0-1) */
  discount?: number
}

/**
 * Redemption code request
 */
export interface RedemptionRequest {
  /** Redemption code key */
  key: string
}

/**
 * Payment request parameters
 */
export interface PaymentRequest {
  /** Topup amount */
  amount: number
  /** Payment method identifier */
  payment_method: string
}

/**
 * Waffo payment request parameters
 */
export interface WaffoPaymentRequest {
  /** Topup amount */
  amount: number
  /** Optional server-side Waffo payment method index */
  pay_method_index?: number
}

/**
 * Waffo Pancake payment request parameters
 */
/**
 * A stablecoin on one network, named by its NOWPayments ticker. USDT and USDC
 * are both priced as one US dollar.
 */
export interface NowPaymentsCurrency {
  /** NOWPayments ticker, such as usdttrc20 */
  code: string
  /** USDT or USDC */
  coin: string
  /** Network label, such as TRC20 */
  network: string
}

export interface NowPaymentsPaymentRequest {
  /** Topup amount */
  amount: number
  /** NOWPayments ticker the invoice is paid in */
  pay_currency: string
}

export interface WaffoPancakePaymentRequest {
  /** Topup amount */
  amount: number
}

/**
 * Amount calculation request
 */
export interface AmountRequest {
  /** Topup amount to calculate */
  amount: number
}

/**
 * Affiliate quota transfer request
 */
export interface AffiliateTransferRequest {
  /** Quota amount to transfer */
  quota: number
}

/**
 * User wallet data
 */
export interface UserWalletData {
  /** User ID */
  id: number
  /** Username */
  username: string
  /** Current quota balance */
  quota: number
  /** Total used quota */
  used_quota: number
  /** Total request count */
  request_count: number
  /** Affiliate quota (pending rewards) */
  aff_quota: number
  /** Total affiliate quota earned (historical) */
  aff_history_quota: number
  /** Number of successful affiliate invites */
  aff_count: number
  /** User group */
  group: string
}

/**
 * Topup record status
 */
export type TopupStatus = 'success' | 'pending' | 'failed' | 'expired'

/**
 * Topup billing record
 */
export interface TopupRecord {
  /** Record ID */
  id: number
  /** User ID */
  user_id: number
  /** Topup amount (quota) */
  amount: number
  /** Bonus quota credited on top of the payment (0 when none) */
  bonus_quota?: number
  /** Payment amount (actual money paid) */
  money: number
  /** Trade/order number */
  trade_no: string
  /** Payment method type */
  payment_method: string
  /** Creation timestamp */
  create_time: number
  /** Completion timestamp */
  complete_time?: number
  /** Payment status */
  status: TopupStatus
}

/**
 * Billing history response
 */
export interface BillingHistoryResponse {
  items: TopupRecord[]
  total: number
}

/**
 * Complete order request (admin only)
 */
export interface CompleteOrderRequest {
  trade_no: string
}

// ============================================================================
// Invitation commission (affiliate) program
// ============================================================================

/**
 * A promotion channel's tier; empty for an ordinary inviter. Both tiers
 * withdraw cash and their invitees receive the tier's gift plan at sign-up;
 * only a distributor earns second-level commission.
 */
export type AffiliateTier = '' | 'retail' | 'distributor'

/** The user's affiliate account. Amounts are quota units. */
export interface AffiliateAccount {
  id: number
  user_id: number
  /** Commission rate in percent */
  rate: number
  /** Promotion channel of either tier: cash withdrawals */
  channel: boolean
  tier: AffiliateTier
  granted_by: number
  balance: number
  earned: number
  created_at: number
  updated_at: number
}

/** GET /api/affiliate/self */
export interface AffiliateSummary {
  enabled: boolean
  self_serve_rate: number
  second_level_rate: number
  /** Minimum withdrawal, in payment currency */
  min_withdrawal: number
  affiliate: AffiliateAccount | null
  /** Non-empty only when affiliate.rate > 0 */
  aff_code: string
  invitee_count: number
  balance_money: number
  earned_money: number
}

/**
 * GET /api/affiliate/admin/users/:id. Here aff_code is the user's code
 * whatever their rate.
 */
export interface AffiliateAdminView extends AffiliateSummary {
  max_rate: number
  inviter_id: number
  inviter_name: string
}

export interface AffiliateCommission {
  id: number
  user_id: number
  source_user_id: number
  /** Masked name of the invitee the commission came from */
  source_name: string
  level: 1 | 2
  rate: number
  /** Consumed quota the commission was computed from */
  base: number
  amount: number
  created_at: number
}

export type AffiliateWithdrawalStatus = 'pending' | 'paid' | 'rejected'

export interface AffiliateWithdrawal {
  id: number
  user_id: number
  quota: number
  /** Payout amount in payment currency */
  money: number
  account: string
  status: AffiliateWithdrawalStatus
  note: string
  created_at: number
  processed_at: number
  processed_by: number
}

export interface AffiliatePage<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface AffiliatePageParams {
  p: number
  page_size: number
}

export interface AffiliateWithdrawRequest {
  quota: number
  account: string
}
