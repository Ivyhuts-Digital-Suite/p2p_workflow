import { createApp } from './app';
import { connectWithRetry, disconnectDatabase } from './config/db';
import { env } from './config/env';
import { migrateDatabase } from './seed/migrate';

function bootstrap() {
  // Listen before the database is up, so clients get a clear 503 instead of a refused connection.
  const server = createApp().listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}/api (${env.nodeEnv})`);
  });
  void connectWithRetry(migrateDatabase);

  const shutdown = (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
