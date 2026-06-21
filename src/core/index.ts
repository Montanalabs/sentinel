/**
 * Public barrel for the Sentinel core domain.
 *
 * Re-exports (names unchanged) the shared domain model from {@link Action ./types}, the
 * {@link Action} builders and {@link actionFingerprint} from `./action`, and the
 * {@link canonicalize} serializer — the surface every other module depends on for the
 * action / verdict / provenance vocabulary.
 */

export * from './types.js';
export { Action, actionFingerprint } from './action.js';
export type { PaymentPayload } from './action.js';
export { canonicalize } from './canonical.js';
