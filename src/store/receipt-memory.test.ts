import { InMemoryReceiptStore } from './receipt-memory.js';
import { receiptStoreContract } from './receipt-contract.js';

receiptStoreContract('in-memory', async () => new InMemoryReceiptStore());
