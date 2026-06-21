import { test, expect, describe } from 'vitest';
import { buildServer, type SidecarDeps } from './server.js';
import { EscalationManager } from './escalation.js';
import { Engine } from '../engine/engine.js';
import { InMemoryStore } from '../store/memory.js';
import { RecordBuilder } from '../provenance/record.js';
import { Signer } from '../provenance/signing.js';
import { Action } from '../core/action.js';
import { Verdict, CheckOutcome } from '../core/types.js';
import { CheckTier } from '../checks/types.js';
import type { Check } from '../checks/types.js';

const allow: Check = { name: 'allow', tier: CheckTier.Fast, run: async () => ({ check: 'allow', outcome: CheckOutcome.Pass, verdict: Verdict.Allow }) };

function makeApp(opts: Partial<SidecarDeps>, checks: Check[] = [allow]) {
  const store = new InMemoryStore();
  const builder = new RecordBuilder(Signer.fromSeed(Buffer.alloc(32, 161)));
  const engine = new Engine({ resolve: () => checks, builder, store });
  return buildServer({ engine, store, escalations: new EscalationManager(), builder, ...opts });
}

const guard = { action: Action.payment({ amount: 1, from: 'a', to: 'b' }), context: { runId: 'r' }, policy: 'p' };

describe('rate limiting', () => {
  test('returns 429 once the token bucket is exhausted', async () => {
    const app = makeApp({ rateLimit: { capacity: 2, refillPerSec: 0 } });
    expect((await app.inject({ method: 'GET', url: '/v1/records' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/records' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/records' })).statusCode).toBe(429);
  });

  test('does not rate-limit /healthz', async () => {
    const app = makeApp({ rateLimit: { capacity: 1, refillPerSec: 0 } });
    await app.inject({ method: 'GET', url: '/v1/records' }); // consume the one token
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
  });
});

describe('backpressure', () => {
  test('returns 503 when concurrent in-flight requests exceed the cap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Check = {
      name: 'slow',
      tier: CheckTier.Fast,
      run: async () => {
        await gate;
        return { check: 'slow', outcome: CheckOutcome.Pass, verdict: Verdict.Allow };
      },
    };
    const app = makeApp({ maxConcurrent: 1 }, [slow]);

    const p1 = app.inject({ method: 'POST', url: '/v1/guard', payload: guard });
    await new Promise((r) => setImmediate(r)); // let p1 acquire the slot and enter the handler
    const r2 = await app.inject({ method: 'POST', url: '/v1/guard', payload: guard });
    expect(r2.statusCode).toBe(503);

    release();
    const r1 = await p1;
    expect(r1.statusCode).toBe(200);

    // slot is freed again afterwards
    const r3 = await app.inject({ method: 'POST', url: '/v1/guard', payload: { ...guard, action: Action.payment({ amount: 2, from: 'a', to: 'b' }) } });
    expect(r3.statusCode).toBe(200);
  });
});
