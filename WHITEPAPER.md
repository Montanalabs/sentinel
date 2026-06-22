<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sentinel-mark-dark.svg" />
    <img width="72" src="assets/sentinel-mark-light.svg" alt="Sentinel" />
  </picture>
</p>

<h1 align="center">Sentinel</h1>

<p align="center"><strong>An Independent, Fail-Safe Action-Gate for Autonomous AI Agents</strong></p>

<p align="center">
  Montana Labs &nbsp;·&nbsp; White Paper &nbsp;·&nbsp; v1.0 &nbsp;·&nbsp; June 2026<br/>
  <code>info@montanalabs.ai</code>
</p>

---

## Abstract

Autonomous agents built on large language models (LLMs) increasingly take **consequential, irreversible
actions** — moving money, writing to systems of record, sending communications, executing trades. The
prevailing safety posture places the check *inside* the same model, prompt, or vendor that proposes the
action, which is both a correctness risk (correlated failure) and a governance risk (a vendor certifying
its own model is a conflict of interest an auditor cannot accept). We present **Sentinel**, an
independent action-gate deployed as a separate trust boundary. At the moment an agent is about to act,
Sentinel **independently verifies** the proposed action against buyer-owned policy and systems of record
and returns one of `ALLOW` / `BLOCK` / `ESCALATE`, emitting a **signed, hash-chained provenance record**
for every decision. Sentinel is **fail-safe by construction**: any condition under which it cannot
produce a trustworthy verdict — an unreachable dependency, a timeout, unavailable ground truth, a
malformed response — resolves to a non-permissive outcome, never a silent allow.

Beyond decision-time gating, Sentinel defines an **adjudication protocol** that converts an `ALLOW` into
a signed, single-use, expiring **authorization receipt** cryptographically bound to the exact action,
context, policy, and evidence. A protected executor validates the receipt and recomputes the action
digest *from the real action* before performing any side effect, enforcing the invariant *"the executed
action is exactly the authorized action, and corresponds to exactly one authorization."* We argue — and
demonstrate with a deterministic evaluation harness driving the real components — that this
execution-binding closes a class of attacks (action substitution, receipt replay, authorization forgery)
that **no proposal-time verifier can close, however good its judgment**: an idealized perfect independent
reviewer still admits 100% of these attacks; execution-bound receipts drive them to zero. The individual
primitives are classical; the contribution is their **synthesis** into an independent, fail-safe gate
whose authorizations are non-bypassable within the executor boundary and verifiable after the fact. We
are explicit about the boundaries of the guarantee.

---

## 1. Introduction

### 1.1 The trust gap

Tool-using LLM agents [1, 2] now sit in the control path of real operations. The decision to act and the
act itself are typically separated by *no independent, buyer-owned check*. Teams either trust the model
vendor's own alignment and "recovery" mechanisms, or hand-roll brittle guards in application code. Both
are unsatisfactory:

- **Correlated failure.** A model checking its own proposal shares that model's blind spots; the check
  fails exactly when it is needed (§5.5).
- **Conflict of interest.** A vendor attesting to the safety of its own model is not evidence an auditor,
  regulator, or counterparty can rely on.
- **No tamper-evident record.** When something does go wrong, there is rarely a signed, independently
  verifiable account of *what was decided, on what basis, and by whom*.

The value of an independent gate grows precisely as agents are trusted with higher-stakes actions.

### 1.2 Contributions

1. An **independent action-gate** architecture (§4): a separate trust boundary that renders and *signs*
   verdicts with a key the proposing agent never holds, structured as a fast deterministic tier and a
   slow, deadline-bounded cross-model tier.
2. A **fail-safe formal model** (§5): a verdict lattice with monotone, severity-ordered aggregation; a
   fail-closed theorem; and a **residual-risk decomposition** separating proposal-time from
   execution-time risk that motivates the protocol.
3. The **adjudication protocol** (§6): execution-bound, single-use authorization receipts and a
   complete-mediation audit that make *"executed == authorized"* enforceable at execution time and
   checkable afterward.
