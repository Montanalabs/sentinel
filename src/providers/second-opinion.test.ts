import { test, expect, describe } from 'vitest';
import { SecondOpinionCheck } from './second-opinion.js';
import { MockProvider } from './mock.js';
import { Action } from '../core/action.js';
import type { Provider } from './types.js';

const input = { action: Action.payment({ amount: 100, from: 'a', to: 'b' }), context: { runId: 'r1' } };

describe('SecondOpinionCheck', () => {
  test('name and slow tier', () => {
    const c = new SecondOpinionCheck({ provider: new MockProvider(), question: 'ok?' });
    expect(c.name).toBe('second-opinion:mock');
    expect(c.tier).toBe('slow');
  });

  test('ALLOW when the independent model agrees', async () => {
    const c = new SecondOpinionCheck({ provider: new MockProvider(() => ({ agree: true, confidence: 0.9 })), question: 'ok?' });
    const r = await c.run(input);
    expect(r.verdict).toBe('ALLOW');
    expect(r.details?.confidence).toBe(0.9);
  });

  test('ESCALATE when the independent model disagrees', async () => {
    const c = new SecondOpinionCheck({
      provider: new MockProvider(() => ({ agree: false, rationale: 'looks wrong' })),
      question: 'ok?',
    });
    const r = await c.run(input);
    expect(r.verdict).toBe('ESCALATE');
    expect(r.reason).toMatch(/looks wrong/);
  });

  test('ESCALATE (fail-safe) when the provider throws', async () => {
    const broken: Provider = {
      name: 'broken',
      secondOpinion: async () => {
        throw new Error('429 rate limited');
      },
    };
    const c = new SecondOpinionCheck({ provider: broken, question: 'ok?' });
    const r = await c.run(input);
    expect(r.verdict).toBe('ESCALATE');
    expect(r.outcome).toBe('inconclusive');
    expect(r.reason).toMatch(/rate limited|provider/i);
  });

  test('supports a question builder function', async () => {
    let seen = '';
    const provider: Provider = {
      name: 'spy',
      secondOpinion: async (req) => {
        seen = req.question;
        return { agree: true };
      },
    };
    const c = new SecondOpinionCheck({ provider, question: (i) => `check ${i.action.type}` });
    await c.run(input);
    expect(seen).toBe('check payment');
  });
});

describe('MockProvider', () => {
  test('agrees by default and is deterministic', async () => {
    const p = new MockProvider();
    const r = await p.secondOpinion({ ...input, question: 'q' });
    expect(r.agree).toBe(true);
  });
});
