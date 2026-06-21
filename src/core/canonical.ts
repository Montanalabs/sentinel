/**
 * Deterministic JSON serialization for hashing and signing.
 *
 * The single source of canonical bytes for the core domain: {@link actionFingerprint} and the
 * provenance hash-chain both feed values through here so structurally-equal inputs hash equally.
 */

/**
 * Serialize a value to a deterministic, canonical JSON string.
 *
 * Object keys are emitted in sorted order so that two structurally-equal values always produce
 * byte-identical output. Array order is preserved (it is semantically significant) and
 * `undefined` object properties are dropped to match `JSON.stringify` semantics.
 *
 * @param value - Any JSON-serializable value. Non-finite numbers (`NaN`/`±Infinity`) and `bigint`
 *   are serialized to distinct, collision-free tokens rather than collapsing to `null` or throwing;
 *   functions and symbols follow `JSON.stringify` behavior (omitted/`null`).
 * @returns A stable string suitable for hashing or signing; never `undefined` (a top-level
 *   `undefined` collapses to `'null'`).
 * @remarks Output is intended for hashing, not round-tripping — it is not guaranteed to re-parse
 *   identically to the input (e.g. dropped `undefined` properties).
 */
export function canonicalize(value: unknown): string {
  // BigInt makes JSON.stringify throw (a chain-append DoS via a crafted field). Emit an
  // object-tagged token rather than a plain string so it cannot collide with an ordinary string
  // value like "bigint:5". (Note: JSON.parse never yields bigint/non-finite, so this only guards
  // the in-process embedding path; the wire path can't reach it.)
  if (typeof value === 'bigint') {
    return `{"$sentinelBigInt":${JSON.stringify(value.toString())}}`;
  }
  // Non-finite numbers all stringify to "null" by default, silently colliding with each other and
  // with real null. Emit a distinct object-tagged token per value so distinct inputs hash apart.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return `{"$sentinelNumber":${JSON.stringify(String(value))}}`;
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v === undefined ? null : v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    '{' +
    keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',') +
    '}'
  );
}
