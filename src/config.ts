/**
 * Configuration loading for the Sentinel sidecar and SDK.
 *
 * Sits at the process boundary: reads `.env` files and `process.env`, and resolves
 * the raw environment into a typed {@link SentinelConfig} consumed by the bootstrap
 * wiring (database, signing seed, second-opinion provider, escalation webhook, rate
 * limits, and slow-tier budget). Parsing is best-effort and never throws on malformed
 * input — unknown or missing keys are simply omitted so defaults apply downstream.
 */

import { readFileSync, existsSync } from 'node:fs';

/**
 * Parse the textual contents of a `.env` file into a flat key/value map.
 *
 * Skips blank lines and `#` comments, splits each entry on the first `=`, strips
 * matching surrounding single or double quotes, and trims trailing inline comments
 * from unquoted values. Malformed lines (no `=`, empty key) are ignored rather than
 * raising, so callers always receive a usable map.
 *
 * @param text - Raw file contents, newline-separated.
 * @returns A map of environment variable names to their parsed string values.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Load a `.env` file into `process.env`, leaving already-set variables untouched.
 *
 * A missing file is a no-op (returns silently), so this is safe to call
 * unconditionally at startup. A real environment variable with a non-empty value wins over the
 * file; a variable that is unset OR set to an empty string falls back to the `.env` value — this
 * matches how `docker compose`/k8s expand `${VAR:-}` to an empty string and avoids that silently
 * blanking a configured default.
 *
 * @param path - Filesystem path to the env file; defaults to `.env` in the cwd.
 * @throws {Error} If the file exists but cannot be read (propagated from `readFileSync`).
 * @see {@link parseDotenv} for the parsing rules applied to the file contents.
 */
export function loadEnvFile(path = '.env'): void {
  if (!existsSync(path)) return;
  const parsed = parseDotenv(readFileSync(path, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    const current = process.env[k];
    if (current === undefined || current === '') process.env[k] = v;
  }
}

/**
 * Resolved runtime configuration for a Sentinel sidecar instance.
 *
 * Produced by {@link loadConfig} from the environment and consumed by the bootstrap
 * wiring. Optional fields are absent (not empty strings) when their backing variable
 * is unset, letting downstream components apply their own defaults; required fields
 * always carry a value.
 */
export interface SentinelConfig {
  /** Connection string for the provenance store; in-memory store is used when absent. */
  databaseUrl?: string;
  /** TCP port the sidecar HTTP server binds to. */
  sidecarPort: number;
  /** Secret seed for signing provenance records; ephemeral key is used when absent. */
  signingSeed?: string;
  /** Identifier of the second-opinion provider to use (e.g. `mock`, `anthropic`, `openai`). */
  secondOpinionProvider: string;
  /** Model name passed to the second-opinion provider; provider default when absent. */
  secondOpinionModel?: string;
  /** API key for the Anthropic second-opinion provider. */
  anthropicApiKey?: string;
  /** API key for the OpenAI second-opinion provider. */
  openaiApiKey?: string;
  /** Webhook URL notified when a decision escalates for human review. */
  escalationWebhookUrl?: string;
  /** Deadline for the slow check tier (model calls, ledger lookups), ms. */
  slowBudgetMs?: number;
  /** Token-bucket rate limit: `capacity` is burst size, `refillPerSec` is sustained rate. */
  rateLimit?: { capacity: number; refillPerSec: number };
  /** Maximum number of slow-tier checks allowed to run concurrently. */
  maxConcurrent?: number;
  /** Max accepted HTTP request body size in bytes (`/v1/*`); guards against memory-amplification. */
  maxBodyBytes?: number;
  /** Previously-valid signer keyIds still trusted by `/v1/verify` (for key rotation). */
  trustedKeyIds?: string[];
}

/** Parse a numeric env var, returning `undefined` for missing/blank/non-finite (so defaults apply). */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a positive-integer env var (count/byte/port style), returning `undefined` for anything
 * invalid (blank, NaN, non-integer, `<= 0`, or above `max`) so the downstream default applies —
 * a typo can never become `NaN`/negative and crash boot or disable a guard.
 */
function posInt(raw: string | undefined, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const n = num(raw);
  return n !== undefined && Number.isInteger(n) && n > 0 && n <= max ? n : undefined;
}

/**
 * Resolve a {@link SentinelConfig} from environment variables.
 *
 * Reads `SENTINEL_*` (plus `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) variables, omitting
 * optional fields whose variables are unset and applying defaults for the required
 * ones (`sidecarPort` → `4000`, `secondOpinionProvider` → `mock`). The rate limit is
 * populated only when both burst and RPS variables are present. Numeric variables are parsed
 * safely: a blank or non-numeric value is treated as unset (the downstream default applies)
 * rather than becoming `NaN` — so e.g. a typo'd `SENTINEL_SLOW_BUDGET_MS` cannot disable the slow tier.
 *
 * @param env - Environment map to read from; defaults to `process.env`.
 * @returns The resolved configuration object.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SentinelConfig {
  const slowBudgetMs = posInt(env.SENTINEL_SLOW_BUDGET_MS);
  const burst = posInt(env.SENTINEL_RATE_LIMIT_BURST);
  const rps = posInt(env.SENTINEL_RATE_LIMIT_RPS);
  const maxConcurrent = num(env.SENTINEL_MAX_CONCURRENT); // 0 allowed = explicitly disable backpressure
  const maxBodyBytes = posInt(env.SENTINEL_MAX_BODY_BYTES);
  const trustedKeyIds = (env.SENTINEL_TRUSTED_KEY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ...(env.SENTINEL_DATABASE_URL ? { databaseUrl: env.SENTINEL_DATABASE_URL } : {}),
    sidecarPort: posInt(env.SENTINEL_SIDECAR_PORT, 65535) ?? 4000,
    ...(env.SENTINEL_SIGNING_SEED ? { signingSeed: env.SENTINEL_SIGNING_SEED } : {}),
    secondOpinionProvider: env.SENTINEL_SECOND_OPINION_PROVIDER ?? 'mock',
    ...(env.SENTINEL_SECOND_OPINION_MODEL ? { secondOpinionModel: env.SENTINEL_SECOND_OPINION_MODEL } : {}),
    ...(env.ANTHROPIC_API_KEY ? { anthropicApiKey: env.ANTHROPIC_API_KEY } : {}),
    ...(env.OPENAI_API_KEY ? { openaiApiKey: env.OPENAI_API_KEY } : {}),
    ...(env.SENTINEL_ESCALATION_WEBHOOK_URL ? { escalationWebhookUrl: env.SENTINEL_ESCALATION_WEBHOOK_URL } : {}),
    ...(slowBudgetMs !== undefined ? { slowBudgetMs } : {}),
    // Both burst and RPS must be valid positive ints, else the rate limit is dropped — a zero/
    // negative burst would otherwise brick the gate with a permanent HTTP 429.
    ...(burst !== undefined && rps !== undefined ? { rateLimit: { capacity: burst, refillPerSec: rps } } : {}),
    ...(maxConcurrent !== undefined && maxConcurrent >= 0 ? { maxConcurrent } : {}),
    ...(maxBodyBytes !== undefined ? { maxBodyBytes } : {}),
    ...(trustedKeyIds.length ? { trustedKeyIds } : {}),
  };
}
