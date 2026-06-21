/**
 * Public barrel for the policy-packs module.
 *
 * Re-exports the registry contracts ({@link PolicyRegistry}, {@link PolicyPack},
 * {@link PackDeps}), the built-in vertical packs, and {@link defaultRegistry} — the one-call way
 * to obtain a registry pre-loaded with every shipped pack. This is the entry point the engine and
 * host wiring import from rather than reaching into individual pack files.
 */
export { PolicyRegistry } from './registry.js';
export type { PackDeps, PolicyPack } from './registry.js';
export { fintechPaymentsPack, type FintechPaymentsConfig } from './fintech-payments.js';
export { healthcareRecordsPack, type HealthcareRecordsConfig } from './healthcare-records.js';
export { defaultRegistry, type DefaultPacksConfig } from './default-registry.js';