4. A **tamper-evident provenance chain** (§4.6): append-only, Ed25519-signed, hash-chained records
   verifiable offline from the records and a public key alone.
5. A **deterministic evaluation** (§8) driving the real components, isolating the one result that does
   not depend on model accuracy.

The primitives — reference monitors, complete mediation, fail-safe defaults, capability tokens,
hash-chained logs — are individually well known (§2). The novelty is the synthesis and the
execution-bound receipt; we state the caveats plainly (§7.2).

---

## 2. Background and related work

### 2.1 Agents and tool use

ReAct [1] interleaves reasoning and tool calls; Toolformer [2] teaches models to invoke APIs; modern
function-calling and the Model Context Protocol [3] standardize how models reach external effects. These
expand *capability* and therefore *blast radius*; none provide an independent authority over whether a
given effect should occur.

### 2.2 Model-level guardrails

Constitutional AI [4] trains harmlessness from AI feedback; Llama Guard [5] classifies inputs/outputs;
NeMo Guardrails [6] and similar frameworks add programmable rails. These operate *within or adjacent to
the model* and are valuable, but they are not an independent, signing authority over consequential
actions, and they inherit the correlated-failure and conflict-of-interest problems of §1.1.

### 2.3 AI control and scalable oversight

The "AI control" agenda [7] studies safety *despite* a possibly-subverted model, using untrusted models
under trusted monitoring; debate [8] and the broader oversight literature [9] pursue scalable supervision.
Sentinel is a concrete, deployable control mechanism in this spirit: it treats the agent as untrusted and
places a trusted, independent gate in the action path.

### 2.4 Runtime verification and enforcement

Runtime verification monitors executions against formal specifications [10]; Schneider's enforceable
security policies and security automata characterize what monitors can enforce by halting bad executions
[11]; shielding in reinforcement learning synthesizes a reactive correct-by-construction shield that
overrides unsafe actions [12]. Sentinel is, in effect, an **enforcement monitor for agent actions**: a
reference monitor that mediates each consequential effect and can halt it.

### 2.5 Classical security principles

Sentinel is deliberately grounded in foundational principles rather than novel cryptography. Anderson's
**reference monitor** [13] — a tamper-resistant, always-invoked, verifiable mediation point — is the
template for the gate. Saltzer and Schroeder [14] give two principles Sentinel treats as load-bearing:
**complete mediation** (every access is checked) and **fail-safe defaults** (the default is denial; access
is granted only by explicit, positive decision). Clark–Wilson [15] contributes **separation of duty** and
well-formed transactions (mirrored in dual-control escalation); capability systems [16] inform the
single-use, unforgeable **authorization receipt** (a capability bound to one action). OAuth-style
authorization [17] motivates short-lived, scoped grants.

### 2.6 Tamper-evident provenance

Efficient tamper-evident logs [18], Merkle structures [19], and Certificate Transparency's
externally-witnessed append-only logs [20] inform Sentinel's hash-chained, signed records and periodic
external checkpoints (§6.7). Signatures use Ed25519 [21].

### 2.7 Positioning

Sentinel differs from model-level guardrails (§2.2) in being an **independent trust boundary** that
*signs* its verdicts; from policy engines in **reconciling against live systems of record** with
fail-safe lookups; and from all proposal-time approaches in the **adjudication protocol**, which binds an
authorization to an action *at execution time*. To our knowledge the specific synthesis — an independent,
fail-safe agent gate whose `ALLOW` is a single-use, execution-bound, auditable receipt — is novel, even
though each ingredient is classical.

---

## 3. Threat model and design goals

**Trusted:** the Sentinel sidecar and, for the protocol, the **executor** that holds the trusted issuer
public key(s) and calls the validator before performing a side effect. **Untrusted:** the agent and
anything it can influence — it may propose any action, swap the action between authorization and
execution, replay an old receipt, fabricate one, or supply a tampered digest. The attacker can read
anything the agent sees. The attacker **cannot** forge an Ed25519 signature and **cannot** execute code
inside the executor's trust boundary.

