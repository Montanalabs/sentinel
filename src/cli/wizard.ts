/**
 * Interactive configuration flow for the `sentinel init` command.
 *
 * Asks the operator a fixed sequence of questions (project name, port,
 * second-opinion {@link ProviderKind}, model, {@link StoreKind}, built-in
 * {@link PackId} packs, custom-pack template, signing seed) and normalizes the
 * raw answers into validated {@link ScaffoldOptions} for {@link scaffoldFiles}.
 * Prompting is abstracted behind the injected {@link Ask} callback so the flow
 * can run against a real readline interface in the CLI or a stub in tests.
 */

import { ProviderKind, PackId, StoreKind, type ScaffoldOptions } from './scaffold.js';
import { generateSigningSeed } from './keygen.js';

/**
 * Pluggable prompt function: ask one question and resolve to the operator's answer.
 *
 * Injected so the wizard stays I/O-agnostic — the CLI backs it with readline while
 * tests supply canned answers. Implementations should return `def` (the default)
 * when the operator provides no input.
 *
 * @param label - Stable machine-readable key for the question (e.g. `'port'`),
 *   used by callers to special-case individual prompts; not shown to the user.
 * @param prompt - Human-readable question text to display.
 * @param def - Default value to fall back to when the answer is empty.
 * @returns The operator's raw (untrimmed) answer, or `def` when none is given.
 */
export type Ask = (label: string, prompt: string, def: string) => Promise<string>;

const DEFAULT_DB = 'postgres://sentinel:sentinel@localhost:5433/sentinel';

function normProvider(v: string): ProviderKind {
  const p = v.trim().toLowerCase();
  if (p === ProviderKind.Anthropic) return ProviderKind.Anthropic;
  if (p === ProviderKind.OpenAI) return ProviderKind.OpenAI;
  return ProviderKind.Mock;
}

function parsePacks(v: string): PackId[] {
  const valid = new Set<string>([PackId.Fintech, PackId.Healthcare]);
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PackId => valid.has(s));
}

const yes = (v: string): boolean => v.trim().toLowerCase().startsWith('y');

/**
 * Drive the interactive `sentinel init` flow and assemble the scaffold options.
 *
 * Walks the operator through each configuration question via {@link ask},
 * normalizing freeform input into typed values: unknown providers fall back to
 * {@link ProviderKind.Mock}, unknown stores to {@link StoreKind.Memory}, and an empty
 * pack selection to `[`{@link PackId.Fintech}`]`. When the operator opts in, a
 * fresh signing seed is generated with {@link generateSigningSeed}. The `model`
 * field is omitted for the mock provider since it needs none.
 *
 * @param ask - Prompt callback used for every question; see {@link Ask}.
 * @returns Fully-resolved {@link ScaffoldOptions} ready to pass to
 *   {@link scaffoldFiles}.
 * @throws Propagates any rejection from {@link ask} (e.g. a closed input stream
 *   or aborted prompt), which abandons the flow.
 */
export async function runWizard(ask: Ask): Promise<ScaffoldOptions> {
  const name = (await ask('name', 'Project name', 'my-sentinel')).trim() || 'my-sentinel';
  const portRaw = Number((await ask('port', 'Port', '4000')).trim() || '4000');
  // Fall back to 4000 on a non-integer / out-of-range port so generated compose/README are valid.
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 4000;
  const provider = normProvider(await ask('provider', 'Second-opinion provider (mock/anthropic/openai)', 'mock'));
  const model =
    provider === ProviderKind.Mock
      ? undefined
      : (await ask('model', 'Model', provider === ProviderKind.OpenAI ? 'gpt-5.5' : 'claude-sonnet-4-6')).trim();
  const storeAns = (await ask('store', 'Provenance store (memory/sqlite/postgres)', 'memory')).trim().toLowerCase();
  const store =
    storeAns === StoreKind.Postgres ? StoreKind.Postgres : storeAns === StoreKind.Sqlite ? StoreKind.Sqlite : StoreKind.Memory;
  let databaseUrl: string | undefined;
  if (store === StoreKind.Postgres) {
    databaseUrl = (await ask('db', 'Postgres URL', DEFAULT_DB)).trim() || DEFAULT_DB;
  } else if (store === StoreKind.Sqlite) {
    const path = (await ask('db', 'SQLite file path', './sentinel.db')).trim() || './sentinel.db';
    databaseUrl = `sqlite:${path}`;
  }
  const packs = parsePacks(await ask('packs', 'Built-in packs (comma: fintech,healthcare)', 'fintech'));
  const customPack = yes(await ask('customPack', 'Include a custom pack template? (Y/n)', 'y'));
  const signingSeed = yes(await ask('seed', 'Generate a signing seed now? (Y/n)', 'y')) ? generateSigningSeed() : '';

  return {
    name,
    port,
    provider,
    ...(model ? { model } : {}),
    store,
    ...(databaseUrl ? { databaseUrl } : {}),
    packs: packs.length ? packs : [PackId.Fintech],
    customPack,
    signingSeed,
  };
}
