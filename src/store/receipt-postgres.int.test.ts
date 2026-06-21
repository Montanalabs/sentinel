import { PostgresReceiptStore } from './receipt-postgres.js';
import { receiptStoreContract } from './receipt-contract.js';

const url = process.env.SENTINEL_TEST_DATABASE_URL;

// Integration test: requires a reachable Postgres. Run via `npm run test:int`.
if (!url) {
  // eslint-disable-next-line no-console
  console.warn('SENTINEL_TEST_DATABASE_URL not set — skipping PostgresReceiptStore integration test');
} else {
  receiptStoreContract('PostgresReceiptStore', async () => PostgresReceiptStore.connect(url, { reset: true }));
}
