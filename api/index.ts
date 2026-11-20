/**
 * The backend as a Vercel function: every /api request is routed here (see vercel.json).
 * Local development and `npm start` use backend/src/server.ts instead.
 */
import express from 'express';
import type { RequestHandler } from 'express';
import { createApp } from '../backend/src/app';
import { connectDatabase, isDatabaseConnected } from '../backend/src/config/db';
import { migrateDatabase } from '../backend/src/seed/migrate';

/** One connection attempt and one migration run per instance, shared by concurrent requests. */
let ready: Promise<void> | null = null;
let coldStartDone = false;

/**
 * A new instance's first connection to Atlas starts from nothing on a request, and a slow handshake can
 * miss the usual 5s, so that first connection waits longer and is tried twice before a 503. Every later
 * attempt on the instance (a reconnect, or retrying during an outage) is one ordinary 5s attempt, so
 * requests still fail fast while the database is down.
 */
const COLD_START = { attempts: 2, timeoutMs: 10_000 };

const connectOnce: RequestHandler = async (_req, _res, next) => {
  const cold = !coldStartDone;
  const attempts = cold ? COLD_START.attempts : 1;
  for (let attempt = 1; attempt <= attempts && !isDatabaseConnected(); attempt++) {
    const current = (ready ??= connectDatabase(cold ? COLD_START.timeoutMs : undefined).then(migrateDatabase));
    try {
      await current;
    } catch (err) {
      // Clear only this failed attempt: a concurrent request may already have started the next one.
      if (ready === current) ready = null;
      console.error(`[db] cannot reach MongoDB (attempt ${attempt} of ${attempts}):`, (err as Error).message);
    }
  }
  coldStartDone = true;
  next();
};

const app = express();
app.use(connectOnce);
app.use(createApp());

export default app;
