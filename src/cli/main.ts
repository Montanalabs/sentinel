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
import { spawn, spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { scaffoldFiles, StoreKind, DEFAULT_POSTGRES_URL, type ScaffoldOptions } from './scaffold.js';
import { runWizard, type Ask } from './wizard.js';
import { generateSigningSeed } from './keygen.js';
import { heroBanner, startBanner, accent, dim, colorEnabled } from './brand.js';
import { success, danger } from '../term/colors.js';
import { VERSION } from './version.js';

/** Braille spinner frames for the branded Postgres bring-up animation. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/**
 * Bring up the wizard's bundled Postgres via `docker compose up -d postgres`, hiding Docker's raw
 * output behind a branded spinner. Returns the captured stderr so the caller can give an actionable
 * message (e.g. port-in-use) when the bring-up fails.
 *
 * @param cwd - Scaffolded project directory containing the generated `docker-compose.yml`.
 * @returns `{ ok }` true when the container started; `stderr` carries Docker's diagnostics on failure.
 */
async function bringUpPostgres(cwd: string): Promise<{ ok: boolean; stderr: string }> {
  const animate = process.stdout.isTTY && colorEnabled();
  const label = 'Spinning up Postgres · first run pulls the image…';
  let stderr = '';
  if (!animate) stdout.write(`  ${accent('✦')} ${dim(label)}\n`);
  return await new Promise((resolveP) => {
    const child = spawn('docker', ['compose', 'up', '-d', 'postgres'], { cwd });
    let i = 0;
    const timer = animate
      ? setInterval(() => {
          const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length] ?? SPINNER_FRAMES[0];
          stdout.write(`\r  ${accent(frame)} ${dim(label)}`);
        }, 90)
      : undefined;
    child.stdout?.on('data', () => {}); // drain Docker's progress so it stays hidden
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e: Error) => (stderr += e.message));
    child.on('close', (code) => {
      if (timer) {
        clearInterval(timer);
        stdout.write('\r\x1b[2K'); // wipe the spinner line before the caller prints the result
      }
      resolveP({ ok: code === 0, stderr });
    });
  });
}

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
    // A Postgres gate needs the database reachable first, or `sentinel start` dead-ends on a
    // connection error. The wizard only manages the Postgres *it* bundles (the DEFAULT_POSTGRES_URL
    // compose service); a user-supplied URL is bring-your-own and Docker is left untouched.
    if (opts.store === StoreKind.Postgres) {
      const usesBundledPostgres = opts.databaseUrl === DEFAULT_POSTGRES_URL;
      if (!usesBundledPostgres) {
        // Operator pointed SENTINEL_DATABASE_URL at their own Postgres — respect it, no container.
        stdout.write(`\n  ${success('✓')} ${dim('Using your Postgres (SENTINEL_DATABASE_URL) — skipping Docker.')}\n`);
      } else {
        // `docker compose version` is non-zero when Docker is absent OR only the legacy v1
        // `docker-compose` (no `compose` subcommand) is installed — both mean we can't bring it up.
        const hasDocker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
        if (!hasDocker) {
          stdout.write(
            `\n  ${danger('✗')} The bundled Postgres needs Docker (with the \`docker compose\` plugin), which isn't available.\n` +
              `  ${dim('Pick one, then')} ${accent(`cd ${rel} && sentinel start`)}${dim(':')}\n` +
              `    ${accent('•')} ${dim('No infra:')} set ${accent('SENTINEL_DATABASE_URL=sqlite:./sentinel.db')} ${dim('in .env — durable, single-node, no server.')}\n` +
              `    ${accent('•')} ${dim('Your own Postgres:')} set ${accent('SENTINEL_DATABASE_URL')} ${dim('to its URL (local, RDS, Neon, …).')}\n` +
              `    ${accent('•')} ${dim('Install Docker:')} ${dim('https://docs.docker.com/get-docker/, then re-run')} ${accent('sentinel init')}${dim('.')}\n`,
          );
          return; // don't auto-start into a connection error
        }
        const pg = await bringUpPostgres(target);
        if (!pg.ok) {
          const portClash = /already (allocated|in use)|address already in use|bind for/i.test(pg.stderr);
          stdout.write(
            `\n  ${danger('✗')} Couldn't start the bundled Postgres.\n` +
              (portClash
                ? `  Host port 5433 is already in use. Free it, or set SENTINEL_DATABASE_URL in .env to your own\n  Postgres, then run 'sentinel start'.\n`
                : `  ${dim(pg.stderr.trim().split('\n').slice(-3).join('\n  '))}\n  Fix the above (or point SENTINEL_DATABASE_URL at your own Postgres), then run 'sentinel start'.\n`),
          );
          return; // never start the sidecar into a missing/foreign database
        }
        stdout.write(`  ${success('✓')} ${dim('Postgres ready on localhost:5433')}\n`);
      }
    }
    // --watch so edits to .env (e.g. adding your API key) are picked up live during onboarding.
    stdout.write('\nStarting the sidecar (Ctrl+C to stop) — edits to .env reload automatically…\n');
    const res = spawnSync('sentinel', ['start', '--watch'], { cwd: target, stdio: 'inherit' });
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
