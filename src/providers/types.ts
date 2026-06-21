/**
 * Shared contracts for the cross-model second-opinion providers.
 *
 * Defines the request/verdict shapes and the {@link Provider} interface that every concrete
 * provider (Anthropic, OpenAI, mock) implements. This is the boundary the
 * {@link SecondOpinionCheck} talks to, keeping the gate decoupled from any specific model SDK.
 */

import type { Action, AgentContext } from '../core/types.js';

/**
 * The action, agent context, and question handed to an independent model for review.
 *
 * Carries everything a {@link Provider} needs to judge a proposed action without consulting
 * the originating agent.
 *
 * @see {@link Provider.secondOpinion}
 */
export interface SecondOpinionRequest {
  /** The proposed {@link Action} the independent model must judge. */
  readonly action: Action;
  /** The {@link AgentContext} the action was proposed in, for situational grounding. */
  readonly context: AgentContext;
  /** What the independent model should evaluate about the action. */
  readonly question: string;
}

/**
 * The independent model's judgement of a proposed action.
 *
 * Consumed by {@link SecondOpinionCheck} to map agreement to ALLOW and disagreement to ESCALATE.
 *
 * @see {@link Provider.secondOpinion}
 */
export interface SecondOpinionVerdict {
  /** Does the independent model agree the action is correct/safe to take? */
  readonly agree: boolean;
  /** Optional self-reported confidence in `[0, 1]`; absent when the model omits it. */
  readonly confidence?: number;
  /** Optional short, human-readable justification for the verdict. */
  readonly rationale?: string;
}

/**
 * An independent model used as a cross-model second opinion.
 *
 * Implementations wrap a model SDK (or a deterministic stub) and answer a
 * {@link SecondOpinionRequest} with a {@link SecondOpinionVerdict}. Used by
 * {@link SecondOpinionCheck} as a slow-tier check.
 */
export interface Provider {
  /** Stable identifier for the backing model family (e.g. `anthropic`, `openai`, `mock`). */
  readonly name: string;
  /**
   * Ask the independent model to judge the proposed action.
   *
   * @param req - The action, context, and question to evaluate.
   * @returns The model's {@link SecondOpinionVerdict}.
   * @throws {Error} If the underlying model call or response parsing fails; implementations
   *   surface transport and parse errors rather than swallowing them.
   */
  secondOpinion(req: SecondOpinionRequest): Promise<SecondOpinionVerdict>;
}
