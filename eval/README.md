# Adjudication protocol — evaluation harness

A deterministic, reproducible evaluation that measures what the protocol actually prevents. It drives
the **real** Sentinel components — the verdict `Engine`, the `Adjudicator`, the `ReceiptValidator`,
and the `ProtectedExecutor` — over a seeded scenario corpus. No part of the system under test is
mocked.

## Run it

```bash
npm run eval                 # seed 1, 60 scenarios (default)
npx tsx eval/run.ts 7 120    # custom seed and scenario count
```

It prints a Markdown report and writes `eval/results.json`. Same seed → identical results, so it is
safe to run in CI. The assertions in `harness.test.ts` run as part of `npm test` and double as a
**safety-regression suite** — they encode the guarantees below and fail if a change weakens them.

## What it measures

**Attack-success matrix** (rungs × attacks, lower is better) — the fraction of attempts where the
unsafe or unauthorized action actually executed:

| Defense rung | unsafe proposal | substitution | replay | forged auth | evidence downgrade |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 · no verification | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| 2 · self-verification | ~0.47 | 1.00 | 1.00 | 1.00 | 1.00 |
| 3 · deterministic checks | ~0.52 | 1.00 | 1.00 | 1.00 | 1.00 |
| 4 · independent adjudication (decision-only) | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 |
| 5 · full protocol (execution-bound receipts) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

(Unsafe-proposal rates for rungs 2–3 vary with the seed. The execution-time columns — substitution,
replay, forged — are **structural and stable**: rungs 1–4 score 1.00 regardless of model quality. The
rung-4 *unsafe-proposal* `0.00` is **not** structural — see the modeling note below.)

Two deltas carry the contribution:

- **3 → 4** — the fail-safe rule closes the *evidence-downgrade* column **structurally** (the real
  adjudicator escalates on unavailable evidence). The *unsafe-proposal* drop reflects an **idealized**
  verifier (see below), so it bounds what a flawless independent reviewer achieves — it is not a
  property of the adjudicator logic.
- **4 → 5** — execution-bound, single-use receipts drive *substitution*, *replay*, and *forged-auth*
  to zero. This is the gap **no proposal-time verifier can close**, however good its judgment: rung 4
  is an ideal independent verifier and still scores 1.00 on all three. **This is the load-bearing
  result, and it does not depend on model accuracy.**

Plus three guarantee figures:

- **Mediation coverage** = 1.00 — on a clean run every execution maps to exactly one valid authorization.
- **Audit detection rate** = 1.00 — the complete-mediation audit flags every injected violation
  (substitution, orphan execution, replay, invalid signature).
- **Replay under concurrency** = exactly 1 winner — firing N parallel executors at one single-use
  receipt, only one succeeds.

## Modeling notes (honesty)

- Rungs **3, 4, 5** are the real code paths. Rungs **1, 2** are deterministic *models*: "no gate" and
  "the agent's own model re-checks the proposal". Self-verification is modeled as catching unsafe
  proposals except where it shares the actor's blind spot (a per-scenario `correlatedBlindSpot` flag) —
  this is the correlated-failure weakness the verifier-independence profile is about, not a claim about
  any specific model's accuracy.
- The matrix deliberately does **not** depend on model accuracy for the execution-time columns
  (substitution / replay / forged): those attacks present a *benign* proposal and strike at execution,
  so they succeed against rungs 1–4 regardless of how good the verifier is. That is the point.
- For the **unsafe-proposal** column, rungs 4–5 feed the real adjudicator a model signal that is a
  **hardcoded `BLOCK` oracle** on every unsafe action. So the rung-4 `0.00` there measures an *idealized
  perfect independent verifier*, not the adjudicator's own judgment — it shows that even a flawless
  proposal-time reviewer is necessary-but-not-sufficient (rung 5 is still needed for the execution-time
  columns). The genuinely structural results are the execution-time columns and the evidence-downgrade
  column (a real fail-safe-escalate path).
