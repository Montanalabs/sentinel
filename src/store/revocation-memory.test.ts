import { InMemoryRevocationStore } from '../protocol/revocation-store.js';
import { revocationStoreContract } from './revocation-contract.js';

revocationStoreContract('in-memory', async () => new InMemoryRevocationStore());
