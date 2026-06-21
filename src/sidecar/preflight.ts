/**
 * Startup configuration preflight.
 *
 * Surfaces misconfigurations the scaffold-time wizard cannot catch — chiefly a second-opinion
 * provider selected without its API key. Without this the sidecar boots silently and every
 * model-checked action fails safe to `ESCALATE`, which looks like a broken gate rather than a missing
 * key. `preflight` is a pure function returning issues; the entrypoint prints them (and re-runs it on
 * each watch reload) rather than this module deciding to exit — the store, by contrast, is validated
 * by actually opening it, so an unreachable store surfaces as a build error, not a preflight issue.
 */

import type { SentinelConfig } from '../config.js';

/** How serious a preflight finding is. */
export enum PreflightSeverity {
  Warning = 'warning',
  Error = 'error',
}

/** One preflight finding with an actionable hint. */
export interface PreflightIssue {
  readonly severity: PreflightSeverity;
  readonly message: string;
  readonly hint: string;
}

/**
 * Check a resolved config for missing-but-needed settings.
 *
 * @param config - The loaded {@link SentinelConfig}.
 * @returns Any issues found (empty when the config is fully usable). A non-`mock` second-opinion
 *   provider without its API key is the primary case.
 */
export function preflight(config: SentinelConfig): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  if (config.secondOpinionProvider === 'anthropic' && !config.anthropicApiKey) {
    issues.push({
      severity: PreflightSeverity.Warning,
      message: 'second-opinion provider "anthropic" is selected but ANTHROPIC_API_KEY is unset',
      hint: 'add ANTHROPIC_API_KEY to .env (get one at https://console.anthropic.com) — until then the second opinion fails safe to ESCALATE',
    });
  }
  if (config.secondOpinionProvider === 'openai' && !config.openaiApiKey) {
    issues.push({
      severity: PreflightSeverity.Warning,
      message: 'second-opinion provider "openai" is selected but OPENAI_API_KEY is unset',
      hint: 'add OPENAI_API_KEY to .env (get one at https://platform.openai.com/api-keys) — until then the second opinion fails safe to ESCALATE',
    });
  }
  return issues;
}