**Assets:** (i) integrity of execution — only authorized actions execute, exactly as authorized; (ii) the
audit trail — a tamper-evident record letting an independent party verify (i).

**Design goals:** independence (a separate boundary, signing with a key the agent never sees);
**fail-safe by construction** (the unsafe direction must require *positive* evidence); complete mediation
(every consequential action is gated); auditability (offline-verifiable provenance); and operational
realism (bounded latency, graceful degradation).

---

## 4. System architecture

### 4.1 The gate as an independent trust boundary

The agent calls `guard(action, context, policy)` at the action boundary instead of executing directly.
The sidecar is a separate trust boundary: it holds the policy, renders the verdict, and signs the record
with a key the agent never possesses. *The component that proposes an action never signs off on it.*

### 4.2 Request lifecycle

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/architecture-dark.svg" />
    <img width="720" src="assets/architecture-light.svg" alt="Sentinel architecture: agent → sidecar → your systems → signed provenance" />
  </picture>
</p>

### 4.3 Two-tier checks

Sentinel resolves a policy to an ordered set of checks run in two tiers: a **fast, deterministic, synchronous
tier** (schema validation, policy rules, data-boundary enforcement, allow/deny lists) and a **slow,
asynchronous tier with a hard deadline** (ground-truth reconciliation against systems of record and an
optional independent cross-model second opinion). A fast `BLOCK` short-circuits the slow tier. The slow
tier is bounded by a deadline budget; exceeding it is treated as *unavailable* (§4.4).

### 4.4 Verdict aggregation

Checks vote; the gate aggregates by **severity precedence** `BLOCK > ESCALATE > ALLOW` (§5.2–5.3). An
`ALLOW` is returned only when *every* signal independently allows with required evidence available;
otherwise the outcome is restricted upward. Unavailable ground truth escalates rather than allowing.

### 4.5 Ground-truth connectors

Connectors are the independent sources of truth Sentinel reads — a ledger, an EHR, a sanctions list.
Their lookups **fail safe**: when truth is unavailable, the contributing check is *inconclusive* and the
gate escalates rather than guessing.

### 4.6 Signed, hash-chained provenance

Every decision — and every human approve/deny — is written as an append-only, Ed25519-signed,
hash-chained record. The body is serialized with canonical JSON and includes the predecessor hash and the
signer's public key (§5.6). Verification (`GET /v1/verify`) re-derives the key id, **recomputes the
content hash before checking the signature** (so any field mutation fails closed), checks the chain links,
then verifies the signature. Any edit, drop, splice, or re-sign with an untrusted key is detected. The
chain is verifiable offline from the records and a public key alone.

### 4.7 Escalation

`ESCALATE` routes to a human approve/deny queue; the resolution appends a linked, signed record, so
"who approved this, and when" lives in the same chain as the original decision — the mechanism for
dual-control / separation-of-duty [15].

---

## 5. Formal model

### 5.1 Notation

An attempt is a tuple $(a, c, \pi, e)$: action $a$, context $c$, policy $\pi$, and evidence $e$. A
collision-resistant hash $H$ (SHA-256) and a canonicalizer $\mathrm{canon}(\cdot)$ yield digests
$d_x = H(\mathrm{canon}(x))$. The gate is a function $g(a,c,\pi)\in V$.

### 5.2 Verdict lattice and aggregation

Let the verdict set carry the **safety order**

$$\textsf{ALLOW} \;\prec\; \textsf{ESCALATE} \;\prec\; \textsf{BLOCK},$$

where "greater" means "more restrictive / safer." $(V,\preceq)$ is a totally ordered lattice with join
$\sqcup=\max_\preceq$. For checks $k_1,\dots,k_n$ producing verdicts $v_1,\dots,v_n$, the base aggregation is

$$g \;=\; \bigsqcup_{i=1}^{n} v_i \;=\; \max_{\preceq}\{v_1,\dots,v_n\}.$$

