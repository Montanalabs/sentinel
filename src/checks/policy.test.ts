import { test, expect, describe } from 'vitest';
import { PolicyCheck, RuleEffect, type PolicyDefinition } from './policy.js';
import { CompareOp } from './condition.js';
import { CheckTier } from './types.js';
import { Action } from '../core/action.js';
import { Verdict, CheckOutcome, type AgentContext } from '../core/types.js';

const ctx: AgentContext = { runId: 'r1', actor: { id: 'u1', roles: ['analyst'] } };
const run = (def: PolicyDefinition, payload: Record<string, unknown>) =>
  new PolicyCheck(def).run({ action: Action.payment(payload as never), context: ctx });

const HIGH_VALUE: PolicyDefinition = {
  id: 'fintech.payments',
  rules: [
    {
      id: 'deny_sanctioned',
      when: { field: 'action.payload.to', op: CompareOp.In, value: ['acct_sanctioned'] },
      effect: RuleEffect.Block,
      reason: 'counterparty is sanctioned',
    },
    {
      id: 'dual_control_high_value',
      when: { field: 'action.payload.amount', op: CompareOp.Gt, value: 25000 },
      effect: RuleEffect.RequireApproval,
      approvers: ['treasury_ops'],
      reason: 'high-value transfer requires dual control',
    },
  ],
};

describe('PolicyCheck', () => {
  test('name and tier', () => {
    const c = new PolicyCheck(HIGH_VALUE);
    expect(c.name).toBe('policy:fintech.payments');
    expect(c.tier).toBe(CheckTier.Fast);
  });

  test('allows when no rule matches', async () => {
    const r = await run(HIGH_VALUE, { amount: 100, from: 'a', to: 'b' });
    expect(r.verdict).toBe(Verdict.Allow);
    expect(r.outcome).toBe(CheckOutcome.Pass);
  });

  test('blocks on a matching block rule and carries the reason', async () => {
    const r = await run(HIGH_VALUE, { amount: 100, from: 'a', to: 'acct_sanctioned' });
    expect(r.verdict).toBe(Verdict.Block);
    expect(r.outcome).toBe(CheckOutcome.Fail);
    expect(r.reason).toMatch(/sanctioned/);
  });

  test('escalates on require_approval and exposes approvers', async () => {
    const r = await run(HIGH_VALUE, { amount: 50000, from: 'a', to: 'b' });
    expect(r.verdict).toBe(Verdict.Escalate);
    expect(r.outcome).toBe(CheckOutcome.Inconclusive);
    expect(r.details?.approvers).toEqual(['treasury_ops']);
  });

  test('block takes precedence over require_approval when both match', async () => {
    const r = await run(HIGH_VALUE, { amount: 50000, from: 'a', to: 'acct_sanctioned' });
    expect(r.verdict).toBe(Verdict.Block);
  });

  test('deny-by-default: blocks when no rule matches and defaultEffect=block', async () => {
    const def: PolicyDefinition = { id: 'locked', defaultEffect: RuleEffect.Block, rules: [] };
    const r = await run(def, { amount: 1, from: 'a', to: 'b' });
    expect(r.verdict).toBe(Verdict.Block);
  });

  test('reports matched rule ids in details', async () => {
    const r = await run(HIGH_VALUE, { amount: 50000, from: 'a', to: 'b' });
    expect(r.details?.matchedRules).toEqual(['dual_control_high_value']);
  });
});
