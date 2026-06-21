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

import { ProviderKind, PackId, StoreKind, DEFAULT_POSTGRES_URL, type ScaffoldOptions } from './scaffold.js';
import { generateSigningSeed } from './keygen.js';
import { success, warn, dim } from '../term/colors.js';

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

const PROVIDERS: readonly string[] = [ProviderKind.Mock, ProviderKind.Anthropic, ProviderKind.OpenAI];

/**
 * Ask for the second-opinion provider, re-prompting on an unrecognized value instead of silently
 * falling back to `mock`. After a few invalid attempts it defaults to `mock` so a non-interactive or
 * piped run can never hang.
 */
async function askProvider(ask: Ask): Promise<ProviderKind> {
  const prompt = 'Second-opinion provider (mock/anthropic/openai) — mock runs offline; the others need an API key';
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = (await ask('provider', prompt, ProviderKind.Mock)).trim().toLowerCase();
    if (raw === '') return ProviderKind.Mock;
    if (PROVIDERS.includes(raw)) return raw as ProviderKind;
    // Only nag on a real terminal, so tests/pipes stay quiet.
    if (process.stdout.isTTY) process.stderr.write(`  "${raw}" is not a known provider — choose mock, anthropic, or openai\n`);
  }
  return ProviderKind.Mock;
}

/** Tell the operator whether the chosen provider's API key is already in the environment (TTY only). */
function noteProviderKey(provider: ProviderKind): void {
  if (!process.stdout.isTTY) return;
  const envVar = provider === ProviderKind.Anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  if (process.env[envVar]) {
    process.stdout.write(`  ${success(`✓ ${envVar} detected`)} ${dim('— it will be used.')}\n`);
  } else {
    const where = provider === ProviderKind.Anthropic ? 'https://console.anthropic.com' : 'https://platform.openai.com/api-keys';
    process.stdout.write(`  ${warn(`${envVar} is not set`)} ${dim(`— add it to the generated .env before starting (key from ${where}).`)}\n`);
  }
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
 * normalizing freeform input into typed values: an unrecognized provider is
 * re-prompted (then defaults to {@link ProviderKind.Mock}) rather than silently
 * mocked; the store defaults to {@link StoreKind.Postgres} with an unknown value
 * falling back to {@link StoreKind.Memory}; an empty pack selection becomes
 * `[`{@link PackId.Fintech}`]`. When the operator opts in, a fresh signing seed is
 * generated with {@link generateSigningSeed}. The `model` field is omitted for the
 * mock provider since it needs none, and is accepted as-is otherwise (model names
 * are not enumerable; an invalid one fails safe at run time — see below).
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
  const provider = await askProvider(ask);
  if (provider !== ProviderKind.Mock) noteProviderKey(provider);
  const model =
    provider === ProviderKind.Mock
      ? undefined
      : (await ask('model', 'Model', provider === ProviderKind.OpenAI ? 'gpt-5.5' : 'claude-sonnet-4-6')).trim();
  const storeAns = (await ask('store', 'Provenance store (memory/sqlite/postgres)', 'postgres')).trim().toLowerCase();
  const store =
    storeAns === StoreKind.Postgres ? StoreKind.Postgres : storeAns === StoreKind.Sqlite ? StoreKind.Sqlite : StoreKind.Memory;
  let databaseUrl: string | undefined;
  if (store === StoreKind.Postgres) {
    databaseUrl = (await ask('db', 'Postgres URL', DEFAULT_POSTGRES_URL)).trim() || DEFAULT_POSTGRES_URL;
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
