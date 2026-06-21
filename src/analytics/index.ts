/**
 * Public barrel for the analytics module.
 *
 * Re-exports the read-only reporting surface over the provenance log: live
 * aggregation ({@link analyze} / {@link Analytics}), per-run audit coverage
 * ({@link runCoverage} / {@link RunCoverage}), and policy back-testing
 * ({@link simulate} / {@link SimReport}). The rest of the system imports
 * analytics exclusively through this entry point.
 */

export { analyze, createAnalyticsAccumulator, runCoverage, type Analytics, type RunCoverage } from './analytics.js';
export { simulate, type SimReport, type SimChange } from './simulate.js';
