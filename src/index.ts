/**
 * Sentinel — the independent verification & action-gate for AI agents.
 *
 * The model proposes a consequential action; Sentinel independently verifies it
 * (policy, schema, ground-truth reconciliation, data-boundary, cross-model second
 * opinion), returns ALLOW / BLOCK / ESCALATE, and emits a signed, tamper-evident
 * provenance record for every decision.
 */
export * from './core/index.js';
export * from './checks/index.js';
export * from './provenance/index.js';
export * from './store/index.js';
export * from './engine/index.js';
export * from './providers/index.js';
export * from './connectors/index.js';
export * from './policy-packs/index.js';
export * from './analytics/index.js';
export { buildServer, type SidecarDeps } from './sidecar/server.js';
export { buildSentinel, createResumedBuilder, type BuiltSentinel } from './sidecar/bootstrap.js';
export { EscalationManager, type Escalation } from './sidecar/escalation.js';
export { loadConfig, loadEnvFile, parseDotenv, type SentinelConfig } from './config.js';
