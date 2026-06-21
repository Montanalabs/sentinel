import { PostgresExecutionReceiptStore } from './execution-postgres.js';
import { executionStoreContract } from './execution-contract.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;

// Integration test: requires a reachable Postgres. Run via `npm run test:int`.
if (!url) {
  // eslint-disable-next-line no-console
  console.warn('SENTINEL_TEST_DATABASE_URL not set — skipping PostgresExecutionReceiptStore integration test');
} else {
  executionStoreContract('PostgresExecutionReceiptStore', async () => PostgresExecutionReceiptStore.connect(url, { reset: true }));
}
