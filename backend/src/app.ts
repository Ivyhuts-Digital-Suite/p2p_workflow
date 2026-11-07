import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { auditTrail } from './middleware/auditTrail';
import { errorHandler, notFoundHandler, requireDatabase } from './middleware/errorHandler';
import apiRoutes from './routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(
    express.json({
      limit: '1mb',
      // The bank's webhook signature covers the exact bytes it sent, so keep them.
      verify: (req, _res, buffer) => {
        (req as typeof req & { rawBody?: Buffer }).rawBody = buffer;
      },
    }),
  );
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.use('/api', requireDatabase, auditTrail, apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
