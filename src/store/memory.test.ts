import { InMemoryStore } from './memory.js';
import { storeContract } from './contract.js';

storeContract('InMemoryStore', async () => new InMemoryStore());
