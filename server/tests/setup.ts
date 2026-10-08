import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

// Must be set before any src module reads the environment.
process.env.NODE_ENV = 'test';
process.env.ML_URL = 'http://127.0.0.1:9'; // unreachable -> exercises the fallback path by default
process.env.ML_TIMEOUT_MS = '300';
process.env.ENABLE_SCHEDULER = 'false';
process.env.ALERT_INGEST_KEY = 'test-alert-key';

beforeAll(async () => {
  const base = inject('mongoUri');
  const dbName = `triagex_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await mongoose.connect(base, { dbName });
  const { ensureDefaultPolicies } = await import('../src/services/sla.js');
  await mongoose.connection.syncIndexes();
  await ensureDefaultPolicies();
});

beforeEach(async () => {
  const { flushAudit } = await import('../src/services/audit.js');
  await flushAudit();
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.filter((c) => c.collectionName !== 'slapolicies').map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
