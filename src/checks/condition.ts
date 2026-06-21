/**
 * A safe, data-only predicate language for policy rules. There is no code
 * evaluation: conditions are plain JSON objects, so policy bundles can be
 * transmitted and signed without any injection surface.
 *
 * This module supplies the {@link Condition} AST and its evaluator
 * ({@link evaluateCondition}) used by {@link PolicyCheck}, plus the shared
 * {@link resolveField} dotted-path lookup reused by the boundary and reconcile
 * checks. It is the foundation of declarative, signable policy in Sentinel.
 */

/** A comparison operator usable in a {@link Comparison} leaf condition. */
export enum CompareOp {
  Eq = 'eq',
  Ne = 'ne',
  Gt = 'gt',
  Gte = 'gte',
  Lt = 'lt',
  Lte = 'lte',
  In = 'in',
  Nin = 'nin',
  Contains = 'contains',
}

/**
 * A leaf predicate comparing a resolved field against a literal value.
 *
 * The `field` is a dotted path resolved by {@link resolveField} against the
 * {@link Scope}; `value` is the right-hand operand whose interpretation depends
 * on `op` (e.g. `in`/`nin` expect an array, `contains` expects `field` to be an
 * array). Numeric operators (`gt`/`gte`/`lt`/`lte`) coerce numbers and numeric
 * strings to a finite number before comparing (so a stringified amount cannot
 * evade a threshold rule); genuinely non-numeric operands compare `false`.
 */
export interface Comparison {
  field: string;
  op: CompareOp;
  value: unknown;
}

/**
 * A boolean predicate tree: either a {@link Comparison} leaf or a logical
 * combinator (`all` = AND, `any` = OR, `not` = negation) over nested conditions.
 *
 * Being plain data, a condition can be serialized, transmitted, and signed as
 * part of a policy bundle without any code-evaluation surface.
 */
export type Condition =
  | Comparison
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/**
 * The data bag a {@link Condition} is evaluated against.
 *
 * Conventionally keyed by `action` and `context`, so dotted paths like
 * `action.payload.amount` or `context.provider` resolve via {@link resolveField}.
 */
export type Scope = Record<string, unknown>;

/**
 * Resolve a dotted path (e.g. `action.payload.amount`) against the scope.
 *
 * Walks each segment in turn; if any intermediate value is `null` or a
 * non-object the traversal stops and `undefined` is returned. Never throws —
 * absent paths simply resolve to `undefined`.
 *
 * @param path - Dot-separated key path into the {@link Scope}.
 * @param scope - The object graph to traverse.
 * @returns The value at `path`, or `undefined` if any segment is missing or
 *   traverses through a non-object.
 */
/** Path segments that would walk the prototype chain rather than data — never resolved. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Maximum nesting depth of a {@link Condition} tree; deeper trees evaluate to `false` (fail-safe). */
const MAX_CONDITION_DEPTH = 64;

export function resolveField(path: string, scope: Scope): unknown {
  let cur: unknown = scope;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    // Only traverse own data properties; refuse __proto__/constructor/prototype so a policy path
    // cannot reach into the prototype chain or class internals.
    if (FORBIDDEN_KEYS.has(part) || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Only plain decimal strings coerce — NOT hex/octal/exponential/whitespace, which `Number()`
 * would accept but a downstream system parsing the same field likely would not. */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

/** Coerce numbers and canonical decimal strings to a finite number; everything else to undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && DECIMAL.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function compareNumeric(a: unknown, b: unknown, cmp: (x: number, y: number) => boolean): boolean {
  // Coerce numeric strings so a stringified amount (e.g. "50000") cannot evade a `> threshold`
  // block rule by type confusion. Genuinely non-numeric operands still compare false.
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === undefined || y === undefined) return false;
  return cmp(x, y);
}

/**
 * Equality used by eq/ne/in/nin: numeric when BOTH operands are numeric (number or numeric
 * string), strict `===` otherwise. Consistent with the ordering operators, so `42 == "42"` holds
 * everywhere — a stringified value can't satisfy/evade an identity rule that an ordering rule
 * would catch. Non-numeric values keep exact-match semantics.
 */
function looseEq(a: unknown, b: unknown): boolean {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== undefined && y !== undefined) return x === y;
  return a === b;
}

function evalComparison(c: Comparison, scope: Scope): boolean {
  const left = resolveField(c.field, scope);
  switch (c.op) {
    case CompareOp.Eq:
      return looseEq(left, c.value);
    case CompareOp.Ne:
      return !looseEq(left, c.value);
    case CompareOp.Gt:
      return compareNumeric(left, c.value, (x, y) => x > y);
    case CompareOp.Gte:
      return compareNumeric(left, c.value, (x, y) => x >= y);
    case CompareOp.Lt:
      return compareNumeric(left, c.value, (x, y) => x < y);
    case CompareOp.Lte:
      return compareNumeric(left, c.value, (x, y) => x <= y);
    case CompareOp.In:
      return Array.isArray(c.value) && c.value.some((el) => looseEq(left, el));
    case CompareOp.Nin:
      return Array.isArray(c.value) && !c.value.some((el) => looseEq(left, el));
    case CompareOp.Contains:
      return Array.isArray(left) && left.some((el) => looseEq(el, c.value));
    default:
      return false;
  }
}

/**
 * Evaluate a {@link Condition} tree against a {@link Scope} to a boolean.
 *
 * Recursively interprets the logical combinators (`all`/`any`/`not`) and
 * delegates leaf {@link Comparison} nodes to the operator semantics. Pure and
 * total: it performs no I/O and never throws — unresolved fields and type
 * mismatches yield `false` rather than errors.
 *
 * @param cond - The predicate tree to evaluate.
 * @param scope - The data the condition is tested against; see {@link Scope}.
 * @returns `true` if the condition holds, otherwise `false`.
 * @remarks Nesting is bounded to {@link MAX_CONDITION_DEPTH}; a deeper tree (a pathological or
 *   adversarial policy) short-circuits to `false` rather than risking a stack overflow.
 */
export function evaluateCondition(cond: Condition, scope: Scope, depth = 0): boolean {
  if (depth > MAX_CONDITION_DEPTH) return false;
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, scope, depth + 1));
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, scope, depth + 1));
  if ('not' in cond) return !evaluateCondition(cond.not, scope, depth + 1);
  return evalComparison(cond, scope);
}
