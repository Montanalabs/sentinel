import Fastify, { type FastifyInstance, type FastifyError, type FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Engine } from '../engine/engine.js';
import type { ProvenanceStore, ProvenanceFilter } from '../store/types.js';
import { EscalationStatus } from './escalation.js';
import type { EscalationManager } from './escalation.js';
import { RecordBuilder, verifyChainPaged } from '../provenance/record.js';
import type { ProvenanceRecord } from '../provenance/record.js';
import { Verdict, CheckOutcome } from '../core/types.js';
import type { CheckResult, Action, AgentContext, GuardRequest } from '../core/types.js';
import { TokenBucket } from './token-bucket.js';
import { Semaphore } from './semaphore.js';
import { createAnalyticsAccumulator } from '../analytics/index.js';
import { registerProtocolRoutes, type ProtocolDeps } from './protocol-routes.js';

/**
 * HTTP surface of the Sentinel sidecar. Defines the Fastify app that exposes the
 * `/v1` gate API (guard, batch, records, verify, export, escalations, analytics)
 * and a `/healthz` liveness probe — translating requests into {@link Engine} guard
 * calls, {@link ProvenanceStore} queries, and {@link EscalationManager} operations,
 * with optional token-bucket rate limiting and semaphore backpressure on `/v1/*`.
 */

/**
 * Collaborators the sidecar HTTP server depends on: the gate {@link Engine}, the
 * {@link ProvenanceStore}, the {@link EscalationManager}, the shared
 * {@link RecordBuilder}, and optional rate-limit / backpressure tuning.
 */
export interface SidecarDeps {
  readonly engine: Engine;
  readonly store: ProvenanceStore;
  readonly escalations: EscalationManager;
  /** Same builder instance the engine uses, so human-decision records stay chained. */
  readonly builder: RecordBuilder;
  /** Global token-bucket rate limit on /v1/* routes (429 when exceeded). */
  readonly rateLimit?: { readonly capacity: number; readonly refillPerSec: number };
  /** Max concurrent in-flight /v1/* requests (503 when saturated). Defaults to {@link DEFAULT_MAX_CONCURRENT}. */
  readonly maxConcurrent?: number;
  /** Max accepted request body size in bytes. Defaults to {@link DEFAULT_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  /** Extra signer keyIds `/v1/verify` should also trust (key rotation) beyond the current signer. */
  readonly additionalTrustedKeyIds?: readonly string[];
  /** When present, registers the adjudication-protocol routes (`/v1/adjudications`, etc.). */
  readonly protocol?: ProtocolDeps;
}

/** Default request body cap (256 KiB) — legitimate actions are tiny; this blunts memory-amplification DoS. */
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
/** Default in-flight cap so a stock deploy has backpressure even if not explicitly tuned. */
const DEFAULT_MAX_CONCURRENT = 256;
/** Default page size for /v1/records when no limit is given, and hard cap on any requested limit. */
const MAX_PAGE = 1000;

/** Parse a non-negative integer query value, ignoring junk (NaN/negative/float). */
function parseCount(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Send a uniform error response: `{ error: <message> }` (plus `details` when given).
 *
 * The single place the error body shape is defined, so every route stays consistent and the
 * format can't drift. Messages are short, lowercase, and must never carry internal/stack detail.
 */
function httpError(reply: FastifyReply, status: number, message: string, details?: unknown): FastifyReply {
  return reply.code(status).send(details !== undefined ? { error: message, details } : { error: message });
}

/**
 * Yield the whole chain in fixed-size pages (ascending seq) so whole-chain operations
 * (verify, analytics) run in constant memory instead of materializing every record at once.
 */
async function* pageRecords(store: ProvenanceStore, batch = MAX_PAGE): AsyncGenerator<ProvenanceRecord[]> {
  for (let offset = 0; ; offset += batch) {
    const page = await store.query({ limit: batch, offset });
    if (page.length > 0) yield page;
    if (page.length < batch) return;
  }
}

const ActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  meta: z.record(z.unknown()).optional(),
});
const TraceStepSchema = z.object({
  kind: z.enum(['model', 'tool', 'message']),
  name: z.string().optional(),
  content: z.unknown().optional(),
});
const ContextSchema = z.object({
  runId: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  actor: z.object({ id: z.string(), roles: z.array(z.string()).optional() }).optional(),
  tenant: z.string().optional(),
  trace: z.array(TraceStepSchema).optional(),
});
const GuardBody = z.object({ action: ActionSchema, context: ContextSchema, policy: z.string() });
const ResolveBody = z.object({ decision: z.enum(['approve', 'deny']), approver: z.string() });

