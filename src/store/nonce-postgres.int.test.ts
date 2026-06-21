import { PostgresNonceStore } from './nonce-postgres.js';
import { nonceStoreContract } from './nonce-contract.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;

// Integration test: requires a reachable Postgres. Run via `npm run test:int`.
if (!url) {
  // eslint-disable-next-line no-console
  console.warn('SENTINEL_TEST_DATABASE_URL not set — skipping PostgresNonceStore integration test');
} else {
  nonceStoreContract('PostgresNonceStore', async () => PostgresNonceStore.connect(url, { reset: true }));
}