The join is **monotone**: raising any $v_i$ (more restrictive) can never lower $g$.

### 5.3 The fail-safe rule

The adjudicator refines the join into a pure, total function ordered by **outcome severity** — every
`BLOCK` condition is evaluated before any `ESCALATE` condition — preserving monotonicity (worsening any
single signal never yields a more permissive outcome). In priority order:

1. a **hard** deterministic `BLOCK` is absolute;
2. an independent-model `BLOCK` under a *block* policy blocks;
3. **required-but-unavailable evidence ⟶ `ESCALATE`** (never a silent `ALLOW`);
4. a model `BLOCK` under an *escalate* policy ⟶ `ESCALATE`;
5. a model below its confidence threshold ⟶ `ESCALATE`;
6. `ALLOW` **iff** every signal independently allows;
7. otherwise `ESCALATE` (fail-safe default).

### 5.4 Fail-closed property

Let $\bot$ denote an unavailable/timed-out/malformed signal. Define availability $\mathrm{ok}(k_i)$.

> **Proposition (fail-closed).** $g(a,c,\pi)=\textsf{ALLOW}$ implies every required check completed,
> returned `ALLOW`, and its evidence was available. Equivalently, $\exists i:\ v_i\neq\textsf{ALLOW} \lor
> \lnot\mathrm{ok}(k_i)\ \Rightarrow\ g\succeq\textsf{ESCALATE}$.

The client mirrors this end-to-end: if the sidecar is unreachable, slow, oversized, or returns a
malformed body, the SDK synthesizes `BLOCK` (fail-closed). Safety thus requires *positive* evidence; the
default everywhere is denial [14].

### 5.5 Residual-risk decomposition — why decision-time is not enough

Decompose the probability that an unsafe or unauthorized effect occurs into two independent terms:

$$R \;=\; R_{\text{prop}} \;+\; R_{\text{exec}} \;-\; R_{\text{prop}}R_{\text{exec}},$$

- $R_{\text{prop}}=\Pr[\text{harmful action is authorized}]$ — addressed by **verification quality**;
- $R_{\text{exec}}=\Pr[\text{executed action} \neq \text{authorized action, yet executes}]$ — substitution,
  replay, forgery.

**Proposal-time verification (any rung ≤ 4).** With proposer harmful-rate $p_a$ and an independent
verifier miss-rate $p_v$, and correlation $\rho$ between their failures,

$$R_{\text{prop}} \;=\; p_a p_v \;+\; \rho\,\sqrt{p_a(1-p_a)\,p_v(1-p_v)}.$$

Independence ($\rho=0$) makes the residual multiplicative ($p_a p_v$); correlation strictly inflates it —
the motivation for the verifier-independence profile (§6, caveat 2). Crucially, *no choice of $p_v$ touches*
$R_{\text{exec}}$: an execution-time attack presents a **benign** proposal and strikes after the verdict,
so $R_{\text{exec}}=1$ for any proposal-time-only design, even an ideal verifier with $p_v\to 0$.

**Execution binding (rung 5).** Receipts bound to the action digest, validated at execution, drive

$$R_{\text{exec}} \;\le\; \varepsilon_{\text{crypto}}$$

(negligible under collision-resistance of $H$ and EUF-CMA security of the signature), **independent of**
$p_v$. This is the load-bearing result of §8: the irreducible-by-judgment term $R_{\text{exec}}$ is closed
only by execution binding, not by better reasoning.

### 5.6 Provenance integrity

For record $i$ with canonical body $b_i$ (which embeds $h_{i-1}$ and the signer public key $\mathrm{pk}$):

$$h_i = H(\mathrm{canon}(b_i)),\qquad h_0=\text{genesis seed},\qquad \sigma_i=\mathrm{Sign}_{\mathrm{sk}}(h_i),$$

