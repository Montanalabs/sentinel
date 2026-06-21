import { test, expect, describe, beforeEach } from 'vitest';
import { EscalationManager, EscalationStatus } from './escalation.js';
import { Action } from '../core/action.js';

const action = Action.payment({ amount: 50000, from: 'a', to: 'b' });

describe('EscalationManager', () => {
  let mgr: EscalationManager;
  let notified: string[];

  beforeEach(() => {
    notified = [];
    let t = 0;
    mgr = new EscalationManager({
      notify: async (e) => {
        notified.push(e.id);
      },
      now: () => `2026-06-13T00:00:0${t++}.000Z`,
    });
  });

  test('create returns a pending escalation and notifies', async () => {
    const e = await mgr.create({ recordId: 'rec_1', action, approvers: ['treasury_ops'], reason: 'high value' });
    expect(e.status).toBe(EscalationStatus.Pending);
    expect(e.id).toMatch(/^esc_/);
    expect(e.approvers).toEqual(['treasury_ops']);
    expect(notified).toEqual([e.id]);
  });

  test('list filters by status', async () => {
    const a = await mgr.create({ recordId: 'r1', action });
    await mgr.create({ recordId: 'r2', action });
    await mgr.resolve(a.id, { decision: 'approve', approver: 'u1' });
    expect(mgr.list(EscalationStatus.Pending)).toHaveLength(1);
    expect(mgr.list(EscalationStatus.Approved)).toHaveLength(1);
    expect(mgr.list()).toHaveLength(2);
  });

  test('resolve approve transitions to approved and records who/when', async () => {
    const e = await mgr.create({ recordId: 'r1', action });
    const resolved = await mgr.resolve(e.id, { decision: 'approve', approver: 'treasurer_jane' });
    expect(resolved.status).toBe(EscalationStatus.Approved);
    expect(resolved.resolvedBy).toBe('treasurer_jane');
    expect(resolved.resolvedAt).toBeDefined();
  });

  test('resolve deny transitions to denied', async () => {
    const e = await mgr.create({ recordId: 'r1', action });
    expect((await mgr.resolve(e.id, { decision: 'deny', approver: 'u' })).status).toBe(EscalationStatus.Denied);
  });

  test('resolving an unknown escalation throws', async () => {
    await expect(mgr.resolve('esc_nope', { decision: 'approve', approver: 'u' })).rejects.toThrow();
  });

  test('resolving an already-resolved escalation throws', async () => {
    const e = await mgr.create({ recordId: 'r1', action });
    await mgr.resolve(e.id, { decision: 'approve', approver: 'u' });
    await expect(mgr.resolve(e.id, { decision: 'deny', approver: 'u2' })).rejects.toThrow();
  });

  test('a failing notifier does not prevent escalation creation', async () => {
    const m = new EscalationManager({
      notify: async () => {
        throw new Error('webhook down');
      },
    });
    const e = await m.create({ recordId: 'r1', action });
    expect(e.status).toBe(EscalationStatus.Pending);
  });
});
