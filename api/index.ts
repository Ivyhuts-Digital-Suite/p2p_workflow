/**
 * The backend as a Vercel function: every /api request is routed here (see vercel.json).
 * Local development and `npm start` use backend/src/server.ts instead.
 */
import express from 'express';
import type { RequestHandler } from 'express';
import { createApp } from '../backend/src/app';
import { connectDatabase, isDatabaseConnected } from '../backend/src/config/db';
import { migrateDatabase } from '../backend/src/seed/migrate';

/** One connection and one migration run per instance, shared by concurrent requests. */
let ready: Promise<void> | null = null;

const connectOnce: RequestHandler = async (_req, _res, next) => {
  if (!isDatabaseConnected()) {
    ready ??= connectDatabase().then(migrateDatabase);
    try {
      await ready;
    } catch (err) {
      // Let the next request try again. This one gets the usual 503 from requireDatabase.
      ready = null;
      console.error('[db] cannot reach MongoDB:', (err as Error).message);
    }
  }
  next();
};

const app = express();
app.use(connectOnce);
app.use(createApp());

export default app;