and the key id is the *full* digest $\mathrm{keyId}=H(\mathrm{pk})$ (untruncated, so it cannot be collided
onto another key). Verification accepts the chain iff for all $i$: $\mathrm{keyId}$ re-derives and is
trusted, $h_i$ recomputes (checked **before** the signature), $\mathrm{prevHash}(b_i)=h_{i-1}$, and
$\mathrm{Verify}_{\mathrm{pk}}(h_i,\sigma_i)$. Any single-record mutation breaks $h_i$ and the link in
$b_{i+1}$; detection probability is $1-\mathrm{negl}$.

---

## 6. The adjudication protocol

The core gate decides and signs. The adjudication protocol makes an authorization **non-bypassable within
the executor's trust boundary and cryptographically verifiable after the fact**, enforcing:

> **Invariant.** *Every protected execution corresponds to exactly one valid authorization receipt, and
> the executed action exactly matches the authorized action.*

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/adjudication-dark.svg" />
    <img width="720" src="assets/adjudication-light.svg" alt="Sentinel adjudication: adjudicate → receipt → execute → audit" />
  </picture>
</p>

### 6.1 Canonical action and digest

`toCanonicalAction` normalizes an action to a canonical form; $d_a=H(\mathrm{canon}(a))$ is its digest.
Canonicalization makes "the same action" hash identically and "a different action" hash differently.

### 6.2 Authorization receipt

An `ALLOW` from the adjudicator (the §5.3 rule) yields a signed receipt

$$\mathcal{R}=\big\langle\, \mathrm{id},\; d_a,\; d_c,\; d_\pi,\; d_e,\; \tau_{\text{exp}},\; n,\; \mathrm{keyId} \,\big\rangle,\qquad \sigma_\mathcal{R}=\mathrm{Sign}_{\mathrm{sk}_{\text{iss}}}\!\big(\mathrm{canon}(\mathcal{R})\big),$$

binding the action ($d_a$), context ($d_c$), **policy commitment** ($d_\pi$), **evidence commitment**
($d_e$), an expiry $\tau_{\text{exp}}$, and a single-use nonce $n$. The receipt never carries its own key;
the validator pins to trusted issuer keys.

### 6.3 Execution-time validation

