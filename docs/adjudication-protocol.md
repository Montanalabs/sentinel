# The Sentinel adjudication protocol

Sentinel's core gate returns **ALLOW / BLOCK / ESCALATE** and signs a provenance record. The
**adjudication protocol** builds on that to make an authorization *non-bypassable within the executor's
trust boundary and cryptographically verifiable after the fact*. It turns an `ALLOW` decision into a
signed, single-use, expiring **authorization receipt** bound to the exact action, context, policy, and
evidence — so a downstream executor can prove that what it is about to run is precisely what was
authorized, and an auditor can prove it later.

## The invariant

> **Every protected execution corresponds to exactly one valid Sentinel authorization receipt, and the
> executed action exactly matches the authorized action.**

Everything below exists to make that statement enforceable at execution time and checkable afterward.

## Flow

::diagram{name="adjudication"}

## Components

| Concern | Symbol | File |
| --- | --- | --- |
| Canonical action + digest | `toCanonicalAction`, `actionDigest` | `src/protocol/canonical-action.ts` |
| Fail-safe decision rule | `adjudicate` | `src/protocol/adjudication.ts` |
| Verifier-independence declaration | `assessIndependence` | `src/protocol/verifier-independence.ts` |
| Adjudicator (wraps `Engine.guard`) | `Adjudicator` | `src/protocol/adjudicator.ts` |
| Authorization receipt + signing | `ReceiptIssuer`, `verifyReceiptSignature` | `src/protocol/{authorization-receipt,receipt-issuer}.ts` |
| Policy / evidence commitments | `commitPolicy`, `commitEvidence` | `src/protocol/{policy,evidence}-commitment.ts` |
| Execution-time enforcement | `ReceiptValidator`, `ProtectedExecutor` | `src/protocol/{receipt-validator,protected-executor}.ts` |
| Single-use replay protection | `NonceStore` | `src/store/nonce-*.ts` |
| Execution receipt | `ExecutionReceiptSigner` | `src/protocol/execution-receipt.ts` |
| Complete-mediation audit | `auditCompleteMediation` | `src/protocol/auditor.ts` |
| External checkpoints | `CheckpointSigner`, publishers | `src/protocol/checkpoint*.ts` |
| Persistence | receipt / execution / nonce stores | `src/store/*` |
| HTTP surface | `registerProtocolRoutes` | `src/sidecar/protocol-routes.ts` |

## The fail-safe rule (§10)

`adjudicate()` is a pure, total function ordered by **outcome severity** — every `BLOCK` condition is
considered before any `ESCALATE` condition — which gives it a monotonicity property: worsening any
single signal can never yield a *more permissive* outcome. Precedence:

1. a **hard** deterministic `BLOCK` is absolute;
2. an independent-model `BLOCK` under a block policy also blocks;
3. required-but-unavailable evidence → `ESCALATE` (never silently `ALLOW`);
4. a model `BLOCK` under an escalate policy → `ESCALATE`;
5. a model below its confidence threshold → `ESCALATE`;
6. `ALLOW` **only** when every signal independently allows;
7. otherwise `ESCALATE` (fail-safe default).

These invariants are property-tested directly (`src/protocol/adjudication.test.ts`).

## Threat model

### Trust boundary

The protected boundary is the **executor**: the component that holds the trusted issuer public key(s)
and runs `ReceiptValidator` / `ProtectedExecutor` before performing the real side effect. The agent (and
anything it can influence) is **outside** that boundary and is treated as untrusted.

### Assets

- **Integrity of execution** — only authorized actions execute, and only as authorized.
- **The audit trail** — a tamper-evident record that lets an independent party verify the above.

### Attacker capabilities (assumed)

The attacker controls the agent and its outputs: it can propose any action, attempt to swap the action
between authorization and execution, replay an old receipt, fabricate a receipt, or supply a tampered
digest. It can read anything the agent sees. It **cannot** forge the gate's Ed25519 signature, and it
**cannot** execute code inside the executor's trust boundary (see non-goals).

