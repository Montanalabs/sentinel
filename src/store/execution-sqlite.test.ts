import { SqliteExecutionReceiptStore } from './execution-sqlite.js';
import { executionStoreContract } from './execution-contract.js';

executionStoreContract('sqlite (:memory:)', async () => SqliteExecutionReceiptStore.open(':memory:', { reset: true }));
