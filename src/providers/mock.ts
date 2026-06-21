/**
 * Deterministic in-process {@link Provider} implementation.
 *
 * Lets the second-opinion path run without any model SDK or API key, by returning a verdict
 * from an injected pure function. Used by tests and key-less local runs.
 */

import type { Provider, SecondOpinionRequest, SecondOpinionVerdict } from './types.js';

/** Deterministic in-process provider for tests and key-less local runs. */
export class MockProvider implements Provider {
  /** Identifier reported to {@link SecondOpinionCheck}; always `mock`. */
  readonly name = 'mock';
  /**
   * @param fn - Pure mapping from request to verdict; defaults to always agreeing
   *   (`{ agree: true }`), so the gate allows unless a caller wires in a stricter stub.
   */
  constructor(private readonly fn: (req: SecondOpinionRequest) => SecondOpinionVerdict = () => ({ agree: true })) {}
  /**
   * Resolve the verdict for a request by invoking the injected function.
   *
   * @param req - The {@link SecondOpinionRequest} to judge.
   * @returns The {@link SecondOpinionVerdict} produced by the injected function.
   */
  async secondOpinion(req: SecondOpinionRequest): Promise<SecondOpinionVerdict> {
    return this.fn(req);
  }
}
