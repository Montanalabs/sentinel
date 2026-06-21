/**
 * Policy-pack registry and the contracts that vertical packs implement.
 *
 * A {@link PolicyPack} bundles the ordered {@link Check}s for one policy/vertical (e.g.
 * `fintech.payments`); the {@link PolicyRegistry} indexes packs by id and resolves a policy
 * reference into the concrete checks the engine runs. {@link PackDeps} carries the optional
 * ground-truth connectors and second-opinion provider a pack wires into its slow-tier checks.
 * This module is the seam between the policy catalog and the verdict engine.
 */
import type { Check } from '../checks/types.js';
import type { LedgerConnector, ClinicalConnector } from '../connectors/types.js';
import type { Provider } from '../providers/types.js';

/**
 * Optional collaborators a {@link PolicyPack} may wire into its checks.
 *
 * Each field is absent when the corresponding integration is not configured; packs degrade
 * gracefully, emitting only the checks whose dependencies are present.
 *
 * @remarks `ledger` and `clinical` supply ground truth for slow-tier reconciliation;
 * `provider` supplies the independent model for a cross-model second opinion.
 */
export interface PackDeps {
  /** Ledger / core-banking ground truth for balance and counterparty reconciliation. */
  ledger?: LedgerConnector;
  /** Clinical (FHIR-style) ground truth for patient-existence verification. */
  clinical?: ClinicalConnector;
  /** Independent model used as a cross-model second opinion. */
  provider?: Provider;
}

/**
 * A named bundle of {@link Check}s for one policy/vertical.
 *
 * @remarks `id` is the stable policy reference (e.g. `fintech.payments`) callers pass to
 * {@link PolicyRegistry.resolve}; `build` is invoked per resolution so checks can close over the
 * supplied {@link PackDeps}.
 */
export interface PolicyPack {
  /** Stable policy reference this pack answers to (e.g. `fintech.payments`). */
  readonly id: string;
  /**
   * Construct the ordered checks for this pack, given the available collaborators.
   *
   * @param deps - Connectors and provider to wire into dependency-gated checks.
   * @returns The checks to run, in evaluation order (fast tier before slow tier).
   * @see {@link PackDeps}
   */
  build(deps: PackDeps): Check[];
}

/**
 * Thrown by {@link PolicyRegistry.resolve} when no pack is registered under the requested id.
 *
 * Carries an HTTP `statusCode` of 400 so the sidecar surfaces an unknown policy as a clean
 * client error (the caller asked for a policy that does not exist) rather than an opaque 500.
 * It still extends {@link Error}, so the programmatic `resolve` contract ("throws on unknown id")
 * is unchanged — fail-closed: no checks run, so no decision can be ALLOWed.
 */
export class UnknownPolicyError extends Error {
  /** HTTP status the sidecar's error handler maps this to (4xx => client error, not a 500). */
  readonly statusCode = 400;
  constructor(id: string) {
    super(`unknown policy pack: ${id}`);
    this.name = 'UnknownPolicyError';
  }
}

/**
 * Resolves a policy reference to the ordered {@link Check}s the engine should run.
 *
 * Packs are registered once (typically at startup) and resolved per gated action. The same
 * {@link PackDeps} passed at construction is threaded into every pack's {@link PolicyPack.build}.
 *
 * @remarks {@link register} is chainable to support fluent setup; see {@link defaultRegistry}.
 */
export class PolicyRegistry {
  private readonly packs = new Map<string, PolicyPack>();

  /**
   * @param deps - Collaborators shared with every registered pack at resolve time.
   */
  constructor(private readonly deps: PackDeps = {}) {}

  /**
   * Register a pack under its {@link PolicyPack.id}, replacing any pack with the same id.
   *
   * @param pack - The pack to index.
   * @returns This registry, for fluent chaining.
   */
  register(pack: PolicyPack): this {
    this.packs.set(pack.id, pack);
    return this;
  }

  /**
   * Report whether a pack is registered under the given policy reference.
   *
   * @param id - Policy reference to look up (e.g. `fintech.payments`).
   * @returns `true` if a pack with that id is registered.
   */
  has(id: string): boolean {
    return this.packs.has(id);
  }

  /**
   * List the policy references of all registered packs.
   *
   * @returns The registered pack ids, in insertion order.
   */
  list(): string[] {
    return [...this.packs.keys()];
  }

  /**
   * Resolve a policy reference into the checks its pack produces for the configured deps.
   *
   * @param id - Policy reference to resolve (e.g. `fintech.payments`).
   * @returns The ordered {@link Check}s from the matching {@link PolicyPack}.
   * @throws {UnknownPolicyError} If no pack is registered under `id` (HTTP 400 at the sidecar).
   */
  resolve(id: string): Check[] {
    const pack = this.packs.get(id);
    if (!pack) throw new UnknownPolicyError(id);
    return pack.build(this.deps);
  }
}
