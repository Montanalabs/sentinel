import { test, expect, describe } from 'vitest';
import { buildSecondOpinionPrompt, parseVerdictJson } from './prompt.js';
import { Action } from '../core/action.js';

describe('buildSecondOpinionPrompt', () => {
  test('includes the action, payload values, and the question, and asks for JSON', () => {
    const p = buildSecondOpinionPrompt({
      action: Action.payment({ amount: 42000, from: 'a', to: 'b' }),
      context: { runId: 'r1' },
      question: 'Is this payment consistent with the user request?',
    });
    expect(p).toContain('payment');
    expect(p).toContain('42000');
    expect(p).toContain('Is this payment consistent');
    expect(p).toMatch(/JSON/i);
    expect(p).toMatch(/agree/);
  });
});

describe('parseVerdictJson', () => {
  test('parses a clean JSON object', () => {
    expect(parseVerdictJson('{"agree": true, "confidence": 0.9, "rationale": "ok"}')).toEqual({
      agree: true,
      confidence: 0.9,
      rationale: 'ok',
    });
  });

  test('parses JSON inside markdown code fences', () => {
    const text = 'Here is my analysis:\n```json\n{"agree": false, "rationale": "amount mismatch"}\n```\n';
    expect(parseVerdictJson(text)).toMatchObject({ agree: false, rationale: 'amount mismatch' });
  });

  test('parses JSON embedded in surrounding prose', () => {
    const text = 'I think this is fine. {"agree": true} Let me know if you need more.';
    expect(parseVerdictJson(text)).toMatchObject({ agree: true });
  });

  test('coerces agree strictly: only literal true / "true" agree, everything else fails safe', () => {
    expect(parseVerdictJson('{"agree": true}').agree).toBe(true);
    expect(parseVerdictJson('{"agree": "true"}').agree).toBe(true);
    expect(parseVerdictJson('{"agree": false}').agree).toBe(false);
    // Ambiguous / non-conforming values must NOT be coerced into agreement (fail-safe).
    expect(parseVerdictJson('{"agree": "yes"}').agree).toBe(false);
    expect(parseVerdictJson('{"agree": "approved"}').agree).toBe(false);
    expect(parseVerdictJson('{"agree": 1}').agree).toBe(false);
    expect(parseVerdictJson('{"agree": {}}').agree).toBe(false);
  });

  test('throws when no JSON object is present', () => {
    expect(() => parseVerdictJson('I am not sure, sorry.')).toThrow();
  });
});
