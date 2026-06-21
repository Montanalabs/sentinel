/**
 * Public barrel for the `connectors` module.
 *
 * Re-exports the connector contracts ({@link LedgerConnector}, {@link ClinicalConnector},
 * {@link CounterpartyStatus}) and their concrete implementations — in-memory
 * ({@link StaticLedgerConnector}, {@link StaticClinicalConnector}) and HTTP-backed
 * ({@link HttpLedgerConnector}, {@link HttpFhirConnector}) — so the rest of Sentinel can
 * wire ground-truth sources without reaching into individual files. Names are re-exported
 * unchanged so call sites stay searchable.
 */
export type { LedgerConnector, CounterpartyStatus, ClinicalConnector } from './types.js';
export { StaticLedgerConnector, type StaticLedgerData } from './static-ledger.js';
export { HttpLedgerConnector, type HttpLedgerOptions, type FetchLike } from './http-ledger.js';
export { StaticClinicalConnector, type StaticClinicalData } from './static-clinical.js';
export { HttpFhirConnector } from './http-fhir.js';
