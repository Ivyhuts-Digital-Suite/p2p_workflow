import mongoose from 'mongoose';
import { env } from './env';

/** How long the driver looks for a server before failing; its 30s default would leave requests hanging. */
const SERVER_SELECTION_TIMEOUT_MS = 5000;
const MAX_RETRY_DELAY_MS = 30_000;

const safeUri = env.mongoUri.replace(/\/\/[^@/]+@/, '//');
let retrying = true;
let wasConnected = false;
/** The most recent failure to connect, kept for /api/health. Credentials are removed from the message. */
let lastError: { name: string; message: string; at: Date } | null = null;

// Once connected, the driver reconnects by itself after an outage; these only report it.
mongoose.connection.on('disconnected', () => {
  if (wasConnected) console.error('[db] lost connection to MongoDB; requests get a 503 until it returns');
  wasConnected = false;
});
mongoose.connection.on('connected', () => {
  wasConnected = true;
  console.log(`[db] connected to ${mongoose.connection.host}/${mongoose.connection.name}`);
});
mongoose.connection.on('error', (err) => console.error('[db] connection error:', err.message));

export const isDatabaseConnected = () => mongoose.connection.readyState === mongoose.ConnectionStates.connected;

/** Makes one attempt to connect, waiting up to `timeoutMs` for a server. Use connectWithRetry for a long-running server. */
export async function connectDatabase(timeoutMs = SERVER_SELECTION_TIMEOUT_MS): Promise<void> {
  mongoose.set('strictQuery', true);
  try {
    if (!env.mongoUri) throw Object.assign(new Error('MONGO_URI is not set in this environment'), { name: 'ConfigurationError' });
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: timeoutMs });
    lastError = null;
  } catch (err) {
    const { name, message } = err as Error;
    lastError = { name, message: message.replace(/\/\/[^@/\s]+@/g, '//'), at: new Date() };
    throw err;
  }
}

/** A plain-language pointer for the most likely cause of a failed connection. */
function hintFor(message: string): string | undefined {
  if (!env.mongoUri) return 'Add MONGO_URI in Vercel > Settings > Environment Variables for this environment (Production and/or Preview), then redeploy.';
  if (/127\.0\.0\.1|localhost/.test(env.mongoUri) && env.onVercel) return 'MONGO_URI points at this machine; use your MongoDB Atlas connection string.';
  if (/whitelist|IP that isn't|not allowed to access/i.test(message)) return "Atlas is refusing this server's address: in Atlas > Network Access, allow 0.0.0.0/0.";
  if (/authentication failed|bad auth|auth failed/i.test(message)) return 'Atlas rejected the username or password in MONGO_URI. Check them, and URL-encode special characters in the password (@ : / ? # %).';
  if (/ENOTFOUND|querySrv|getaddrinfo|EAI_AGAIN/i.test(message)) return 'The host name in MONGO_URI could not be found. Copy the connection string again from Atlas > Connect.';
  if (/timed out|ETIMEDOUT|Server selection/i.test(message)) return 'No reply from MongoDB. Check Atlas > Network Access allows 0.0.0.0/0 and that the cluster is not paused.';
  return undefined;
}

const STATE_NAMES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

/** What /api/health reports: where the server is connecting, and why it last failed. Never includes credentials. */
export function databaseStatus() {
  let host: string | null = null;
  let database: string | null = null;
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)\/?([^?]*)/.exec(env.mongoUri);
  if (match) {
    host = match[1].split(',')[0];
    database = match[2] || null;
  }
  return {
    state: STATE_NAMES[mongoose.connection.readyState] ?? 'unknown',
    mongoUriSet: env.mongoUriFromEnv,
    host,
    database,
    lastError: lastError && { ...lastError, hint: hintFor(lastError.message) },
  };
}

/** The driver does not retry a failed first connection, so this keeps trying until one succeeds. */
export async function connectWithRetry(onConnected: () => Promise<void>): Promise<void> {
  let delay = 2000;
  while (retrying) {
    try {
      await connectDatabase();
      await onConnected();
      return;
    } catch (err) {
      console.error(
        `[db] cannot reach MongoDB at ${safeUri}: ${(err as Error).message}. Retrying in ${delay / 1000}s. ` +
          'In development, start it with "npm run dev" or "npm run db".',
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
    }
  }
}

export async function disconnectDatabase(): Promise<void> {
  retrying = false;
  await mongoose.disconnect();
}
