import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { PAYMENT_MODE, PaymentMode } from '../constants/status';
import { ApiError } from '../utils/ApiError';

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const RTGS_MINIMUM = 200000;

export interface TransferRequest {
  amount: number;
  mode: PaymentMode;
  /** Unique per attempt; sent as the idempotency key so a repeated call cannot pay twice */
  reference: string;
  beneficiaryName: string;
  accountNumber: string;
  ifsc: string;
}

export interface TransferResult {
  /** PROCESSING: the bank has it, or the outcome is unknown. Never treat that as failed and pay again. */
  status: 'SUCCESS' | 'PROCESSING' | 'FAILED';
  utr?: string;
  failureReason?: string;
  simulated?: boolean;
}

/** Refuses a release that can never go through, before the payment changes state. */
export function assertTransferAllowed(amount: number, mode: PaymentMode) {
  if (mode === PAYMENT_MODE.RTGS && amount < RTGS_MINIMUM) {
    throw ApiError.badRequest(`RTGS requires a minimum of ${RTGS_MINIMUM}; use NEFT/IMPS`);
  }
  if (!env.bankApiUrl && env.isProduction) {
    throw new ApiError(503, 'No bank is configured (BANK_API_URL), so payments cannot be released');
  }
}

interface BankResponse {
  status?: string;
  utr?: string;
  failureReason?: string;
  message?: string;
}

function toResult(body: BankResponse): TransferResult {
  const status = String(body.status ?? '').toUpperCase();
  if (status === 'SUCCESS') return { status: 'SUCCESS', utr: body.utr };
  if (status === 'FAILED') return { status: 'FAILED', failureReason: body.failureReason ?? 'Refused by the bank' };
  return { status: 'PROCESSING' };
}

const bankHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${env.bankApiKey ?? ''}` });

/**
 * Bank integration boundary, written against a generic REST contract (see "Bank integration" in the
 * README). A bank's real API will differ: map it here and in the webhook, and nowhere else.
 */
export async function initiateTransfer(req: TransferRequest): Promise<TransferResult> {
  if (!IFSC_REGEX.test(req.ifsc)) {
    return { status: 'FAILED', failureReason: `Invalid beneficiary IFSC ${req.ifsc}` };
  }
  if (!env.bankApiUrl) {
    // Reached only outside production: assertTransferAllowed refuses it in production.
    return { status: 'SUCCESS', utr: `SIM-${req.mode}${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`, simulated: true };
  }

  let response: Response;
  try {
    response = await fetch(`${env.bankApiUrl}/payouts`, {
      method: 'POST',
      headers: { ...bankHeaders(), 'Idempotency-Key': req.reference },
      body: JSON.stringify({
        reference: req.reference,
        amount: req.amount,
        currency: 'INR',
        mode: req.mode,
        beneficiary: { name: req.beneficiaryName, accountNumber: req.accountNumber, ifsc: req.ifsc },
      }),
      signal: AbortSignal.timeout(env.bankTimeoutMs),
    });
  } catch (err) {
    console.error(`[bank] no answer for ${req.reference}; outcome unknown:`, (err as Error).message);
    return { status: 'PROCESSING' };
  }

  if (response.status >= 500) {
    console.error(`[bank] ${response.status} for ${req.reference}; outcome unknown`);
    return { status: 'PROCESSING' };
  }
  const body = (await response.json().catch(() => ({}))) as BankResponse;
  if (!response.ok) {
    return { status: 'FAILED', failureReason: body.message ?? body.failureReason ?? `Bank refused the transfer (${response.status})` };
  }
  return toResult(body);
}

/** Asks the bank what happened to a transfer. Returns null when it can't say. */
export async function queryTransfer(reference: string): Promise<TransferResult | null> {
  if (!env.bankApiUrl) return null;
  try {
    const response = await fetch(`${env.bankApiUrl}/payouts/${encodeURIComponent(reference)}`, {
      headers: bankHeaders(),
      signal: AbortSignal.timeout(env.bankTimeoutMs),
    });
    if (!response.ok) return null;
    return toResult((await response.json()) as BankResponse);
  } catch (err) {
    console.error(`[bank] status check failed for ${reference}:`, (err as Error).message);
    return null;
  }
}

/** Checks a webhook's HMAC-SHA256 signature (hex) over the exact bytes received. */
export function isValidWebhookSignature(rawBody: Buffer | undefined, signature: unknown): boolean {
  if (!env.bankWebhookSecret || !rawBody || typeof signature !== 'string') return false;
  const expected = createHmac('sha256', env.bankWebhookSecret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
