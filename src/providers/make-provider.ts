/**
 * Name-keyed factory for second-opinion {@link Provider} implementations.
 *
 * Lets configuration-driven wiring (the sidecar bootstrap, the CLI) construct a provider from a
 * plain string key without importing each concrete class. The barrel re-exports {@link makeProvider}
 * and {@link ProviderConfig}; callers should import from the module barrel, not this file directly.
 */

import type { Provider } from './types.js';
import { MockProvider } from './mock.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

/**
 * API-key/model settings passed through to a constructed {@link Provider}.
 *
 * Forwarded verbatim to {@link AnthropicProvider} / {@link OpenAIProvider}; ignored by
 * {@link MockProvider}.
 */
export interface ProviderConfig {
  /** API key for the selected provider; falls back to the provider's env var when omitted. */
  apiKey?: string;
  /** Model id override; each provider supplies its own default when omitted. */
  model?: string;
}

/**
 * Construct a second-opinion provider by name. `mock` needs no API key.
 *
 * @param name - Provider key: `anthropic`, `openai`, or `mock`.
 * @param config - Key/model settings forwarded to the provider; see {@link ProviderConfig}.
 *   Unused for `mock`.
 * @returns The constructed {@link Provider}.
 * @throws {Error} If `name` is not a recognized provider.
 */
export function makeProvider(name: string, config: ProviderConfig = {}): Provider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'mock':
      return new MockProvider();
    default:
      throw new Error(`unknown provider: ${name}`);
  }
}
