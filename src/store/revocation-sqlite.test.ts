import { SqliteRevocationStore } from './revocation-sqlite.js';
import { revocationStoreContract } from './revocation-contract.js';

revocationStoreContract('sqlite (:memory:)', async () => SqliteRevocationStore.open(':memory:', { reset: true }));
