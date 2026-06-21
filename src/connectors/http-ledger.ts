/**
 * HTTP-backed {@link LedgerConnector} for the `connectors` module.
 *
 * Provides production ground truth by calling a REST ledger/core-banking API, and defines
 * the minimal `fetch`-shaped abstraction ({@link FetchLike}, {@link FetchResponseLike}) and
 * options ({@link HttpLedgerOptions}) the HTTP connectors share. Every lookup fails safe so
 * the gate ESCALATES rather than allows when the source of truth is unreachable.
 */
import { CounterpartyStatus } from './types.js';
import type { LedgerConnector } from './types.js';

/**
 * Minimal subset of the Fetch `Response` the HTTP connectors depend on.
 *
 * Lets a custom {@link FetchLike} be supplied in tests without pulling in the full DOM/undici
 * `Response` type.
 */
export interface FetchResponseLike {
  /** Whether the HTTP status is in the 2xx range. */
  ok: boolean;
  /** Numeric HTTP status code; `404` is treated as a definitive "not found" by callers. */
  status: number;
  /** Parse the response body as JSON. */
  json(): Promise<unknown>;
}

/**
 * Injectable `fetch`-shaped function the HTTP connectors call to reach ground truth.
 *
 * Abstracts the global `fetch` so tests can stub network behavior; defaults to a thin
 * wrapper over the platform `fetch` when no override is supplied via {@link HttpLedgerOptions}.
 *
 * @returns A promise resolving to a {@link FetchResponseLike}.
 */
export type FetchLike = (url: string, init?: unknown) => Promise<FetchResponseLike>;

/**
 * Construction options shared by the HTTP ground-truth connectors.
 *
 * @see {@link HttpLedgerConnector}
 * @see {@link HttpFhirConnector}
 */
export interface HttpLedgerOptions {
  /** Override for the network call; defaults to the platform `fetch`. See {@link FetchLike}. */
  fetchImpl?: FetchLike;
  /** Optional bearer token / headers for the ledger API. */
  headers?: Record<string, string>;
}

/**
 * Ground-truth connector backed by a REST ledger/core-banking API.
 *
 * All lookups fail safe (balance to `undefined`, status to {@link CounterpartyStatus}
 * `'unknown'`) so reconciliation ESCALATES rather than allowing when the source of truth is
 * unreachable. Network errors, non-2xx responses, and malformed bodies are caught internally
 * and never propagate to the caller.
 *
 * @see {@link LedgerConnector}
 * @see {@link StaticLedgerConnector} for the in-memory counterpart used in tests.
 */
export class HttpLedgerConnector implements LedgerConnector {
  /** Stable connector identifier surfaced in provenance and diagnostics. */
  readonly name = 'http-ledger';
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  /**
   * @param baseUrl - Root URL of the ledger API; any trailing slashes are stripped.
   * @param opts - Optional {@link FetchLike} override and request headers.
   */
  constructor(baseUrl: string, opts: HttpLedgerOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as Promise<FetchResponseLike>);
    this.headers = opts.headers;
  }
  private readonly headers: Record<string, string> | undefined;

  /**
   * Fetch an account balance from the ledger API.
   *
   * @param account - Account identifier; URL-encoded into the request path.
   * @returns The balance when the API responds 2xx with a numeric `balance` field; otherwise
   *   `undefined` (non-2xx, missing/non-numeric field, network error, or parse failure). All
   *   failure modes are swallowed — this method never throws.
   */
  async balance(account: string): Promise<number | undefined> {
    try {
      const res = await this.fetchImpl(`${this.base}/accounts/${encodeURIComponent(account)}/balance`, {
        headers: this.headers,
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { balance?: number };
      return typeof body.balance === 'number' ? body.balance : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a counterparty's sanctions status from the ledger API.
   *
   * @param id - Counterparty identifier; URL-encoded into the request path.
   * @returns The reported {@link CounterpartyStatus}; `'unknown'` on any non-2xx response,
   *   missing status field, network error, or parse failure. This method never throws.
   */
  async counterpartyStatus(id: string): Promise<CounterpartyStatus> {
    try {
      const res = await this.fetchImpl(`${this.base}/counterparties/${encodeURIComponent(id)}`, {
        headers: this.headers,
      });
      if (!res.ok) return CounterpartyStatus.Unknown;
      const body = (await res.json()) as { status?: string };
      const status = body.status;
      return status !== undefined && Object.values(CounterpartyStatus).includes(status as CounterpartyStatus)
        ? (status as CounterpartyStatus)
        : CounterpartyStatus.Unknown;
    } catch {
      return CounterpartyStatus.Unknown;
    }
  }
}
