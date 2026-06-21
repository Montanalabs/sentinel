/**
 * Process entrypoint for the Sentinel sidecar. Loads environment and config,
 * pulls in any user {@link loadExtensions}, wires the sidecar via
 * {@link buildSentinel}, and starts the HTTP listener. On startup failure it logs
 * and exits non-zero. This is the module run by the container/CLI.
 */
import { loadEnvFile, loadConfig } from '../config.js';
import { buildSentinel, type BootstrapOverrides } from './bootstrap.js';
import { loadExtensions } from './extensions.js';
import { StaticLedgerConnector } from '../connectors/static-ledger.js';
import { accent, bold, dim, success, danger } from '../term/colors.js';

/**
 * Sidecar entrypoint. Loads .env, optionally a `sentinel.config.{mjs,js}` for
 * your connectors + custom packs, wires Sentinel, and listens.
 *
 * Falls back to a labelled demo {@link StaticLedgerConnector} when no real ledger
 * is supplied, so the gate blocks sanctioned/overdraw actions out of the box.
 *
 * @throws If config/extension loading, {@link buildSentinel} wiring, or binding
 *   the listen port fails; the caller logs and exits the process.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const ext = await loadExtensions(process.cwd(), process.env);

  // Your real connector (from sentinel.config) wins; otherwise a labelled demo
  // ledger so the gate blocks sanctioned/overdraw out of the box for trials.
  const ledger =
    ext.ledger ??
    new StaticLedgerConnector({
      balances: { acct_treasury: 5_000_000, acct_ops: 250_000, acct_1: 100_000 },
      sanctioned: ['acct_ofac_1', 'acct_evil'],
    });

  const overrides: BootstrapOverrides = {
    ledger,
    ...(ext.clinical ? { clinical: ext.clinical } : {}),
    ...(ext.packs ? { extraPacks: ext.packs } : {}),
  };

  const { app, signer } = await buildSentinel(config, overrides);
  await app.listen({ port: config.sidecarPort, host: '0.0.0.0' });
  const extra = ext.packs?.length ? `, +${ext.packs.length} custom pack(s)` : '';
  // eslint-disable-next-line no-console
  console.log(
    `${success('✓')} ${bold('Sentinel')} sidecar listening on ${accent(`http://localhost:${config.sidecarPort}`)} ` +
      dim(`(signer ${signer.keyId}, provider ${config.secondOpinionProvider}${extra})`),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(danger('Sentinel sidecar failed to start:'), err);
  process.exit(1);
});
