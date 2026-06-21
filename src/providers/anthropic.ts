/**
 * Anthropic-backed implementation of the second-opinion {@link Provider}.
 *
 * Wraps the `@anthropic-ai/sdk` Messages API behind the narrow {@link AnthropicLike} surface so
 * the client can be injected in tests. Prompt construction and verdict parsing are delegated to
 * the shared {@link buildSecondOpinionPrompt} / {@link parseVerdictJson} helpers, keeping this
 * file responsible only for the transport.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Provider, SecondOpinionRequest, SecondOpinionVerdict } from './types.js';
import { buildSecondOpinionPrompt, parseVerdictJson } from './prompt.js';

/** Minimal surface of the Anthropic client used here (enables injection in tests). */
export interface AnthropicLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      messages: Array<{ role: 'user'; content: string }>;
    }): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

/**
 * Construction options for {@link AnthropicProvider}.
 *
 * All fields are optional: an injected {@link AnthropicLike} client takes precedence, otherwise
 * a real client is lazily built from `apiKey` (falling back to `ANTHROPIC_API_KEY`).
 */
export interface AnthropicProviderOptions {
  /** Pre-built client to use instead of constructing one; primarily for tests. */
  client?: AnthropicLike;
  /** API key; defaults to `process.env.ANTHROPIC_API_KEY` when omitted. */
  apiKey?: string;
  /** Model id; defaults to the module's pinned Claude model. */
  model?: string;
  /** Upper bound on response tokens; defaults to 512. */
  maxTokens?: number;
}

/** Default Claude model used when {@link AnthropicProviderOptions.model} is unset. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Cross-model second-opinion provider backed by the Anthropic API. */
export class AnthropicProvider implements Provider {
  /** Identifier reported to {@link SecondOpinionCheck}; always `anthropic`. */
  readonly name = 'anthropic';
  private readonly model: string;
  private readonly maxTokens: number;
  private clientInstance?: AnthropicLike;

  /**
   * @param opts - Client/key/model overrides; see {@link AnthropicProviderOptions}. Defaults to
   *   `{}`, deferring the API key to `ANTHROPIC_API_KEY` and the model to {@link DEFAULT_MODEL}.
   */
  constructor(private readonly opts: AnthropicProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? 512;
    if (opts.client) this.clientInstance = opts.client;
  }

  private client(): AnthropicLike {
    if (!this.clientInstance) {
      const apiKey = this.opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      this.clientInstance = new Anthropic({ apiKey }) as unknown as AnthropicLike;
    }
    return this.clientInstance;
  }

  /**
   * Ask Claude to independently judge the proposed action.
   *
   * Builds the reviewer prompt, sends it as a single user message, concatenates the text blocks
   * of the reply, and parses them into a verdict.
   *
   * @param req - The action, context, and question to evaluate.
   * @returns The parsed {@link SecondOpinionVerdict}.
   * @throws {Error} If the Anthropic Messages API call fails (transport, auth, or rate limit).
   * @throws {Error} If {@link parseVerdictJson} finds no JSON object or no `agree` field in the
   *   reply.
   * @throws {SyntaxError} If the extracted reply text is not valid JSON.
   */
  async secondOpinion(req: SecondOpinionRequest): Promise<SecondOpinionVerdict> {
    const prompt = buildSecondOpinionPrompt(req);
    const resp = await this.client().messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return parseVerdictJson(text);
  }
}
