import { test, expect, describe } from 'vitest';
import { OpenAIProvider, type OpenAILike } from './openai.js';
import { Action } from '../core/action.js';

const req = { action: Action.payment({ amount: 42000, from: 'a', to: 'b' }), context: { runId: 'r1' }, question: 'ok?' };

describe('OpenAIProvider', () => {
  test('name is openai', () => {
    expect(new OpenAIProvider({ client: {} as OpenAILike }).name).toBe('openai');
  });

  test('calls chat completions with the model and parses the JSON verdict', async () => {
    let model = '';
    const client: OpenAILike = {
      chat: {
        completions: {
          create: async (args) => {
            model = args.model;
            return { choices: [{ message: { content: '{"agree": true, "confidence": 0.95}' } }] };
          },
        },
      },
    };
    const v = await new OpenAIProvider({ client, model: 'gpt-5.5' }).secondOpinion(req);
    expect(v).toMatchObject({ agree: true, confidence: 0.95 });
    expect(model).toBe('gpt-5.5');
  });

  test('throws a clear error when the response has no content', async () => {
    const client: OpenAILike = {
      chat: { completions: { create: async () => ({ choices: [{ message: { content: null } }] }) } },
    };
    await expect(new OpenAIProvider({ client }).secondOpinion(req)).rejects.toThrow();
  });
});
