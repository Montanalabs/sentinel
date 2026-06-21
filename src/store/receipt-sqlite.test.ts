import { SqliteReceiptStore } from './receipt-sqlite.js';
import { receiptStoreContract } from './receipt-contract.js';

receiptStoreContract('sqlite (:memory:)', async () => SqliteReceiptStore.open(':memory:', { reset: true }));
