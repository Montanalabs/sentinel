/**
 * OpenAI-backed implementation of the second-opinion {@link Provider}.
 *
 * Wraps the `openai` SDK chat-completions API behind the narrow {@link OpenAILike} surface so
 * the client can be injected in tests. Prompt construction and verdict parsing are delegated to
 * the shared {@link buildSecondOpinionPrompt} / {@link parseVerdictJson} helpers, keeping this
 * file responsible only for the transport.
 */

import OpenAI from 'openai';
import type { Provider, SecondOpinionRequest, SecondOpinionVerdict } from './types.js';
import { buildSecondOpinionPrompt, parseVerdictJson } from './prompt.js';

/** Minimal surface of the OpenAI client used here (enables injection in tests). */
export interface OpenAILike {
  chat: {
    completions: {
      create(args: {
        model: string;
        messages: Array<{ role: 'user'; content: string }>;
      }): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
    };
  };
}

/**
 * Construction options for {@link OpenAIProvider}.
 *
 * All fields are optional: an injected {@link OpenAILike} client takes precedence, otherwise a
 * real client is lazily built from `apiKey` (falling back to `OPENAI_API_KEY`).
 */
export interface OpenAIProviderOptions {
  /** Pre-built client to use instead of constructing one; primarily for tests. */
  client?: OpenAILike;
  /** API key; defaults to `process.env.OPENAI_API_KEY` when omitted. */
  apiKey?: string;
  /** Model id; defaults to the module's pinned model. */
  model?: string;
}

/** Default model used when {@link OpenAIProviderOptions.model} is unset. */
const DEFAULT_MODEL = 'gpt-5.5';

/** Cross-model second-opinion provider backed by the OpenAI API. */
export class OpenAIProvider implements Provider {
  /** Identifier reported to {@link SecondOpinionCheck}; always `openai`. */
  readonly name = 'openai';
  private readonly model: string;
  private clientInstance?: OpenAILike;

  /**
   * @param opts - Client/key/model overrides; see {@link OpenAIProviderOptions}. Defaults to
   *   `{}`, deferring the API key to `OPENAI_API_KEY` and the model to {@link DEFAULT_MODEL}.
   */
  constructor(private readonly opts: OpenAIProviderOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    if (opts.client) this.clientInstance = opts.client;
  }

  private client(): OpenAILike {
    if (!this.clientInstance) {
      const apiKey = this.opts.apiKey ?? process.env.OPENAI_API_KEY;
      this.clientInstance = new OpenAI({ apiKey }) as unknown as OpenAILike;
    }
    return this.clientInstance;
  }

  /**
   * Ask the OpenAI model to independently judge the proposed action.
   *
   * Builds the reviewer prompt, sends it as a single user message, and parses the first
   * choice's content into a verdict.
   *
   * @param req - The action, context, and question to evaluate.
   * @returns The parsed {@link SecondOpinionVerdict}.
   * @throws {Error} If the chat-completions API call fails (transport, auth, or rate limit).
   * @throws {Error} If the response contains no content for the first choice.
   * @throws {Error} If {@link parseVerdictJson} finds no JSON object or no `agree` field in the
   *   reply.
   * @throws {SyntaxError} If the reply content is not valid JSON.
   */
  async secondOpinion(req: SecondOpinionRequest): Promise<SecondOpinionVerdict> {
    const prompt = buildSecondOpinionPrompt(req);
    const resp = await this.client().chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.choices[0]?.message.content;
    if (!text) throw new Error('OpenAI response contained no content');
    return parseVerdictJson(text);
  }
}
