/**
 * Construction and identity for proposed {@link ActionT actions}.
 *
 * Sits at the input edge of the core domain: callers build well-formed {@link ActionT} values
 * with the {@link Action} builders, and {@link actionFingerprint} derives a stable content hash
 * used by the provenance hash-chain to deduplicate and tamper-check actions.
 */

import { randomUUID, createHash } from 'node:crypto';
import type { Action as ActionT, ActionType } from './types.js';
import { canonicalize } from './canonical.js';

/**
 * Re-export of the {@link ActionT Action} domain type under the same name as the builder.
 *
 * Lets `Action` serve as both the value namespace (the {@link Action} builders) and the type
 * in call sites, so `const a: Action = Action.payment(...)` reads naturally.
 */
export type Action = ActionT;

interface ActionOpts {
  id?: string;
  meta?: Record<string, unknown>;
}

function build(type: ActionType, payload: Record<string, unknown>, opts: ActionOpts = {}): ActionT {
  const action: ActionT = {
    id: opts.id ?? `act_${randomUUID()}`,
    type,
    payload: { ...payload },
    ...(opts.meta ? { meta: { ...opts.meta } } : {}),
  };
  return action;
}

/**
 * Strongly-typed payload for a `payment` {@link ActionT action}.
 *
 * Shapes the body that {@link Action.payment} wraps; the open index signature lets connectors
 * attach extra fields without losing the checked core ones.
 */
export interface PaymentPayload {
  /** Transfer amount in the smallest unit of `currency` (e.g. cents). */
  amount: number;
  /** Source account or wallet identifier the funds debit from. */
  from: string;
  /** Destination account or wallet identifier the funds credit to. */
  to: string;
  /** ISO 4217 currency code; defaults are policy-defined when omitted. */
  currency?: string;
  [k: string]: unknown;
}

/**
 * Builders for proposed {@link ActionT action}s.
 *
 * {@link Action.of} is the general form; typed helpers (e.g. {@link Action.payment}) exist for
 * the well-known, high-value {@link ActionType}s. Each builder defaults a unique `id` and
 * defensively copies `payload`/`meta`, so the returned value is safe to hand straight to the gate.
 *
 * @example
 * const action = Action.payment({ amount: 4200, from: 'acct_a', to: 'acct_b' });
 */
export const Action = {
  /**
   * Build an {@link ActionT action} of any {@link ActionType}.
   *
   * @param type - The action discriminator (a {@link ActionType}, known or custom).
   * @param payload - Structured body; copied so later mutation of the argument cannot leak in.
   * @param opts - Optional explicit `id` (otherwise a `act_<uuid>` is generated) and `meta`.
   * @returns A fully-formed {@link ActionT}.
   */
  of(type: ActionType, payload: Record<string, unknown>, opts?: ActionOpts): ActionT {
    return build(type, payload, opts);
  },
  /**
   * Build a `payment` {@link ActionT action} from a typed {@link PaymentPayload}.
   *
   * @param payload - The payment body; see {@link PaymentPayload} for field units.
   * @param opts - Optional explicit `id` (otherwise generated) and `meta`.
   * @returns A fully-formed `payment` {@link ActionT}.
   */
  payment(payload: PaymentPayload, opts?: ActionOpts): ActionT {
    return build('payment', payload, opts);
  },
} as const;

/**
 * Compute the stable content fingerprint of an {@link ActionT action}.
 *
 * Hashes only the semantically meaningful content — `type` plus the {@link canonicalize canonical}
 * `payload` — deliberately excluding `id` and `meta` so that two actions proposing the same effect
 * fingerprint identically (enabling dedupe and tamper detection in the provenance chain).
 *
 * @param action - The action to fingerprint; only `type` and `payload` participate.
 * @returns The lowercase hex-encoded SHA-256 digest of the canonical basis.
 */
export function actionFingerprint(action: ActionT): string {
  const basis = canonicalize({ type: action.type, payload: action.payload });
  return createHash('sha256').update(basis).digest('hex');
}
