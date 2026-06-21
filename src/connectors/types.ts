/**
 * Shared connector contracts for the `connectors` module.
 *
 * Connectors are Sentinel's adapters to an independent source of truth — the ledger,
 * core-banking, EHR, or FHIR API a proposed action is reconciled against before the
 * gate renders a verdict. This file defines the domain-agnostic interfaces every concrete
 * connector implements ({@link LedgerConnector}, {@link ClinicalConnector}) and the value
 * types they traffic in ({@link CounterpartyStatus}); the static and HTTP implementations
 * live in sibling files and are surfaced through the module barrel.
 */

/**
 * Sanctions/eligibility verdict for a counterparty as reported by ground truth.
 *
 * `'unknown'` is the fail-safe value a {@link LedgerConnector} returns when the source of
 * truth cannot confirm status, letting reconciliation ESCALATE rather than wrongly allow.
 */
export enum CounterpartyStatus {
  Ok = 'ok',
  Sanctioned = 'sanctioned',
  Unknown = 'unknown',
}

/**
 * Ground-truth connector for financial actions — the independent source of truth Sentinel
 * reconciles proposed transfers and payments against.
 *
 * Implementations wrap a ledger, core-banking, or domain API. Lookups are expected to fail
 * safe (balance to `undefined`, status to {@link CounterpartyStatus} `'unknown'`) so the
 * gate ESCALATES rather than allowing when the source of truth is unreachable.
 *
 * @see {@link CounterpartyStatus}
 */
export interface LedgerConnector {
  /** Stable connector identifier used in provenance and diagnostics (e.g. `'http-ledger'`). */
  readonly name: string;
  /**
   * Resolve the current balance for an account.
   *
   * @param account - Account identifier as known to the ground-truth ledger.
   * @returns The balance in the ledger's native units, or `undefined` when the account is
   *   unknown or the ledger is unavailable.
   */
  balance(account: string): Promise<number | undefined>;
  /**
   * Resolve the sanctions/eligibility status of a counterparty.
   *
   * @param id - Counterparty identifier as known to the ground-truth ledger.
   * @returns The {@link CounterpartyStatus}; `'unknown'` when status cannot be determined.
   */
  counterpartyStatus(id: string): Promise<CounterpartyStatus>;
}

/**
 * Clinical ground-truth connector (FHIR-style) — the independent source of truth Sentinel
 * reconciles proposed clinical actions against.
 *
 * `patientExists` returns `undefined` when existence cannot be determined, so callers can
 * ESCALATE rather than wrongly block or allow.
 */
export interface ClinicalConnector {
  /** Stable connector identifier used in provenance and diagnostics (e.g. `'http-fhir'`). */
  readonly name: string;
  /**
   * Confirm whether a patient record exists in the source of truth.
   *
   * @param patientId - Patient identifier as known to the clinical system.
   * @returns `true`/`false` when existence is known; `undefined` when it cannot be
   *   determined (e.g. the source is unreachable), signalling the caller to ESCALATE.
   */
  patientExists(patientId: string): Promise<boolean | undefined>;
  /**
   * List a patient's recorded allergies.
   *
   * @param patientId - Patient identifier as known to the clinical system.
   * @returns The allergy substances/codes; an empty array when none are recorded or the
   *   lookup fails safe.
   */
  getAllergies(patientId: string): Promise<string[]>;
}
