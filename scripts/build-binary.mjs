/**
 * Build a standalone `sentinel` executable via Node's Single Executable Applications (SEA).
 *
 * Steps: bundle the CLI into one CJS file (esbuild) -> generate the SEA blob -> copy the running
 * Node binary -> inject the blob (postject). Produces `build/sentinel` (or `build/sentinel.exe`).
 *
 * REQUIRES a statically-linked Node binary (the official node.org builds / the ones GitHub
 * Actions `setup-node` installs). Homebrew's node is dynamically linked and will NOT work here —
 * run this in CI, not against `brew install node`.
 *
 * Usage:  node scripts/build-binary.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { inject } from 'postject';

const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const OUT = 'build';
const BUNDLE = join(OUT, 'sentinel.cjs');
const BLOB = join(OUT, 'sentinel.blob');
const BIN = join(OUT, isWin ? 'sentinel.exe' : 'sentinel');

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // 1. Bundle the compiled CLI into a single CJS file. node: builtins stay external (the runtime
  //    provides them — including node:sqlite). Bundling produces one self-contained script.
  console.log('• bundling CLI -> ' + BUNDLE);
  // The binary has no package.json on disk, so bake the version in at bundle time (the CLI reads
  // process.env.SENTINEL_BUILD_VERSION first; esbuild replaces it with this literal).
  const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  await build({
    entryPoints: ['dist/cli/main.js'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: BUNDLE,
    legalComments: 'none',
    define: { 'process.env.SENTINEL_BUILD_VERSION': JSON.stringify(pkgVersion) },
  });

  // 2. SEA blob from the bundle.
  console.log('• generating SEA blob');
  const seaConfig = join(OUT, 'sea-config.json');
  writeFileSync(seaConfig, JSON.stringify({ main: BUNDLE, output: BLOB, disableExperimentalSEAWarning: true }));
  sh(process.execPath, ['--experimental-sea-config', seaConfig]);

  // 3. Copy the (statically-linked) Node binary that will host the blob.
  console.log('• copying node host binary');
  copyFileSync(process.execPath, BIN);

  // 4. On macOS the signature must be removed before injecting and re-added after.
  if (isMac) {
    try {
      sh('codesign', ['--remove-signature', BIN]);
    } catch {
      /* unsigned already */
    }
  }

  // 5. Inject the blob via postject's programmatic API. (Spawning `npx postject` fails on Windows:
  //    execFileSync can't run `npx.cmd` without a shell — EINVAL.)
  console.log('• injecting blob (postject)');
  await inject(BIN, 'NODE_SEA_BLOB', readFileSync(BLOB), {
    sentinelFuse: FUSE,
    ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {}),
  });

  // 6. Re-sign on macOS (ad-hoc) so Gatekeeper will run it.
  if (isMac) sh('codesign', ['--sign', '-', BIN]);

  console.log(`\nBuilt ${BIN}`);
}

main().catch((err) => {
  console.error('binary build failed:', err);
  process.exit(1);
});
