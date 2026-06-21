/**
 * HTTP-backed {@link ClinicalConnector} for the `connectors` module.
 *
 * Provides production clinical ground truth by calling a FHIR-style REST API, reusing the
 * shared {@link FetchLike} abstraction and {@link HttpLedgerOptions} from the ledger HTTP
 * connector. Lookups fail safe so the gate ESCALATES rather than wrongly blocking or allowing
 * when the EHR/FHIR server is unreachable.
 */
import type { ClinicalConnector } from './types.js';
import type { FetchLike, HttpLedgerOptions } from './http-ledger.js';

/**
 * Clinical ground-truth connector backed by a FHIR-style REST API.
 *
 * Existence checks fail safe to `undefined` (so the caller ESCALATES); allergy lookups fail
 * safe to `[]`. Network errors, non-2xx responses, and malformed bodies are caught internally
 * and never propagate to the caller.
 *
 * @see {@link ClinicalConnector}
 * @see {@link StaticClinicalConnector} for the in-memory counterpart used in tests.
 */
export class HttpFhirConnector implements ClinicalConnector {
  /** Stable connector identifier surfaced in provenance and diagnostics. */
  readonly name = 'http-fhir';
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string> | undefined;

  /**
   * @param baseUrl - Root URL of the FHIR API; any trailing slashes are stripped.
   * @param opts - Optional {@link FetchLike} override and request headers.
   */
  constructor(baseUrl: string, opts: HttpLedgerOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
    this.headers = opts.headers;
  }

  /**
   * Check whether a patient record exists via a FHIR `Patient/{id}` read.
   *
   * @param patientId - Patient identifier; URL-encoded into the request path.
   * @returns `true` on a 2xx response, `false` on HTTP 404, and `undefined` for any other
   *   status, network error, or parse failure — signalling the caller to ESCALATE. This
   *   method never throws.
   */
  async patientExists(patientId: string): Promise<boolean | undefined> {
    try {
      const res = await this.fetchImpl(`${this.base}/Patient/${encodeURIComponent(patientId)}`, { headers: this.headers });
      if (res.ok) return true;
      if (res.status === 404) return false;
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Fetch a patient's allergies via a FHIR-style `Patient/{id}/allergies` read.
   *
   * @param patientId - Patient identifier; URL-encoded into the request path.
   * @returns The `allergies` array from the response body, or `[]` on any non-2xx response,
   *   missing/non-array field, network error, or parse failure. This method never throws.
   */
  async getAllergies(patientId: string): Promise<string[]> {
    try {
      const res = await this.fetchImpl(`${this.base}/Patient/${encodeURIComponent(patientId)}/allergies`, { headers: this.headers });
      if (!res.ok) return [];
      const body = (await res.json()) as { allergies?: string[] };
      return Array.isArray(body.allergies) ? body.allergies : [];
    } catch {
      return [];
    }
  }
}
