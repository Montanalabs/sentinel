#!/usr/bin/env node
/**
 * Command-line entry point for the `sentinel` binary.
 *
 * Parses `process.argv` and dispatches the top-level commands: `init` (run the
 * {@link runWizard} flow and {@link scaffoldFiles} a project), `start` (boot the
 * sidecar from `.env`), `keygen` (print a {@link generateSigningSeed} seed),
 * `verify` (check a running sidecar's provenance chain), plus `version`/`help`.
 * This module owns all CLI I/O — argument parsing, readline prompting, writing
 * scaffolded files to disk, and process exit codes; the pure logic lives in the
 * sibling `scaffold`, `wizard`, and `keygen` modules.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { scaffoldFiles, type ScaffoldOptions } from './scaffold.js';
import { runWizard, type Ask } from './wizard.js';
import { generateSigningSeed } from './keygen.js';
import { heroBanner, startBanner, accent } from './brand.js';
import { VERSION } from './version.js';

/** Print the usage banner and command list to stdout. */
function help(): void {
  stdout.write(
    `Sentinel — independent action-gate for AI agents (v${VERSION})

Usage: sentinel <command> [options]

Commands:
  init [dir] [--yes]   Interactive setup wizard + scaffold (—-yes uses defaults, non-interactive)
  start                Run the sidecar from the current environment (.env)
  keygen               Print a base64 Ed25519 signing seed for SENTINEL_SIGNING_SEED
  verify [url]         Verify the provenance chain of a running sidecar (default http://localhost:4000)
  version | help
`,
  );
}

/**
 * Render {@link scaffoldFiles} for `opts` and write them under `target`.
 *
 * Existing files are left untouched (logged as `skip (exists)`) so re-running
 * `init` never clobbers operator edits; missing parent directories are created.
 *
 * @param target - Absolute destination directory for the generated project.
 * @param opts - Operator choices forwarded to {@link scaffoldFiles}.
 * @throws If a file or directory cannot be written (filesystem error from
 *   `mkdirSync`/`writeFileSync`, e.g. permission denied).
 */
function writeScaffold(target: string, opts: ScaffoldOptions): void {
  const files = scaffoldFiles(opts);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(target, rel);
    if (existsSync(p)) {
      stdout.write(`  skip (exists): ${rel}\n`);
      continue;
    }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    stdout.write(`  created ${rel}\n`);
  }
}

/**
 * Run the `sentinel init` command: configure, scaffold, and optionally bootstrap.
 *
 * In `interactive` mode an operator is walked through {@link runWizard} and asked whether to start
 * the sidecar; otherwise defaults are used. The project is always scaffolded into a dedicated
 * directory — the explicit `dir` if given, else a subfolder named after the project — so `init`
 * never dumps files into the current directory. Generated files run on the `sentinel` binary (or
 * the Docker image); there is no `npm install` step.
 *
 * @param dir - Target directory (relative or absolute). When omitted, a subfolder named after the
 *   project is created in the current directory.
 * @param interactive - Whether to prompt the operator (TTY) or accept defaults.
 * @throws Propagates wizard rejections from {@link runWizard} and filesystem
 *   errors from {@link writeScaffold}.
 */
async function init(dir: string | undefined, interactive: boolean): Promise<void> {
  const nameDefault = dir ? basename(resolve(dir)) : 'my-sentinel';

  let opts: ScaffoldOptions = { name: nameDefault };
  let startNow = false;

  stdout.write(`\n${heroBanner({ version: `v${VERSION}` })}\n`);

  if (interactive) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ask: Ask = async (label, prompt, def) => {
      const d = label === 'name' ? nameDefault : def;
      const answer = await rl.question(`${prompt} [${d}]: `);
      return answer.trim() === '' ? d : answer;
    };
    stdout.write(`\n${accent('Configure your gate')}\n\n`);
    opts = await runWizard(ask);
    stdout.write('\n');
    startNow = (await rl.question('Start the sidecar now? [Y/n]: ')).trim().toLowerCase() !== 'n';
    rl.close();
  }

  // Always scaffold into a folder of its own: the explicit dir, else a subfolder named after the
  // project. Never the bare cwd (which dumped files into the user's home).
  const folder = (dir ?? opts.name ?? 'my-sentinel').trim().replace(/\s+/g, '-') || 'my-sentinel';
  const target = resolve(folder);
  const rel = relative(process.cwd(), target) || '.';

  stdout.write(`\nScaffolding into ${target}:\n`);
  writeScaffold(target, opts);

  if (startNow) {
    stdout.write('\nStarting the sidecar (Ctrl+C to stop)…\n');
    const res = spawnSync('sentinel', ['start'], { cwd: target, stdio: 'inherit' });
    if (res.error) {
      stdout.write(`\nCould not run 'sentinel start' (${res.error.message}).\n  cd ${rel} && sentinel start\n`);
    }
  } else {
    stdout.write(
      `\nDone. Next:\n  cd ${rel}\n  sentinel keygen   # optional: set SENTINEL_SIGNING_SEED in .env for a stable identity\n` +
        `  sentinel start    # gate on http://localhost:${opts.port ?? 4000}\n`,
    );
  }
}

/**
 * Run the `sentinel verify` command against a running sidecar.
 *
 * Calls the sidecar's `/v1/verify` endpoint, prints the JSON result, and exits the
 * process with code `0` when the provenance chain is intact (`ok: true`) or `1`
 * otherwise — so the command is usable as a CI/health gate.
 *
 * @param url - Sidecar base URL; falls back to `SENTINEL_URL` then
 *   `http://localhost:4000`. Trailing slashes are stripped.
 * @throws If the HTTP request fails (network error from `fetch`) or the response
 *   body is not valid JSON.
 */
async function verify(url: string | undefined): Promise<void> {
  const base = (url ?? process.env.SENTINEL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/verify`);
  const body = (await res.json()) as { ok: boolean };
  stdout.write(JSON.stringify(body) + '\n');
  process.exit(body.ok ? 0 : 1);
}

/** Parse argv and dispatch the command. Wrapped (not top-level await) so the CLI bundles into a
 * single executable for the standalone binary build. */
async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const yesFlag = args.includes('--yes') || args.includes('-y');

  switch (cmd) {
    case 'init':
      await init(positional[0], Boolean(stdin.isTTY) && !yesFlag);
      break;
    case 'keygen':
      stdout.write(generateSigningSeed() + '\n');
      break;
    case 'start':
      stdout.write(`\n${startBanner({ version: `v${VERSION}` })}\n`);
      await import('../sidecar/main.js'); // boots the sidecar from env
      break;
    case 'verify':
      await verify(positional[0]);
      break;
    case 'version':
    case '--version':
    case '-v':
      stdout.write(VERSION + '\n');
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n`);
      help();
      process.exit(1);
  }
}

run().catch((err) => {
  process.stderr.write(`sentinel: ${(err as Error).message}\n`);
  process.exit(1);
});
