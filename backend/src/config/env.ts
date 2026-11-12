import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';

function required(key: string, devFallback?: string, fromEnv = process.env[key]): string {
  const value = fromEnv ?? (nodeEnv === 'production' ? undefined : devFallback);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/** Vercel sets VERCEL=1 in its builds and functions. */
const onVercel = !!process.env.VERCEL;

/** Trims spaces, line breaks and wrapping quotes that are easy to paste into a hosting dashboard by mistake. */
const cleanUri = (value?: string) =>
  value
    ?.trim()
    .replace(/^(['"])(.*)\1$/, '$2')
    .trim() || undefined;
const mongoUriFromEnv = cleanUri(process.env.MONGO_URI);

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  onVercel,
  port: Number(process.env.PORT ?? 5000),
  // On Vercel there is no local MongoDB to fall back to, so a missing MONGO_URI is reported by /api/health instead.
  mongoUri: onVercel ? (mongoUriFromEnv ?? '') : required('MONGO_URI', 'mongodb://127.0.0.1:27017/p2p', mongoUriFromEnv),
  /** Whether MONGO_URI came from the environment rather than the local development default */
  mongoUriFromEnv: !!mongoUriFromEnv,
  // Never the public development secret on Vercel: without JWT_SECRET, sign-in fails and /api/health says so.
  jwtSecret: onVercel ? (process.env.JWT_SECRET ?? '') : required('JWT_SECRET', 'dev-only-insecure-secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  companyGstin: process.env.COMPANY_GSTIN ?? '27AABCU9603R1ZM',
  matchPriceTolerancePct: Number(process.env.MATCH_PRICE_TOLERANCE_PCT ?? 2),
  internalSignupCode: process.env.INTERNAL_SIGNUP_CODE,
  /** Stock expiring within this many days shows on the near-expiry report */
  nearExpiryDays: Number(process.env.NEAR_EXPIRY_DAYS ?? 90),
  /** Largest pre-tax value of a PO raised through the emergency route, without an RFQ */
  emergencyPoCap: Number(process.env.EMERGENCY_PO_CAP ?? 100_000),
  /** Bank or payment gateway. Without a URL, payments are simulated outside production and refused in it. */
  bankApiUrl: process.env.BANK_API_URL,
  bankApiKey: process.env.BANK_API_KEY,
  bankWebhookSecret: process.env.BANK_WEBHOOK_SECRET,
  bankTimeoutMs: Number(process.env.BANK_TIMEOUT_MS ?? 15_000),
};
