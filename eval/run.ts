/**
 * Evaluation entry point.
 *
 * Usage: `tsx eval/run.ts [seed] [scenarioCount]` (defaults: seed 1, 60 scenarios).
 * Runs the full experiment suite against the real Sentinel stack, writes `eval/results.json`, and
 * prints the Markdown report to stdout. Deterministic in the seed, so it is safe to run in CI.
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateScenarios } from './scenarios.js';
import { runMatrix, mediationCoverage, auditDetectionRate, replayConcurrency } from './experiments.js';
import { formatMarkdown, type EvalResults } from './report.js';

const seed = Number(process.argv[2] ?? 1);
const scenarioCount = Number(process.argv[3] ?? 60);
const executors = 8;

const scenarios = generateScenarios(seed, scenarioCount);
const matrix = await runMatrix(scenarios);
const coverage = await mediationCoverage(scenarios);
const audit = auditDetectionRate(scenarios[0]!);
const winners = await replayConcurrency(scenarios[0]!, executors);

const results: EvalResults = {
  seed,
  scenarioCount,
  matrix,
  mediationCoverage: coverage,
  auditDetectionRate: audit.rate,
  replayConcurrency: { executors, winners },
};

const outPath = join(dirname(fileURLToPath(import.meta.url)), 'results.json');
writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(formatMarkdown(results));
console.log(`\nWrote ${outPath}`);
