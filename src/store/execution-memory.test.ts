import { InMemoryExecutionReceiptStore } from './execution-memory.js';
import { executionStoreContract } from './execution-contract.js';

executionStoreContract('in-memory', async () => new InMemoryExecutionReceiptStore());
