import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV ?? 'development';

function required(key: string, devFallback?: string): string {
  const value = process.env[key] ?? (nodeEnv === 'production' ? undefined : devFallback);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT ?? 5000),
  mongoUri: required('MONGO_URI', 'mongodb://127.0.0.1:27017/p2p'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
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
