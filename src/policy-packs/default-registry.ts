/**
 * Factory for a {@link PolicyRegistry} pre-loaded with every built-in vertical pack.
 *
 * The one-call entry point the engine and host wiring use to obtain a ready registry without
 * reaching into individual pack files. The barrel re-exports {@link defaultRegistry} and
 * {@link DefaultPacksConfig}; import them from the module barrel rather than this file.
 */

import { PolicyRegistry, type PackDeps } from './registry.js';
import { fintechPaymentsPack, type FintechPaymentsConfig } from './fintech-payments.js';
import { healthcareRecordsPack, type HealthcareRecordsConfig } from './healthcare-records.js';

/**
 * Per-pack configuration for {@link defaultRegistry}.
 *
 * Each field forwards to the corresponding built-in pack's config; omit a field to accept that
 * pack's defaults.
 */
export interface DefaultPacksConfig {
  /** Overrides for the `fintech.payments` pack; see {@link FintechPaymentsConfig}. */
  fintech?: FintechPaymentsConfig;
  /** Overrides for the `healthcare.record_write` pack; see {@link HealthcareRecordsConfig}. */
  healthcare?: HealthcareRecordsConfig;
}

/**
 * Construct a {@link PolicyRegistry} pre-loaded with every built-in vertical pack.
 *
 * Registers {@link fintechPaymentsPack} and {@link healthcareRecordsPack}, each configured from
 * the matching field of `config`, sharing the supplied {@link PackDeps}.
 *
 * @param deps - Connectors and provider threaded into every registered pack at resolve time.
 * @param config - Optional per-pack overrides; see {@link DefaultPacksConfig}.
 * @returns A registry ready to {@link PolicyRegistry.resolve} any built-in policy reference.
 * @example
 * const registry = defaultRegistry({ ledger, provider }, { fintech: { highValueThreshold: 50000 } });
 * const checks = registry.resolve('fintech.payments');
 */
export function defaultRegistry(deps: PackDeps = {}, config: DefaultPacksConfig = {}): PolicyRegistry {
  return new PolicyRegistry(deps)
    .register(fintechPaymentsPack(config.fintech))
    .register(healthcareRecordsPack(config.healthcare));
}
