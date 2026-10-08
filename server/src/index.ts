import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { startScheduler, stopScheduler, backfillEmbeddings } from './jobs/scheduler.js';
import { logger } from './lib/logger.js';
import { ensureDefaultPolicies } from './services/sla.js';
import { attachSockets } from './sockets/index.js';

async function main() {
  await mongoose.connect(env.MONGO_URI);
  await mongoose.connection.syncIndexes();
  await ensureDefaultPolicies();
  logger.info('connected to MongoDB');

  const server = createServer(createApp());
  const io = attachSockets(server);
  server.listen(env.PORT, () => logger.info(`TriageX API listening on :${env.PORT}`));

  startScheduler();
  void backfillEmbeddings().catch(() => undefined);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    await io.close();
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
