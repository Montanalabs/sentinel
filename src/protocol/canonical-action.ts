/**
 * Canonical representation and digest of a protected action.
 *
 * A {@link CanonicalAction} is the deterministic, fully-specified description of *exactly* what an
 * agent proposes to do — so that an authorization receipt can be bound to it and a downstream
 * executor can prove the action it is about to run is the one that was authorized. Two semantically
 * identical actions MUST produce the same {@link actionDigest}; any materially different parameter
 * MUST change it. Ambiguous or non-deterministically-serializable inputs are rejected (fail-safe),
 * never silently coerced.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from '../core/canonical.js';
import { ProtocolError, ProtocolErrorCode } from './errors.js';

/**
 * The deterministic, signable description of a protected action.
 *
 * Supersets the gate's {@link Action} with the execution-binding fields a receipt must commit to:
 * which service/operation, on whose behalf, in which tenant/scope/environment. Field names are
 * fixed and ordering is irrelevant — {@link actionDigest} canonicalizes before hashing.
 */
export interface CanonicalAction {
  /** High-level action class, e.g. `payment`, `record_update`. */
  readonly actionType: string;
  /** The downstream service or tool that will execute it, e.g. `core-banking`. */
  readonly targetService: string;
  /** The specific operation on that service, e.g. `transfer`. */
  readonly operation: string;
  /** The structured operation parameters (the gate's action payload). */
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Identity on whose behalf the action is taken. */
  readonly actorId: string;
  /** Tenant / organization scope. */
  readonly tenant?: string;
  /** Execution scope (e.g. a capability or boundary label). */
  readonly scope?: string;
  /** Deployment environment, e.g. `prod`. */
  readonly environment?: string;
  /** Additional contextual attributes that materially affect authorization. */
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** The required string fields that must be present and non-empty for a well-formed canonical action. */
const REQUIRED_STRINGS: ReadonlyArray<keyof CanonicalAction> = [
  'actionType',
  'targetService',
  'operation',
  'actorId',
];

/**
 * Recursively assert a value is built only from JSON-deterministic types, so its digest is a
 * faithful, injective commitment. Rejects functions, symbols, `undefined`, `bigint`, and non-finite
 * numbers — values that {@link canonicalize} would drop or that have no unambiguous JSON form.
 */
function assertDeterministic(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new ProtocolError(ProtocolErrorCode.NonCanonicalAction, `non-finite number at ${path}`);
    }
    return;
  }
  if (t === 'object') {
    if (Array.isArray(value)) {
      value.forEach((v, i) => assertDeterministic(v, `${path}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue; // canonicalize drops these consistently
      assertDeterministic(v, `${path}.${k}`);
    }
    return;
  }
  // function, symbol, bigint, undefined
  throw new ProtocolError(ProtocolErrorCode.NonCanonicalAction, `unsupported ${t} at ${path}`);
}

/**
 * Validate and normalize an input into a {@link CanonicalAction}.
 *
 * Enforces that required identity/operation fields are present and non-empty, that `parameters` is
 * an object, and that every value is deterministically serializable. Optional fields are included
 * only when set, so their absence and an empty value never collide.
 *
 * @param input - A candidate canonical action (e.g. assembled from a {@link GuardRequest}).
 * @returns A normalized {@link CanonicalAction}.
 * @throws {ProtocolError} `NON_CANONICAL_ACTION` if a required field is missing/blank, `parameters`
 *   is not an object, or any value is not deterministically serializable.
 */
export function toCanonicalAction(input: CanonicalAction): CanonicalAction {
  for (const key of REQUIRED_STRINGS) {
    const v = input[key];
    if (typeof v !== 'string' || v.trim() === '') {
      throw new ProtocolError(ProtocolErrorCode.NonCanonicalAction, `missing or empty required field: ${String(key)}`);
    }
  }
  if (typeof input.parameters !== 'object' || input.parameters === null || Array.isArray(input.parameters)) {
    throw new ProtocolError(ProtocolErrorCode.NonCanonicalAction, 'parameters must be an object');
  }
  assertDeterministic(input.parameters, 'parameters');
  if (input.attributes !== undefined) assertDeterministic(input.attributes, 'attributes');

  return {
    actionType: input.actionType,
    targetService: input.targetService,
    operation: input.operation,
    parameters: input.parameters,
    actorId: input.actorId,
    ...(input.tenant !== undefined ? { tenant: input.tenant } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.environment !== undefined ? { environment: input.environment } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
  };
}

/**
 * Compute the SHA-256 digest of a protected action.
 *
 * Validates and canonicalizes the action first, so the digest is order-independent and injective
 * over the action's meaning. This is the value an authorization receipt binds to and a protected
 * executor recomputes from the *actual* request — it must never be supplied by the agent.
 *
 * @param action - The action to digest; normalized via {@link toCanonicalAction}.
 * @returns The lowercase hex SHA-256 of the canonical action.
 * @throws {ProtocolError} `NON_CANONICAL_ACTION` (propagated from {@link toCanonicalAction}).
 */
export function actionDigest(action: CanonicalAction): string {
  const canonical = toCanonicalAction(action);
  return createHash('sha256').update(canonicalize(canonical)).digest('hex');
}
