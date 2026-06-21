import { test, expect, describe } from 'vitest';
import { AnthropicProvider, type AnthropicLike } from './anthropic.js';
import { Action } from '../core/action.js';

const req = { action: Action.payment({ amount: 42000, from: 'a', to: 'b' }), context: { runId: 'r1' }, question: 'ok?' };

describe('AnthropicProvider', () => {
  test('name is anthropic', () => {
    expect(new AnthropicProvider({ client: {} as AnthropicLike }).name).toBe('anthropic');
  });

  test('calls the client with the configured model and parses the JSON verdict', async () => {
    let calledWith: { model?: string; prompt?: string } = {};
    const client: AnthropicLike = {
      messages: {
        create: async (args) => {
          calledWith = { model: args.model, prompt: String(args.messages[0]?.content ?? '') };
          return { content: [{ type: 'text', text: '{"agree": false, "confidence": 0.8, "rationale": "amount too high"}' }] };
        },
      },
    };
    const provider = new AnthropicProvider({ client, model: 'claude-sonnet-4-6' });
    const v = await provider.secondOpinion(req);
    expect(v).toMatchObject({ agree: false, confidence: 0.8, rationale: 'amount too high' });
    expect(calledWith.model).toBe('claude-sonnet-4-6');
    expect(calledWith.prompt).toContain('42000');
  });

  test('concatenates multiple text blocks before parsing', async () => {
    const client: AnthropicLike = {
      messages: {
        create: async () => ({
          content: [
            { type: 'text', text: 'Analysis: ' },
            { type: 'text', text: '{"agree": true}' },
          ],
        }),
      },
    };
    const v = await new AnthropicProvider({ client }).secondOpinion(req);
    expect(v.agree).toBe(true);
  });
});
