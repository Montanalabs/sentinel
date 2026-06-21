import { test, expect, describe } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { Action } from '../core/action.js';

// Live API integration. Runs only when the corresponding key is present.
// `npm run test:int` with ANTHROPIC_API_KEY / OPENAI_API_KEY set.
const req = {
  action: Action.payment({ amount: 100, from: 'acct_1', to: 'acct_2', currency: 'USD' }),
  context: { runId: 'live_1' },
  question: 'Is a $100 USD transfer between two internal accounts reasonable to execute?',
};

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('AnthropicProvider (live)', () => {
  test('returns a boolean agreement from the real model', async () => {
    const v = await new AnthropicProvider({
      ...(process.env.SENTINEL_SECOND_OPINION_MODEL ? { model: process.env.SENTINEL_SECOND_OPINION_MODEL } : {}),
    }).secondOpinion(req);
    expect(typeof v.agree).toBe('boolean');
  });
});

describe.runIf(!!process.env.OPENAI_API_KEY)('OpenAIProvider (live)', () => {
  test('returns a boolean agreement from the real model', async () => {
    const v = await new OpenAIProvider({}).secondOpinion(req);
    expect(typeof v.agree).toBe('boolean');
  });
});

// Ensure the file always has at least one test so the runner does not error.
test('live provider int harness loaded', () => {
  expect(true).toBe(true);
});
