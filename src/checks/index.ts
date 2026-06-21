/**
 * Public barrel for the checks module.
 *
 * Re-exports the {@link Check} contract and every built-in check the verdict
 * engine and policy packs compose — the declarative {@link PolicyCheck},
 * structural {@link SchemaCheck}, {@link NumericReconcileCheck},
 * {@link DataBoundaryCheck}, and the {@link PredicateCheck} escape hatch — along
 * with the data-only {@link Condition} language ({@link evaluateCondition},
 * {@link resolveField}) they are configured with. Import checks from here rather
 * than from individual files.
 */

export type { Check, CheckInput, CheckTier } from './types.js';
export {
  resolveField,
  evaluateCondition,
  type Condition,
  type Comparison,
  type CompareOp,
  type Scope,
} from './condition.js';
export { PolicyCheck, type PolicyDefinition, type PolicyRule, type RuleEffect } from './policy.js';
export { SchemaCheck } from './schema.js';
export { NumericReconcileCheck, type ReconcileSpec, type Relation } from './reconcile.js';
export { DataBoundaryCheck, type DataBoundaryPolicy } from './boundary.js';
export { PredicateCheck, type PredicateResult, type PredicateCheckOptions } from './predicate.js';