function approversFrom(checks: readonly CheckResult[]): string[] {
  for (const check of checks) {
    const approvers = check.details?.['approvers'];
    if (Array.isArray(approvers) && approvers.every((x): x is string => typeof x === 'string')) return approvers;
  }
  return [];
}

function parseFilter(query: Record<string, unknown>): ProvenanceFilter {
  const filter: ProvenanceFilter = {};
  if (typeof query['tenant'] === 'string') filter.tenant = query['tenant'];
  if (typeof query['runId'] === 'string') filter.runId = query['runId'];
  if (query['verdict'] === Verdict.Allow || query['verdict'] === Verdict.Block || query['verdict'] === Verdict.Escalate)
    filter.verdict = query['verdict'];
  if (typeof query['since'] === 'string') filter.since = query['since'];
  if (typeof query['until'] === 'string') filter.until = query['until'];
  // Sanitize paging: ignore NaN/negative/float, and clamp limit to MAX_PAGE so a single query
  // can't ask the store to materialize an unbounded result set.
  const limit = parseCount(query['limit']);
  filter.limit = limit === undefined ? MAX_PAGE : Math.min(limit, MAX_PAGE);
  const offset = parseCount(query['offset']);
  if (offset !== undefined) filter.offset = offset;
  return filter;
}

/**
 * Build (but do not start) the Sentinel sidecar HTTP server.
 *
 * Registers all routes and, when {@link SidecarDeps.rateLimit} or
 * {@link SidecarDeps.maxConcurrent} are set, installs `onRequest`/`onResponse`
 * hooks that gate `/v1/*` with a {@link TokenBucket} (429) and {@link Semaphore}
 * (503). The returned instance is ready for `app.listen(...)`.
 *
 * @param deps - Wired collaborators and optional throttling tuning; see
 *   {@link SidecarDeps}.
 * @returns The configured Fastify {@link FastifyInstance}, not yet listening.
 * @remarks Route handlers may reject at request time — e.g. `POST /v1/guard`
 *   propagates errors from {@link Engine.guard}, and the read/verify/export
 *   routes propagate {@link ProvenanceStore} failures — surfaced as the HTTP
 *   response rather than thrown from this builder.
 */
