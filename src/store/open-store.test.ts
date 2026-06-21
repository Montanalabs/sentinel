import { test, expect, describe } from 'vitest';
import { openStore } from './open-store.js';
import { InMemoryStore } from './memory.js';
import { SqliteStore } from './sqlite.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { Verdict } from '../core/types.js';

const rec = () =>
  new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 5))).append(
    { action: Action.payment({ amount: 1, from: 'a', to: 'b' }), context: { runId: 'r' }, checks: [], verdict: Verdict.Allow },
    '2026-06-20T00:00:00.000Z',
  );

describe('openStore', () => {
  test('memory / undefined -> InMemoryStore', async () => {
    expect(await openStore('memory')).toBeInstanceOf(InMemoryStore);
    expect(await openStore()).toBeInstanceOf(InMemoryStore);
  });

  test('sqlite::memory: -> a working SqliteStore', async () => {
    const store = await openStore('sqlite::memory:');
    expect(store).toBeInstanceOf(SqliteStore);
    await store.append(rec());
    expect(await store.list()).toHaveLength(1);
    await store.close();
  });

  test('rejects an unsupported URL', async () => {
    await expect(openStore('mysql://nope')).rejects.toThrow();
  });
});
