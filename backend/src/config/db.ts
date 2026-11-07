import mongoose from 'mongoose';
import { env } from './env';

/** How long the driver looks for a server before failing; its 30s default would leave requests hanging. */
const SERVER_SELECTION_TIMEOUT_MS = 5000;
const MAX_RETRY_DELAY_MS = 30_000;

const safeUri = env.mongoUri.replace(/\/\/[^@/]+@/, '//');
let retrying = true;
let wasConnected = false;

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

/** Makes one attempt to connect. Use connectWithRetry for a long-running server. */
export async function connectDatabase(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS });
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
