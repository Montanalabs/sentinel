import { PostgresRevocationStore } from './revocation-postgres.js';
import { revocationStoreContract } from './revocation-contract.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;

// Integration test: requires a reachable Postgres. Run via `npm run test:int`.
if (!url) {
  // eslint-disable-next-line no-console
  console.warn('SENTINEL_TEST_DATABASE_URL not set — skipping PostgresRevocationStore integration test');
} else {
  revocationStoreContract('PostgresRevocationStore', async () => PostgresRevocationStore.connect(url, { reset: true }));
}
