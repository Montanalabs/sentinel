import { test, expect, describe } from 'vitest';
import { DataBoundaryCheck } from './boundary.js';
import { Action } from '../core/action.js';

const policy = {
  piiFields: ['action.payload.ssn', 'action.payload.dob'],
  allowedProviders: ['anthropic'],
  allowedRegions: ['EU'],
};

describe('DataBoundaryCheck', () => {
  const check = new DataBoundaryCheck(policy);

  test('name and tier', () => {
    expect(check.name).toBe('data-boundary');
    expect(check.tier).toBe('fast');
  });

  test('allows when no PII is present, even on an uncleared provider', async () => {
    const r = await check.run({
      action: Action.of('record_update', { note: 'hello' }, { meta: { region: 'US' } }),
      context: { runId: 'r1', provider: 'openai' },
    });
    expect(r.verdict).toBe('ALLOW');
  });

  test('blocks PII going to a non-cleared provider', async () => {
    const r = await check.run({
      action: Action.of('record_update', { ssn: '123-45-6789' }, { meta: { region: 'EU' } }),
      context: { runId: 'r1', provider: 'openai' },
    });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reason).toMatch(/provider/);
    expect(r.details?.piiPresent).toEqual(['action.payload.ssn']);
  });

  test('blocks PII destined for a non-cleared region', async () => {
    const r = await check.run({
      action: Action.of('record_update', { dob: '1990-01-01' }, { meta: { region: 'US' } }),
      context: { runId: 'r1', provider: 'anthropic' },
    });
    expect(r.verdict).toBe('BLOCK');
    expect(r.reason).toMatch(/region/);
  });

  test('allows PII within cleared provider and region', async () => {
    const r = await check.run({
      action: Action.of('record_update', { ssn: '123-45-6789' }, { meta: { region: 'EU' } }),
      context: { runId: 'r1', provider: 'anthropic' },
    });
    expect(r.verdict).toBe('ALLOW');
  });

  test('ignores empty/absent PII field values', async () => {
    const r = await check.run({
      action: Action.of('record_update', { ssn: '' }, { meta: { region: 'US' } }),
      context: { runId: 'r1', provider: 'openai' },
    });
    expect(r.verdict).toBe('ALLOW');
  });
});