The protected executor receives the *real* action $a'$ and recomputes $d_{a'}=H(\mathrm{canon}(a'))$. It
**accepts** iff all hold:

$$
\underbrace{\mathrm{Verify}_{\mathrm{pk}_{\text{iss}}}(\sigma_\mathcal{R})\wedge \mathrm{pk}_{\text{iss}}\in\mathcal{K}}_{\text{forgery}}
\;\wedge\;
\underbrace{d_{a'}=d_a}_{\text{substitution}}
\;\wedge\;
\underbrace{d_c'=d_c \wedge d_\pi\models\pi_{\text{req}}}_{\text{context/policy}}
\;\wedge\;
\underbrace{\mathrm{now}<\tau_{\text{exp}} \wedge \mathrm{id}\notin\mathrm{Rev}}_{\text{freshness}}
\;\wedge\;
\underbrace{\mathrm{consume}(n)}_{\text{single-use}}.
$$

Any failure is a typed rejection (`ACTION_MISMATCH`, `REVOKED_RECEIPT`, …); the handler never runs.

### 6.4 Single-use under concurrency

$\mathrm{consume}(n)$ is an atomic compare-and-set on a nonce store. For $N$ concurrent executors
presenting the same receipt,

$$\big|\{\text{executors that succeed}\}\big| = 1.$$

A successful execution emits a signed **execution receipt** linking back to $\mathcal{R}$.

### 6.5 Complete-mediation audit

Let $E$ be executions and $\mathcal{A}$ authorizations. Coverage is

$$\mathrm{Cov}=\frac{\big|\{x\in E:\ \exists!\,r\in\mathcal{A},\ \mathrm{match}(x,r)\}\big|}{|E|}.$$

Complete mediation holds iff $\mathrm{Cov}=1$, with no **orphan** execution (an effect without an
authorization) and no authorization consumed twice. `auditCompleteMediation` reconciles the two logs and
emits coverage plus typed violations.

### 6.6 External checkpoints

Periodic signed checkpoints (Merkle roots of the chain [19, 20]) are published to external witnesses, so
silent truncation or rewrite of the local log is detectable by a third party.

---

## 7. Security analysis

### 7.1 Attacks and mechanisms

| Attack | Defeated by |
| --- | --- |
| **Action substitution** | executor recomputes $d_{a'}$ from the real action; reject on `ACTION_MISMATCH` |
| **Replay** | atomic single-use nonce; under concurrency exactly one winner |
| **Forged / unauthorized execution** | signed receipts pinned to trusted issuer keys (receipt carries no key) |
| **Policy / context substitution** | commitments $d_\pi,d_c$ the validator can require to match |
| **Stale authorization** | `expiresAt` + revocation (`REVOKED_RECEIPT`) |
| **Missing-evidence downgrade** | fail-safe rule escalates on unavailable evidence (§5.3) |
| **Silent log truncation/rewrite** | hash-chained provenance + externally-witnessed checkpoints |

### 7.2 Non-goals and explicit caveats

These are deliberate boundaries; stating them is part of the design.

1. **Non-bypassable only *within the executor's trust boundary*.** The guarantee holds for an executor
   that actually calls the validator before acting. Sentinel cannot stop a component that performs the
   effect while ignoring the gate, nor code *inside* the boundary that holds the keys. Integration is the
   deployment's responsibility; the protocol makes the check enforceable and auditable.
2. **Verifier independence is *declared*, not *proven*.** The independence profile records
   operator-asserted facts (different model family, gate-owned prompt/policy, separate credentials) and
   flags correlated-failure risk. Sentinel cannot prove at runtime that the "independent" model is truly
   independent; an empty warning set is not a proof ($\rho>0$ in §5.5 cannot be ruled out by the system).
3. **Policy commitments pin a *version*, not the *code*.** Policy packs contain code, which cannot be
   content-hashed; the commitment binds definition data + configuration + explicit checker versions. A
   compromised build keeping the same version string is out of scope (a supply-chain concern).
4. **Evidence is committed by digest, not re-verified.** A receipt proves *which* evidence backed a
   decision and detects its substitution; it does not establish that the source was honest (source trust
   is modeled via `trustLevel`, not guaranteed).

---

## 8. Evaluation

### 8.1 Methodology

A deterministic, reproducible harness (`eval/`, `npm run eval`) drives the **real** components — the
verdict `Engine`, the `Adjudicator`, the `ReceiptValidator`, the `ProtectedExecutor` — over a seeded
scenario corpus; nothing under test is mocked. We sweep five **defense rungs** against five **attacks** and
report the attack-success rate (fraction of attempts where the unsafe/unauthorized action actually
executed; lower is better). Results below: seed 1, 60 scenarios.

### 8.2 Attack-success matrix

| Defense rung | unsafe proposal | substitution | replay | forged auth | evidence downgrade |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 · no verification | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| 2 · self-verification | ~0.47 | 1.00 | 1.00 | 1.00 | 1.00 |
| 3 · deterministic checks | ~0.52 | 1.00 | 1.00 | 1.00 | 1.00 |
| 4 · independent adjudication (decision-only) | 0.00 | 1.00 | 1.00 | 1.00 | 0.00 |
| 5 · full protocol (execution-bound receipts) | **0.00** | **0.00** | **0.00** | **0.00** | **0.00** |

### 8.3 The load-bearing result

Two deltas carry the contribution:

- **3 → 4** closes the *evidence-downgrade* column **structurally** (the real adjudicator escalates on
  unavailable evidence). The unsafe-proposal drop here reflects an *idealized* verifier (see §8.5) — it
  bounds what a flawless reviewer achieves, not a property of the logic.
- **4 → 5** drives *substitution*, *replay*, and *forged-auth* to zero. **No proposal-time verifier can
  close this gap**, however good its judgment: rung 4 is an ideal independent verifier and still scores
  1.00 on all three. This matches §5.5: $R_{\text{exec}}=1$ until execution binding, then
  $\le\varepsilon_{\text{crypto}}$ — and **does not depend on model accuracy**.

### 8.4 Guarantee figures

- **Mediation coverage = 1.00** — on a clean run, every execution maps to exactly one valid authorization.
- **Audit detection rate = 1.00** — every injected violation (substitution, orphan, replay, invalid
  signature) is flagged.
- **Replay under concurrency** — firing 8 parallel executors at one single-use receipt yields exactly **1**
  winner.

### 8.5 Modeling notes (honesty)

Rungs 3–5 are real code paths; rungs 1–2 are deterministic *models* ("no gate"; "the agent's own model
re-checks", with a per-scenario `correlatedBlindSpot` flag — the §5.5 correlation, not a claim about any
specific model). The execution-time columns (substitution/replay/forged) deliberately **do not depend on
model accuracy**: those attacks present a benign proposal and strike at execution, so they beat rungs 1–4
regardless of verifier quality — which is the point. For the unsafe-proposal column, rungs 4–5 feed the
adjudicator a hardcoded `BLOCK` oracle on unsafe actions, so the rung-4 `0.00` there measures an
*idealized perfect independent verifier* (necessary but not sufficient), not the adjudicator's own
judgment. The genuinely structural results are the execution-time columns and the evidence-downgrade
column.

---

## 9. Novelty and discussion

No individual primitive here is new: reference monitors [13], complete mediation and fail-safe defaults
[14], separation of duty [15], capability tokens [16], hash-chained tamper-evident logs [18–20], and
Ed25519 [21] are decades old. The contribution is their **synthesis into an independent, fail-safe gate
for autonomous agents**, and specifically the **execution-bound, single-use authorization receipt** that
makes *"executed == authorized"* enforceable inside the executor boundary and auditable afterward. §5.5
and §8 isolate *why* this matters: proposal-time verification — the dominant paradigm — leaves an entire
class of execution-time attacks open that better judgment cannot close. The result is deliberately *not*
a claim about model accuracy; it is a structural property of binding authorization to execution.

---

## 10. Deployment and operations

Sentinel ships as a self-hosted sidecar (standalone binary or container) with thin, zero-dependency
client SDKs (TypeScript `@montanalabs/sentinel`, Python `montanalabs-sentinel`) that call `guard()` at the
action boundary and **fail closed** if the sidecar is unreachable. Stores range from in-memory (dev) to
SQLite (durable single-node) to Postgres (HA, multi-writer); a unique-sequence constraint with optimistic
retry keeps a single fork-free provenance chain under concurrent appends. The slow tier's deadline budget
bounds tail latency; a fast `BLOCK` short-circuits it.

---

## 11. Limitations and future work

Beyond the §7.2 caveats: (i) **runtime-attested independence** — moving the independence profile from
*declared* toward *measured* (e.g., divergence tests, distinct-provider attestation); (ii) **code-level
policy commitments** — binding executed logic, not just a version string, via reproducible builds or
attestation; (iii) **evidence provenance** — extending source-signature support toward verifiable
credentials; (iv) **broader empirical evaluation** — adversarial proposal corpora and live cross-model
second-opinion studies to characterize $R_{\text{prop}}$ in the field (distinct from the structural
$R_{\text{exec}}$ result).

---

## 12. Conclusion

As agents are trusted with consequential actions, the safety-critical question shifts from *"is the model
good?"* to *"is there an independent, fail-safe authority between the decision and the act, and can anyone
verify what happened?"* Sentinel answers yes on both counts: an independent gate that fails safe by
construction and signs every verdict, and an adjudication protocol whose authorizations are
execution-bound, single-use, and auditable. The mechanism is built from classical principles; its value is
the synthesis — and, as the evaluation shows, one structural guarantee that no amount of model quality can
substitute for.

---

## References

[1] S. Yao et al. *ReAct: Synergizing Reasoning and Acting in Language Models.* ICLR, 2023.
[2] T. Schick et al. *Toolformer: Language Models Can Teach Themselves to Use Tools.* NeurIPS, 2023.
[3] Anthropic. *Model Context Protocol.* Specification, 2024.
[4] Y. Bai et al. *Constitutional AI: Harmlessness from AI Feedback.* arXiv:2212.08073, 2022.
[5] H. Inan et al. *Llama Guard: LLM-based Input-Output Safeguard for Human-AI Conversations.* arXiv:2312.06674, 2023.
[6] T. Rebedea et al. *NeMo Guardrails: A Toolkit for Controllable and Safe LLM Applications.* EMNLP (System Demonstrations), 2023.
[7] R. Greenblatt, B. Shlegeris et al. *AI Control: Improving Safety Despite Intentional Subversion.* ICML, 2024.
[8] G. Irving, P. Christiano, D. Amodei. *AI Safety via Debate.* arXiv:1805.00899, 2018.
[9] D. Amodei et al. *Concrete Problems in AI Safety.* arXiv:1606.06565, 2016.
[10] M. Leucker, C. Schallhart. *A Brief Account of Runtime Verification.* Journal of Logic and Algebraic Programming, 78(5), 2009.
[11] F. B. Schneider. *Enforceable Security Policies.* ACM Transactions on Information and System Security, 3(1), 2000.
[12] M. Alshiekh et al. *Safe Reinforcement Learning via Shielding.* AAAI, 2018.
[13] J. P. Anderson. *Computer Security Technology Planning Study.* USAF ESD-TR-73-51, 1972.
[14] J. H. Saltzer, M. D. Schroeder. *The Protection of Information in Computer Systems.* Proceedings of the IEEE, 63(9), 1975.
[15] D. D. Clark, D. R. Wilson. *A Comparison of Commercial and Military Computer Security Policies.* IEEE Symposium on Security and Privacy, 1987.
[16] J. B. Dennis, E. C. Van Horn. *Programming Semantics for Multiprogrammed Computations.* Communications of the ACM, 9(3), 1966.
[17] D. Hardt (ed.). *The OAuth 2.0 Authorization Framework.* RFC 6749, 2012.
[18] S. A. Crosby, D. S. Wallach. *Efficient Data Structures for Tamper-Evident Logging.* USENIX Security, 2009.
[19] R. C. Merkle. *A Digital Signature Based on a Conventional Encryption Function.* CRYPTO, 1987.
[20] B. Laurie, A. Langley, E. Kasper. *Certificate Transparency.* RFC 6962, 2013.
[21] D. J. Bernstein et al. *High-speed High-security Signatures (Ed25519).* Journal of Cryptographic Engineering, 2(2), 2012.

---

## Appendix A — Notation

| Symbol | Meaning |
| --- | --- |
| $a,c,\pi,e$ | action, context, policy, evidence |
| $H,\ \mathrm{canon}$ | collision-resistant hash (SHA-256); canonical serializer |
| $d_x=H(\mathrm{canon}(x))$ | digest of $x$ |
| $V,\ \preceq,\ \sqcup$ | verdict set; safety order $\textsf{ALLOW}\prec\textsf{ESCALATE}\prec\textsf{BLOCK}$; join $=\max_\preceq$ |
| $g(a,c,\pi)$ | gate verdict |
| $p_a,\ p_v,\ \rho$ | proposer harmful-rate; verifier miss-rate; failure correlation |
| $R,\ R_{\text{prop}},\ R_{\text{exec}}$ | total / proposal-time / execution-time residual risk |
| $h_i,\ \sigma_i$ | record content hash; Ed25519 signature |
| $\mathcal{R},\ \sigma_\mathcal{R},\ n,\ \tau_{\text{exp}}$ | authorization receipt; its signature; single-use nonce; expiry |
| $\mathrm{Cov}$ | complete-mediation coverage |

<p align="center"><sub>© 2026 Montana Labs · Sentinel is released under Apache-2.0 · <code>info@montanalabs.ai</code></sub></p>
