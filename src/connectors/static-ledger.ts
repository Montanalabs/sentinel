/**
 * In-memory {@link LedgerConnector} implementation for the `connectors` module.
 *
 * Backs tests, demos, and offline development with a fixed snapshot of balances and a
 * sanctions list, so reconciliation can run deterministically without a live ledger. For
 * production ground truth use {@link HttpLedgerConnector}.
 */
import { CounterpartyStatus } from './types.js';
import type { LedgerConnector } from './types.js';

/**
 * Seed data for a {@link StaticLedgerConnector}: the account balances and sanctioned
 * counterparties to serve from memory.
 */
export interface StaticLedgerData {
  /** Map of account identifier to balance in the ledger's native units. */
  balances: Record<string, number>;
  /** Counterparty identifiers to report as `'sanctioned'`; all others resolve to `'ok'`. */
  sanctioned?: string[];
}

/**
 * In-memory ground-truth ledger for tests, demos, and offline development.
 *
 * Serves balances and counterparty status from a fixed {@link StaticLedgerData} snapshot.
 * Unlike {@link HttpLedgerConnector} there is no network and thus no failure mode: lookups
 * are pure reads against the seeded maps.
 *
 * @see {@link LedgerConnector}
 */
export class StaticLedgerConnector implements LedgerConnector {
  /** Stable connector identifier surfaced in provenance and diagnostics. */
  readonly name = 'static-ledger';
  private readonly sanctioned: Set<string>;

  /**
   * @param data - The balances and sanctions snapshot to serve. Retained by reference;
   *   later mutations to `data.balances` are visible to {@link StaticLedgerConnector.balance}.
   */
  constructor(private readonly data: StaticLedgerData) {
    this.sanctioned = new Set(data.sanctioned ?? []);
  }

  /**
   * Look up an account balance in the seeded snapshot.
   *
   * @param account - Account identifier to resolve.
   * @returns The seeded balance, or `undefined` when the account is absent from
   *   {@link StaticLedgerData.balances}.
   */
  async balance(account: string): Promise<number | undefined> {
    return Object.prototype.hasOwnProperty.call(this.data.balances, account)
      ? this.data.balances[account]
      : undefined;
  }

  /**
   * Report a counterparty's sanctions status from the seeded list.
   *
   * @param id - Counterparty identifier to resolve.
   * @returns {@link CounterpartyStatus} `'sanctioned'` when `id` is in the seeded list,
   *   otherwise `'ok'`. Never returns `'unknown'` — the snapshot is always available.
   */
  async counterpartyStatus(id: string): Promise<CounterpartyStatus> {
    return this.sanctioned.has(id) ? CounterpartyStatus.Sanctioned : CounterpartyStatus.Ok;
  }
}