### What the protocol guarantees

| Attack | Mechanism that defeats it |
| --- | --- |
| **Action substitution** (run a different action under a valid receipt) | the executor recomputes `actionDigest` from the *real* action and the validator rejects on `ACTION_MISMATCH` |
| **Replay** (re-use a single-use receipt) | atomic single-use nonce consumption; under concurrency exactly one executor wins |
| **Forged / unauthorized execution** | receipts are signed; the validator pins to trusted issuer keys (a receipt never carries its own key) |
| **Policy / context substitution** | receipts commit to a policy-bundle and context digest the validator can require to match |
| **Stale authorization** | every receipt has `expiresAt`; revoked ids fail closed (`REVOKED_RECEIPT`) |
| **Missing-evidence downgrade** | the fail-safe rule escalates rather than allowing when required evidence is unavailable |
| **Silent log truncation/rewrite** | hash-chained provenance + periodic signed checkpoints witnessed externally |

Each row is exercised end-to-end by the evaluation harness (`eval/`) and the unit/route tests.

### Non-goals and explicit caveats (read this)

These are deliberate boundaries, not oversights. Stating them is part of the design.

1. **Non-bypassable only *within the executor's trust boundary*.** The guarantee holds for any executor
   that actually calls the validator before acting. Sentinel cannot stop a component that performs the
   side effect while ignoring the gate entirely, nor code running *inside* the executor boundary that
   has the keys. Integration is the deployment's responsibility; the protocol makes the check
   enforceable and auditable, it does not inject itself into an executor that declines to call it.

2. **Verifier independence is *declared*, not *proven*.** The `VerifierIndependenceProfile` records
   operator-asserted facts (different model family, gate-owned prompt/policy, separate credentials) and
   surfaces correlated-failure warnings. Sentinel cannot verify at runtime that the "independent" model
   is genuinely independent — it can only make the assumptions explicit and flag the risky ones. An
   empty warning set is not a proof of independence.

3. **Policy commitments pin a *version*, not the *code*.** Policy packs contain code, which cannot be
   content-hashed. The policy commitment binds the policy **definition data + configuration + explicit
   checker versions**; the code path is pinned by version, not by a hash of the executed logic. A
   compromised build that keeps the same version string is out of scope for the commitment (and is the
   domain of supply-chain controls).

4. **Evidence is committed by digest, not re-verified.** A receipt proves *which* evidence backed a
   decision and detects substitution of it; it does not re-establish that the evidence source was itself
   honest. Source trust is modeled (`trustLevel`) and can carry a source signature, but is not a
   Sentinel guarantee.

## Evaluation

`eval/` contains a deterministic, reproducible harness that measures attack-success rates across five
defense rungs and reports mediation coverage, audit-detection rate, and concurrency-replay behaviour,
driving the real components. See [`eval/README.md`](../eval/README.md). Run it with `npm run eval`.

The headline result: an *ideal* independent-model verifier (rung 4) still scores 1.00 (full success)
on action-substitution, replay, and forgery, because it gates the *proposal* and nothing binds
execution; adding execution-bound, single-use receipts (rung 5) drives all three to 0.00. That delta —
not better proposal-checking — is the protocol's contribution.

## HTTP surface

Enabled by `SENTINEL_PROTOCOL_ENABLED=1`; additive to the core gate API (`/v1/guard` is unchanged).

| Route | Purpose |
| --- | --- |
| `POST /v1/adjudications` | run the adjudicator; persist + return a receipt on ALLOW |
| `POST /v1/receipts/validate` | validate a receipt for an execution binding (consumes its nonce) |
| `POST /v1/executions` | ingest a signed execution receipt into the audit log |
| `POST /v1/receipts/revoke` | revoke a receipt id |
| `GET /v1/audit/verify` | complete-mediation audit over the persisted receipts/executions |
| `GET /v1/audit/coverage` | the coverage fraction of that audit |
