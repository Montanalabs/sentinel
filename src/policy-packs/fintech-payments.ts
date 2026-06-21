/**
 * Built-in `fintech.payments` policy pack.
 *
 * Assembles the checks that gate a payment-authorization action: payload schema validation,
 * dual-control sign-off above a value threshold, static and ledger-backed sanctioned-counterparty
 * denial, balance reconciliation, and an optional cross-model second opinion. The slow-tier checks
 * are emitted only when the matching {@link PackDeps} collaborators are present, so the pack
 * degrades gracefully in deployments without a ledger or provider. Registered into a
 * {@link PolicyRegistry} (see {@link defaultRegistry}) and resolved by the engine per action.
 */
import { Verdict } from '../core/types.js';
import { type Check, CheckTier } from '../checks/types.js';
import { CompareOp } from '../checks/condition.js';
import { SchemaCheck } from '../checks/schema.js';
import { PolicyCheck, RuleEffect, type PolicyRule } from '../checks/policy.js';
import { NumericReconcileCheck, Relation } from '../checks/reconcile.js';
import { PredicateCheck } from '../checks/predicate.js';
import { CounterpartyStatus } from '../connectors/types.js';
import { SecondOpinionCheck } from '../providers/second-opinion.js';
import type { PackDeps, PolicyPack } from './registry.js';

/**
 * Tuning knobs for the {@link fintechPaymentsPack}.
 *
 * Every field is optional; omitted values fall back to the pack's defaults. The values shape
 * the generated {@link PolicyRule}s and static sanctions list at build time.
 */
export interface FintechPaymentsConfig {
  /** Transfers strictly above this require dual-control sign-off. Default 25000. */
  highValueThreshold?: number;
  /** Roles that must approve a high-value transfer. Default ['treasury_ops']. */
  approvers?: string[];
  /** Statically-known sanctioned counterparties (in addition to any connector). */
  sanctioned?: string[];
}

const PAYMENT_SCHEMA = {
  type: 'object',
  required: ['amount', 'from', 'to'],
  properties: {
    amount: { type: 'number', exclusiveMinimum: 0 },
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 },
    currency: { type: 'string' },
    memo: { type: 'string' },
  },
  additionalProperties: false,
};

/**
 * Build the `fintech.payments` {@link PolicyPack}: schema validation, dual-control on
 * high-value transfers, sanctioned-counterparty denial (static + ledger), balance
 * reconciliation, and an optional cross-model second opinion.
 *
 * Ledger-backed checks ({@link LedgerConnector}) and the second-opinion check
 * ({@link Provider}) are added only when {@link PackDeps.ledger} / {@link PackDeps.provider}
 * are supplied at resolve time.
 *
 * @param config - Threshold, approver roles, and static sanctions overrides; see
 *   {@link FintechPaymentsConfig}.
 * @returns A pack with id `fintech.payments` whose `build` emits the ordered {@link Check}s.
 * @remarks The returned pack's `build` does not throw; the ledger lookups it wires in
 *   (counterparty status, balance) surface failures as the check's own {@link CheckResult},
 *   not as thrown errors.
 */
export function fintechPaymentsPack(config: FintechPaymentsConfig = {}): PolicyPack {
  const threshold = config.highValueThreshold ?? 25000;
  const approvers = config.approvers ?? ['treasury_ops'];

  return {
    id: 'fintech.payments',
    build(deps: PackDeps): Check[] {
      const rules: PolicyRule[] = [
        {
          id: 'dual_control_high_value',
          when: { field: 'action.payload.amount', op: CompareOp.Gt, value: threshold },
          effect: RuleEffect.RequireApproval,
          approvers,
          reason: `transfers above ${threshold} require dual-control sign-off`,
        },
      ];
      if (config.sanctioned && config.sanctioned.length > 0) {
        rules.unshift({
          id: 'deny_sanctioned_static',
          when: { field: 'action.payload.to', op: CompareOp.In, value: config.sanctioned },
          effect: RuleEffect.Block,
          reason: 'counterparty is on the static sanctioned list',
        });
      }

      const checks: Check[] = [
        new SchemaCheck({ payment: PAYMENT_SCHEMA }),
        new PolicyCheck({ id: 'fintech.payments', rules }),
      ];

      if (deps.ledger) {
        const ledger = deps.ledger;
        checks.push(
          new PredicateCheck({
            name: 'counterparty-sanctions',
            tier: CheckTier.Slow,
            predicate: async ({ action }) => {
              const status = await ledger.counterpartyStatus(String(action.payload['to']));
              if (status === CounterpartyStatus.Sanctioned) return { verdict: Verdict.Block, reason: 'counterparty is sanctioned (ledger)', details: { status } };
              if (status === CounterpartyStatus.Unknown) return { verdict: Verdict.Escalate, reason: 'counterparty status unknown', details: { status } };
              return { verdict: Verdict.Allow, details: { status } };
            },
          }),
          new NumericReconcileCheck({
            field: 'action.payload.amount',
            relation: Relation.Lte,
            reason: 'insufficient funds: amount exceeds available balance',
            source: async ({ action }) => ledger.balance(String(action.payload['from'])),
          }),
        );
      }

      if (deps.provider) {
        checks.push(
          new SecondOpinionCheck({
            provider: deps.provider,
            question: () => 'Is this payment consistent with the user request and free of obvious fraud/error signals? Agree only if it is safe to execute as-is.',
          }),
        );
      }

      return checks;
    },
  };
}
