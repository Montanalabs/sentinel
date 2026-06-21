/**
 * Declared independence of the verifier from the actor it checks (protocol §11).
 *
 * The protocol's value rests on the verifier being a genuinely independent second opinion — not the
 * same model, prompted by the same agent, reading context the agent itself constructed. That
 * independence cannot be *proven* from inside the gate, so it is **declared**: an operator records a
 * {@link VerifierIndependenceProfile}, and {@link assessIndependence} turns the declared facts into a
 * list of concrete correlated-failure {@link IndependenceWarning}s. The warnings are advisory signals
 * for operators and auditors (and a column in the threat model), not a verdict — this module makes no
 * claim that an absence of warnings *guarantees* independence, only that the listed risks are absent
 * from the declaration.
 */

/** Who controls a given input to the verifier. */
export enum Ownership {
  /** Controlled by the gate, outside the actor's influence. */
  Gate = 'gate',
  /** Controlled (or influenceable) by the actor under verification. */
  Agent = 'agent',
}

/** Whether two components are isolated from each other or share a trust boundary. */
export enum Boundary {
  /** Independent: separate deployment / credentials / blast radius. */
  Separate = 'separate',
  /** Shared: a single compromise affects both. */
  Shared = 'shared',
}

/** A specific correlated-failure risk found in an independence declaration. */
export enum IndependenceWarningCode {
  /** Actor and verifier run the identical provider + model. */
  SameModel = 'SAME_MODEL',
  /** Actor and verifier share a model family (likely correlated failure modes). */
  SameModelFamily = 'SAME_MODEL_FAMILY',
  /** The verifier's prompt is supplied by the actor — a prompt-injection can steer its own review. */
  AgentSuppliedPrompt = 'AGENT_SUPPLIED_PROMPT',
  /** The policy the verifier enforces is supplied by the actor. */
  AgentSuppliedPolicy = 'AGENT_SUPPLIED_POLICY',
  /** The verifier judges context the actor constructed, without independent reconstruction. */
  AgentConstructedContext = 'AGENT_CONSTRUCTED_CONTEXT',
  /** Actor and verifier share credentials — one compromise yields both. */
  SharedCredentials = 'SHARED_CREDENTIALS',
  /** Actor and verifier share a deployment boundary — one compromise yields both. */
  SharedDeployment = 'SHARED_DEPLOYMENT',
}

/**
 * An operator's declaration of how the verifier relates to the actor it checks.
 *
 * Every field is a *declared* fact about the deployment, not something the gate can verify at
 * runtime; {@link assessIndependence} reads them to surface correlated-failure risks.
 */
export interface VerifierIndependenceProfile {
  /** Provider of the actor's model, e.g. `openai` (omit if unknown/non-model actor). */
  readonly actorProvider?: string;
  /** The actor's model id, e.g. `gpt-4o`. */
  readonly actorModel?: string;
  /** Provider of the verifier's model. */
  readonly verifierProvider: string;
  /** The verifier's model id. */
  readonly verifierModel?: string;
  /** Operator-declared "same model family" flag; if omitted it is inferred from matching providers. */
  readonly sameModelFamily?: boolean;
  /** Who controls the verifier's prompt. */
  readonly promptOwnedBy: Ownership;
  /** Who controls the policy the verifier enforces. */
  readonly policyOwnedBy: Ownership;
  /** Who constructs the context the verifier reads. */
  readonly contextConstructedBy: Ownership;
  /** Deployment isolation between actor and verifier. */
  readonly deploymentBoundary: Boundary;
  /** Credential isolation between actor and verifier. */
  readonly credentialBoundary: Boundary;
}

/** One identified independence risk, with a human-readable explanation. */
export interface IndependenceWarning {
  readonly code: IndependenceWarningCode;
  readonly detail: string;
}

/** Whether two model declarations name the identical provider + model. */
function isSameModel(profile: VerifierIndependenceProfile): boolean {
  return (
    profile.actorModel !== undefined &&
    profile.actorModel === profile.verifierModel &&
    profile.actorProvider !== undefined &&
    profile.actorProvider === profile.verifierProvider
  );
}

/** Same family if explicitly declared, else inferred from a shared (known) provider. */
function isSameFamily(profile: VerifierIndependenceProfile): boolean {
  if (profile.sameModelFamily !== undefined) return profile.sameModelFamily;
  return profile.actorProvider !== undefined && profile.actorProvider === profile.verifierProvider;
}

/**
 * Derive the correlated-failure warnings implied by an independence declaration.
 *
 * Each warning corresponds to one way the verifier's "second opinion" could fail together with, or be
 * steered by, the actor it is meant to check. An empty result means none of the *declared* risks are
 * present — it is not a proof of independence.
 *
 * @param profile - The operator's declared {@link VerifierIndependenceProfile}.
 * @returns The applicable warnings; empty if the declaration shows no listed risk.
 */
export function assessIndependence(profile: VerifierIndependenceProfile): IndependenceWarning[] {
  const warnings: IndependenceWarning[] = [];

  if (isSameModel(profile)) {
    warnings.push({
      code: IndependenceWarningCode.SameModel,
      detail: `actor and verifier both run ${profile.verifierProvider}/${profile.verifierModel}; failures are likely correlated`,
    });
  } else if (isSameFamily(profile)) {
    warnings.push({
      code: IndependenceWarningCode.SameModelFamily,
      detail: `actor and verifier share a model family (provider ${profile.verifierProvider}); failure modes may correlate`,
    });
  }

  if (profile.promptOwnedBy === Ownership.Agent) {
    warnings.push({
      code: IndependenceWarningCode.AgentSuppliedPrompt,
      detail: 'the verifier prompt is actor-controlled; a prompt-injection in the action can steer its own verification',
    });
  }
  if (profile.policyOwnedBy === Ownership.Agent) {
    warnings.push({
      code: IndependenceWarningCode.AgentSuppliedPolicy,
      detail: 'the enforced policy is actor-controlled; the actor can weaken the rules it is checked against',
    });
  }
  if (profile.contextConstructedBy === Ownership.Agent) {
    warnings.push({
      code: IndependenceWarningCode.AgentConstructedContext,
      detail: 'the verifier reads actor-constructed context without independent reconstruction; inputs can be framed to pass',
    });
  }
  if (profile.credentialBoundary === Boundary.Shared) {
    warnings.push({
      code: IndependenceWarningCode.SharedCredentials,
      detail: 'actor and verifier share credentials; a single credential compromise defeats both',
    });
  }
  if (profile.deploymentBoundary === Boundary.Shared) {
    warnings.push({
      code: IndependenceWarningCode.SharedDeployment,
      detail: 'actor and verifier share a deployment boundary; a single host/process compromise defeats both',
    });
  }

  return warnings;
}

/**
 * Convenience predicate: whether a declaration shows none of the listed correlated-failure risks.
 *
 * @param profile - The declared {@link VerifierIndependenceProfile}.
 * @returns `true` when {@link assessIndependence} yields no warnings.
 */
export function isVerifierIndependent(profile: VerifierIndependenceProfile): boolean {
  return assessIndependence(profile).length === 0;
}
