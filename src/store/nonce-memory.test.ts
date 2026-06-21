import { InMemoryNonceStore } from './nonce-memory.js';
import { nonceStoreContract } from './nonce-contract.js';

nonceStoreContract('in-memory', async () => new InMemoryNonceStore());
