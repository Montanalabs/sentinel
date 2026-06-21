/**
 * Public barrel for the provenance module.
 *
 * Re-exports the tamper-evident decision-log API: the {@link Signer}/{@link verifySignature}
 * crypto primitives, the {@link RecordBuilder} that links and signs entries, the
 * {@link verifyRecord}/{@link verifyChain} replay checks, the {@link GENESIS} chain root, and the
 * record-shape types ({@link ProvenanceRecord}, {@link RecordInput}, {@link RecordContext},
 * {@link VerifyResult}). Import from here rather than the individual files.
 */
export { Signer, verifySignature } from './signing.js';
export {
  RecordBuilder,
  verifyRecord,
  verifyChain,
  GENESIS,
} from './record.js';
export type {
  ProvenanceRecord,
  RecordInput,
  RecordContext,
  VerifyResult,
} from './record.js';
