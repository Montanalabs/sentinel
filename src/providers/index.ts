/**
 * Public barrel for the second-opinion providers module.
 *
 * Re-exports the {@link Provider} contract, the concrete provider implementations, the shared
 * prompt/parse helpers, the {@link SecondOpinionCheck} adapter, and the {@link makeProvider}
 * name-keyed factory used by configuration-driven wiring.
 */

export type { Provider, SecondOpinionRequest, SecondOpinionVerdict } from './types.js';
export { MockProvider } from './mock.js';
export { AnthropicProvider, type AnthropicLike } from './anthropic.js';
export { OpenAIProvider, type OpenAILike } from './openai.js';
export { SecondOpinionCheck, type SecondOpinionOptions } from './second-opinion.js';
export { buildSecondOpinionPrompt, parseVerdictJson } from './prompt.js';
export { makeProvider, type ProviderConfig } from './make-provider.js';
