/**
 * Public barrel for the engine module.
 *
 * Re-exports the {@link Engine} (the verdict/decision core that gates {@link GuardRequest}s and
 * emits provenance records) and its construction-time {@link EngineOptions}, so callers import
 * the engine from the module root without depending on internal file layout.
 */

export { Engine, type EngineOptions } from './engine.js';