export function buildServer(deps: SidecarDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES });

  // Never leak internal exception detail to clients; Fastify still returns 400s we send explicitly.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? 'internal error' : err.message });
  });

  // Rate-limit + backpressure on /v1/* (healthz stays free for liveness probes).
  const bucket = deps.rateLimit ? new TokenBucket(deps.rateLimit) : undefined;
  // Default to a backpressure cap so a stock deploy isn't unbounded; set maxConcurrent: 0 to disable.
  const maxConcurrent = deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const sem = maxConcurrent > 0 ? new Semaphore(maxConcurrent) : undefined;
  const held = new WeakSet<object>();
  if (bucket || sem) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/v1/')) return;
      if (bucket && !bucket.tryRemove()) return httpError(reply, 429, 'rate limit exceeded');
      if (sem) {
        if (!sem.tryAcquire()) return httpError(reply, 503, 'overloaded; retry later');
        held.add(req);
      }
    });
    const free = (req: object): void => {
      if (sem && held.has(req)) {
        sem.release();
        held.delete(req);
      }
    };
    app.addHook('onResponse', async (req) => free(req));
    app.addHook('onError', async (req) => free(req));
    // A client that aborts mid-flight fires onRequestAbort, NOT onResponse/onError — without this
    // the permit would leak and, after maxConcurrent aborts, wedge the gate at 503 permanently.
    // `free` is idempotent (held.has guard), so a later onResponse for the same req is harmless.
    app.addHook('onRequestAbort', async (req) => free(req));
  }

  // Liveness: the process is up and serving. Intentionally does NOT touch the store — a DB blip must
  // not make k8s kill an otherwise-healthy pod (that's readiness' job).
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Readiness: the gate can actually decide — i.e. the provenance store is reachable. Returns 503
  // when the store is down so a load balancer / k8s readiness probe drains the pod instead of
  // routing traffic to a sidecar that would fail every append.
  app.get('/readyz', async (_req, reply) => {
    try {
      await deps.store.tail();
      return { status: 'ready' };
    } catch {
      return httpError(reply, 503, 'store unavailable');
    }
  });

  // Decision analytics over the provenance chain (API only; no bundled UI).
  app.get('/v1/analytics', async () => {
    // Page through the chain so analytics over a long history runs in bounded memory.
    const acc = createAnalyticsAccumulator();
    for await (const page of pageRecords(deps.store)) acc.add(page);
    return acc.finalize();
  });

  // Runs one guard request and creates an escalation when needed.
  async function runOne(data: z.infer<typeof GuardBody>) {
    const actionInput = data.action;
    const action: Action = {
      id: actionInput.id,
      type: actionInput.type,
      payload: actionInput.payload,
      ...(actionInput.meta ? { meta: actionInput.meta } : {}),
    };
    const contextInput = data.context;
    const context: AgentContext = {
      runId: contextInput.runId,
      ...(contextInput.provider ? { provider: contextInput.provider } : {}),
      ...(contextInput.model ? { model: contextInput.model } : {}),
      ...(contextInput.tenant ? { tenant: contextInput.tenant } : {}),
      ...(contextInput.actor
        ? {
            actor: {
              id: contextInput.actor.id,
              ...(contextInput.actor.roles ? { roles: contextInput.actor.roles } : {}),
            },
          }
        : {}),
      ...(contextInput.trace
        ? {
            trace: contextInput.trace.map((step) => ({
              kind: step.kind,
              ...(step.name !== undefined ? { name: step.name } : {}),
              ...(step.content !== undefined ? { content: step.content } : {}),
            })),
          }
        : {}),
    };
    const request: GuardRequest = { action, context, policy: data.policy };
    const decision = await deps.engine.guard(request);
    if (decision.verdict === Verdict.Escalate) {
      const esc = await deps.escalations.create({
        recordId: decision.recordId,
        action,
        approvers: approversFrom(decision.checks),
        ...(decision.reason ? { reason: decision.reason } : {}),
      });
      return { ...decision, escalationId: esc.id };
    }
    return decision;
  }

  app.post('/v1/guard', async (req, reply) => {
    const parsed = GuardBody.safeParse(req.body);
    if (!parsed.success) return httpError(reply, 400, 'invalid guard request', parsed.error.issues);
    return reply.send(await runOne(parsed.data));
  });

  app.post('/v1/guard/batch', async (req, reply) => {
    const parsed = z.object({ requests: z.array(GuardBody).max(256) }).safeParse(req.body);
    if (!parsed.success) return httpError(reply, 400, 'invalid batch request', parsed.error.issues);
    // Charge the rate limiter for EVERY sub-request (the onRequest hook only spent one for the HTTP
    // call), so a single token can't buy up to 256 guard evaluations + appends.
    if (bucket && !bucket.tryRemoveN(parsed.data.requests.length - 1)) {
      return httpError(reply, 429, 'rate limit exceeded (batch)');
    }
    const decisions = [];
    for (const request of parsed.data.requests) decisions.push(await runOne(request));
    return reply.send({ decisions });
  });

  app.get('/v1/records', async (req) => {
    return deps.store.query(parseFilter((req.query ?? {}) as Record<string, unknown>));
  });

  app.get('/v1/records/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rec = await deps.store.getById(id);
    if (!rec) return httpError(reply, 404, 'record not found');
    return rec;
  });

  // Pin verification to THIS sidecar's signer: a chain re-signed under any other key (e.g. by an
  // attacker with store write access) must fail, not merely be "internally consistent".
  // Trust the current signer plus any rotated-in keyIds, so a key rotation doesn't make the whole
  // pre-rotation chain report as tampered.
  const trustedKeyIds = [deps.builder.keyId, ...(deps.additionalTrustedKeyIds ?? [])];
  // Stream the chain in pages so verifying a very long chain stays in bounded memory.
  app.get('/v1/verify', async () => verifyChainPaged(pageRecords(deps.store), trustedKeyIds));

  app.get('/v1/export', async (req) => {
    // Bounded by parseFilter's MAX_PAGE clamp. For a full export, page via ?offset= using
    // nextOffset until a short page is returned.
    const filter = parseFilter((req.query ?? {}) as Record<string, unknown>);
    const records = await deps.store.query(filter);
    const limit = filter.limit ?? MAX_PAGE;
    const offset = filter.offset ?? 0;
    const nextOffset = records.length === limit ? offset + limit : null;
    return { format: 'json', count: records.length, ...(nextOffset !== null ? { nextOffset } : {}), records };
  });

  app.get('/v1/escalations', async (req) => {
    const status = (req.query as { status?: string }).status;
    return status === EscalationStatus.Pending || status === EscalationStatus.Approved || status === EscalationStatus.Denied
      ? deps.escalations.list(status)
      : deps.escalations.list();
  });

  app.post('/v1/escalations/:id/resolve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = ResolveBody.safeParse(req.body);
    if (!parsed.success) return httpError(reply, 400, 'invalid resolve request', parsed.error.issues);
    const existing = deps.escalations.get(id);
    if (!existing) return httpError(reply, 404, 'escalation not found');

    let escalation;
    try {
      escalation = await deps.escalations.resolve(id, parsed.data);
    } catch {
      // `existing` was already checked above, so the only reachable failure is an already-resolved
      // escalation. Use a curated message rather than forwarding the raw thrown text.
      return httpError(reply, 409, 'escalation already resolved');
    }

    // Append a human-decision provenance record, chained after the original. Routed through the
    // engine's serialized append so it can't interleave with a concurrent guard() on the shared
    // builder (which would fork the chain) — and inherits conflict-retry + builder resync.
    const original = await deps.store.getById(existing.recordId);
    const verdict: Verdict = parsed.data.decision === 'approve' ? Verdict.Allow : Verdict.Block;
    const record = await deps.engine.appendRecord({
      ...(original?.tenant ? { tenant: original.tenant } : {}),
      action: existing.action,
      context: original?.context ?? { runId: `escalation_${id}` },
      checks: [
        {
          check: 'human.review',
          outcome: verdict === Verdict.Allow ? CheckOutcome.Pass : CheckOutcome.Fail,
          verdict,
          reason: `${parsed.data.decision} by ${parsed.data.approver}`,
          details: { escalationId: id, originalRecordId: existing.recordId },
        },
      ],
      verdict,
      reason: `human ${parsed.data.decision} of escalation ${id}`,
    });

    return reply.send({ escalation, recordId: record.id });
  });

  // Adjudication-protocol routes are additive and opt-in; the core gate API above is unchanged.
  if (deps.protocol) registerProtocolRoutes(app, deps.protocol);

  return app;
}
