/**
 * In-memory {@link ClinicalConnector} implementation for the `connectors` module.
 *
 * Backs tests, demos, and offline development with a fixed roster of patients and their
 * allergies, so clinical reconciliation runs deterministically without a live EHR/FHIR
 * server. For production ground truth use {@link HttpFhirConnector}.
 */
import type { ClinicalConnector } from './types.js';

/**
 * Seed data for a {@link StaticClinicalConnector}: the known patients and their recorded
 * allergies to serve from memory.
 */
export interface StaticClinicalData {
  /** Identifiers of patients treated as existing; any other id reports as not found. */
  patients: string[];
  /** Map of patient identifier to recorded allergy substances/codes. */
  allergies?: Record<string, string[]>;
}

/**
 * In-memory clinical ground-truth for tests, demos, and offline development.
 *
 * Serves existence and allergy lookups from a fixed {@link StaticClinicalData} snapshot.
 * Unlike {@link HttpFhirConnector} there is no network and thus no fail-safe `undefined`
 * path: existence is always known against the seeded roster.
 *
 * @see {@link ClinicalConnector}
 */
export class StaticClinicalConnector implements ClinicalConnector {
  /** Stable connector identifier surfaced in provenance and diagnostics. */
  readonly name = 'static-clinical';
  private readonly patients: Set<string>;

  /**
   * @param data - The patient roster and allergy map to serve. Retained by reference;
   *   later mutations to `data.allergies` are visible to
   *   {@link StaticClinicalConnector.getAllergies}.
   */
  constructor(private readonly data: StaticClinicalData) {
    this.patients = new Set(data.patients);
  }

  /**
   * Check whether a patient is present in the seeded roster.
   *
   * @param patientId - Patient identifier to resolve.
   * @returns `true` when the id is in {@link StaticClinicalData.patients}, otherwise
   *   `false`. Never returns `undefined` — the snapshot is always available.
   */
  async patientExists(patientId: string): Promise<boolean | undefined> {
    return this.patients.has(patientId);
  }

  /**
   * List a patient's recorded allergies from the seeded map.
   *
   * @param patientId - Patient identifier to resolve.
   * @returns The seeded allergy list, or an empty array when none are recorded for the id.
   */
  async getAllergies(patientId: string): Promise<string[]> {
    return this.data.allergies?.[patientId] ?? [];
  }
}
