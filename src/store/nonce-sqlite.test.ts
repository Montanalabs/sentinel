import { SqliteNonceStore } from './nonce-sqlite.js';
import { nonceStoreContract } from './nonce-contract.js';

nonceStoreContract('sqlite (:memory:)', async () => SqliteNonceStore.open(':memory:', { reset: true }));
