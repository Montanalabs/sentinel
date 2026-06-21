import { randomUUID } from 'node:crypto';
import type { Action } from '../core/types.js';

/**
 * In-memory human-in-the-loop review queue for the sidecar. When the gate
 * {@link Engine} returns an `ESCALATE` verdict, the HTTP server records an
 * {@link Escalation} here; a human later approves or denies it, which the server
 * turns into a chained human-decision provenance record.
 */

/** Lifecycle state of an {@link Escalation}: awaiting review, approved, or denied. */
export enum EscalationStatus {
  Pending = 'pending',
  Approved = 'approved',
  Denied = 'denied',
}

/**
 * A pending or resolved human review of an escalated {@link Action}, tied back to
 * the originating provenance record by {@link Escalation.recordId}.
 */
export interface Escalation {
  id: string;
  /** Id of the provenance record whose `ESCALATE` verdict opened this review. */
  recordId: string;
  action: Action;
  /** Identities permitted to resolve this escalation; empty means unrestricted. */
  approvers: string[];
  reason?: string;
  status: EscalationStatus;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** Identity that resolved the escalation; set once {@link status} leaves `pending`. */
  resolvedBy?: string;
  /** ISO-8601 resolution timestamp; set once {@link status} leaves `pending`. */
  resolvedAt?: string;
}

/** Arguments to open a new {@link Escalation} via {@link EscalationManager.create}. */
export interface CreateEscalationInput {
  recordId: string;
  action: Action;
  approvers?: string[];
  reason?: string;
}

/** A reviewer's verdict on an escalation, passed to {@link EscalationManager.resolve}. */
export interface ResolveInput {
  decision: 'approve' | 'deny';
  /** Identity credited as resolving the escalation, recorded in provenance. */
  approver: string;
}

/** Construction options for {@link EscalationManager}. */
export interface EscalationManagerOptions {
  /** Called when an escalation is created (e.g. Slack/ServiceNow webhook). Failures are non-fatal. */
  notify?: (e: Escalation) => Promise<void>;
  /** Clock override returning an ISO-8601 timestamp; injectable for deterministic tests. */
  now?: () => string;
}

/** Holds the human-in-the-loop review queue and notifies on new escalations. */
export class EscalationManager {
  private readonly items = new Map<string, Escalation>();
  private readonly now: () => string;

  /**
   * @param opts - Optional notification hook and clock; see
   *   {@link EscalationManagerOptions}. Defaults the clock to `Date.now`.
   */
  constructor(private readonly opts: EscalationManagerOptions = {}) {
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  /**
   * Open a new pending {@link Escalation} and fire the optional notify hook.
   *
   * @param input - The originating record, action, and optional approvers/reason.
   * @returns The created escalation, in `pending` status with a generated id.
   * @remarks A failing {@link EscalationManagerOptions.notify} hook is swallowed
   *   so a flaky webhook never drops an escalation from the queue.
   */
  async create(input: CreateEscalationInput): Promise<Escalation> {
    const e: Escalation = {
      id: `esc_${randomUUID()}`,
      recordId: input.recordId,
      action: input.action,
      approvers: input.approvers ?? [],
      ...(input.reason ? { reason: input.reason } : {}),
      status: EscalationStatus.Pending,
      createdAt: this.now(),
    };
    this.items.set(e.id, e);
    if (this.opts.notify) {
      try {
        await this.opts.notify(e);
      } catch {
        /* notification failures must not drop the escalation */
      }
    }
    return e;
  }

  /**
   * List escalations, optionally narrowed to a single {@link EscalationStatus}.
   *
   * @param status - When provided, returns only escalations in this state.
   * @returns A snapshot array of matching escalations.
   */
  list(status?: EscalationStatus): Escalation[] {
    const all = [...this.items.values()];
    return status ? all.filter((e) => e.status === status) : all;
  }

  /**
   * Look up a single escalation by id.
   *
   * @returns The matching {@link Escalation}, or `undefined` if unknown.
   */
  get(id: string): Escalation | undefined {
    return this.items.get(id);
  }

  /**
   * Resolve a pending escalation by recording a reviewer's approve/deny decision.
   *
   * @param id - Id of the escalation to resolve.
   * @param input - The reviewer's decision and identity; see {@link ResolveInput}.
   * @returns The updated escalation, now `approved` or `denied`.
   * @throws {Error} If no escalation exists for `id`.
   * @throws {Error} If the escalation has already been resolved (not `pending`).
   */
  async resolve(id: string, input: ResolveInput): Promise<Escalation> {
    const e = this.items.get(id);
    if (!e) throw new Error(`unknown escalation: ${id}`);
    if (e.status !== EscalationStatus.Pending) throw new Error(`escalation ${id} already ${e.status}`);
    e.status = input.decision === 'approve' ? EscalationStatus.Approved : EscalationStatus.Denied;
    e.resolvedBy = input.approver;
    e.resolvedAt = this.now();
    return e;
  }
}
