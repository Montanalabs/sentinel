import { PostgresStore } from './postgres.js';
import { storeContract } from './contract.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;

// Integration test: requires a reachable Postgres. Run via `npm run test:int`.
if (!url) {
  // eslint-disable-next-line no-console
  console.warn('SENTINEL_TEST_DATABASE_URL not set — skipping PostgresStore integration test');
} else {
  storeContract('PostgresStore', async () => PostgresStore.connect(url, { reset: true }));
}
