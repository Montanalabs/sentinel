import type { FastifyInstance } from 'fastify';
import { Signer } from '../provenance/signing.js';
import { RecordBuilder } from '../provenance/record.js';
import { openStore } from '../store/index.js';
import type { ProvenanceStore } from '../store/types.js';
import { Engine } from '../engine/engine.js';
import { EscalationManager, type Escalation } from './escalation.js';
import { buildServer } from './server.js';
import { defaultRegistry, type DefaultPacksConfig, type PolicyPack } from '../policy-packs/index.js';
import { makeProvider, type ProviderConfig } from '../providers/index.js';
import type { LedgerConnector, ClinicalConnector } from '../connectors/types.js';
import type { SentinelConfig } from '../config.js';

/**
 * Composition root for the Sentinel sidecar: wires the {@link ProvenanceStore},
 * {@link Signer}, {@link RecordBuilder}, second-opinion provider, policy-pack
 * {@link defaultRegistry}, {@link EscalationManager}, gate {@link Engine}, and the
 * Fastify HTTP server from a single {@link SentinelConfig}. This is the seam the
 * CLI entrypoint and tests share to obtain a ready-to-listen sidecar.
 */

/**
 * Build a {@link RecordBuilder} that continues the provenance chain from the
 * store's persisted tail, so restarts append after the last record instead of
 * starting a fresh chain.
 *
 * @param store - Backing provenance store whose chain tail is read to resume from.
 * @param signer - Signer the returned builder uses to sign appended records.
 * @returns A builder resumed at the tail's hash and sequence, or a fresh builder
 *   when the store is empty.
 * @throws If reading the persisted chain tail from {@link ProvenanceStore} fails
 *   (e.g. the backing store is unavailable).
 */
export async function createResumedBuilder(store: ProvenanceStore, signer: Signer): Promise<RecordBuilder> {
  const builder = new RecordBuilder(signer);
  const tail = await store.tail();
  if (tail) builder.resume(tail.contentHash, tail.seq + 1);
  return builder;
}

/**
 * Live handles to a wired Sentinel sidecar: the Fastify {@link FastifyInstance},
 * the {@link ProvenanceStore}, the gate {@link Engine}, the
 * {@link EscalationManager}, and the {@link Signer}. Call {@link BuiltSentinel.close}
 * to release the HTTP server and store.
 */
export interface BuiltSentinel {
  readonly app: FastifyInstance;
  readonly store: ProvenanceStore;
  readonly engine: Engine;
  readonly escalations: EscalationManager;
  readonly signer: Signer;
  close(): Promise<void>;
}

/**
 * Optional dependency overrides for {@link buildSentinel}: real
 * {@link LedgerConnector}/{@link ClinicalConnector} implementations and
 * policy-pack configuration. Omitted fields fall back to built-in defaults.
 */
export interface BootstrapOverrides {
  readonly ledger?: LedgerConnector;
  readonly clinical?: ClinicalConnector;
  readonly packs?: DefaultPacksConfig;
  /** Custom packs to register alongside the built-ins. */
  readonly extraPacks?: readonly PolicyPack[];
}

function webhookNotifier(url: string): (escalation: Escalation) => Promise<void> {
  return async (escalation) => {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'sentinel.escalation', escalation }),
    });
  };
}

/**
 * Wire a fully-functional Sentinel sidecar from configuration.
 *
 * Opens the store, derives or generates the {@link Signer}, resumes the
 * provenance chain, constructs the second-opinion provider and policy-pack
 * registry, then assembles the {@link Engine} and Fastify server. The slow-tier
 * budget defaults higher for real model providers (12s) than for the mock (5s)
 * since live second opinions take seconds.
 *
 * @param config - Resolved sidecar configuration (database URL, signing seed,
 *   provider selection, budgets, rate-limit/concurrency tuning).
 * @param overrides - Optional real connectors and extra policy packs; see
 *   {@link BootstrapOverrides}.
 * @returns Live handles to the wired sidecar; call {@link BuiltSentinel.close}
 *   to release the HTTP server and store.
 * @throws If opening the {@link ProvenanceStore} from `config.databaseUrl` fails.
 * @throws If resuming the provenance chain via {@link createResumedBuilder} fails
 *   (propagated from the store's tail read).
 */
export async function buildSentinel(config: SentinelConfig, overrides: BootstrapOverrides = {}): Promise<BuiltSentinel> {
  const store = await openStore(config.databaseUrl);
  let signer: Signer;
  if (config.signingSeed) {
    signer = Signer.fromSeed(Buffer.from(config.signingSeed, 'base64'));
  } else {
    // No seed → a fresh key every boot, so prior provenance signatures become unverifiable and
    // `/v1/verify` (pinned to the new key) rejects the old chain. Fine for dev; loud in prod.
    console.warn(
      '[sentinel] WARNING: SENTINEL_SIGNING_SEED is unset — generating an EPHEMERAL signing key. ' +
        'Provenance signed before this boot will NOT verify against it. Set a stable seed ' +
        '(`npx sentinel keygen`) for any non-throwaway deployment.',
    );
    signer = Signer.generate();
  }
  const builder = await createResumedBuilder(store, signer);

  const providerConfig: ProviderConfig = {
    ...(config.secondOpinionProvider === 'openai'
      ? config.openaiApiKey
        ? { apiKey: config.openaiApiKey }
        : {}
      : config.anthropicApiKey
        ? { apiKey: config.anthropicApiKey }
        : {}),
    ...(config.secondOpinionModel ? { model: config.secondOpinionModel } : {}),
  };
  const provider = makeProvider(config.secondOpinionProvider, providerConfig);

  const registry = defaultRegistry(
    {
      provider,
      ...(overrides.ledger ? { ledger: overrides.ledger } : {}),
      ...(overrides.clinical ? { clinical: overrides.clinical } : {}),
    },
    overrides.packs ?? {},
  );
  for (const pack of overrides.extraPacks ?? []) registry.register(pack);

  const escalations = new EscalationManager(
    config.escalationWebhookUrl ? { notify: webhookNotifier(config.escalationWebhookUrl) } : {},
  );
  // Real model second-opinions take several seconds; give the slow tier headroom.
  const slowBudgetMs = config.slowBudgetMs ?? (config.secondOpinionProvider === 'mock' ? 5_000 : 12_000);
  const engine = new Engine({ resolve: (id) => registry.resolve(id), builder, store, slowBudgetMs });
  const app = buildServer({
    engine,
    store,
    escalations,
    builder,
    ...(config.rateLimit ? { rateLimit: config.rateLimit } : {}),
    ...(config.maxConcurrent !== undefined ? { maxConcurrent: config.maxConcurrent } : {}),
    ...(config.maxBodyBytes !== undefined ? { maxBodyBytes: config.maxBodyBytes } : {}),
    ...(config.trustedKeyIds ? { additionalTrustedKeyIds: config.trustedKeyIds } : {}),
  });

  return {
    app,
    store,
    engine,
    escalations,
    signer,
    async close() {
      await app.close();
      await store.close();
    },
  };
}
