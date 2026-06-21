import { SqliteStore } from './sqlite.js';
import { storeContract } from './contract.js';

// Runs the full ProvenanceStore contract against an in-memory SQLite db (fresh per test).
storeContract('SqliteStore', async () => SqliteStore.open(':memory:'));
