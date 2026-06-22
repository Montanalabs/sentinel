# Policy packs, the rule DSL, and checks

A **policy pack** maps a `policy` string (e.g. `"fintech.payments"`) to an ordered list of **checks**. The engine runs them, aggregates the verdicts, and signs the result.

## How evaluation works
- **Two tiers.** `fast` checks run synchronously; `slow` checks (model calls, ground-truth lookups) run in parallel under a deadline (`SENTINEL_SLOW_BUDGET_MS`). A slow check that misses the deadline **fails safe to ESCALATE**.
- **Aggregation precedence:** `BLOCK > ESCALATE > ALLOW`. The action's verdict is the highest-precedence verdict any check returns.
- **Short-circuit:** if the fast tier already yields BLOCK, the slow tier is skipped (no wasted model spend).
- Every decision — whatever the verdict — produces one signed provenance record.

---

## Built-in packs

### `fintech.payments`
```ts
fintechPaymentsPack({ highValueThreshold?, approvers?, sanctioned? })
```
| Config | Default | Meaning |
|---|---|---|
| `highValueThreshold` | `25000` | transfers strictly above this require dual-control sign-off (→ ESCALATE) |
| `approvers` | `['treasury_ops']` | roles whose approval the escalation requests |
| `sanctioned` | – | static sanctioned counterparties (in addition to any ledger connector) |

Checks: `schema` (payment shape) → `policy:fintech.payments` (dual-control, static sanctioned) → *(if a ledger connector is provided)* `counterparty-sanctions` + `reconcile:action.payload.amount` (balance) → *(if a provider is provided)* `second-opinion`.

### `healthcare.record_write`
```ts
healthcareRecordsPack({ allowedProviders?, allowedRegions?, approvers? })
```
| Config | Default | Meaning |
|---|---|---|
| `allowedProviders` | `['anthropic']` | providers cleared to receive PHI |
| `allowedRegions` | `['US']` | regions cleared to receive PHI |
| `approvers` | `['attending_physician']` | sign-off roles for clinically-significant changes |

Checks: `schema` → `policy:healthcare.record_write` (clinician sign-off when `payload.clinicalSignificant === true`) → `data-boundary` (PHI fields) → *(if a clinical connector is provided)* `patient-exists` → *(if a provider is provided)* `second-opinion`.

### Registering packs

> `sentinel` here is the **server** package ([github.com/montanalabs/sentinel](https://github.com/montanalabs/sentinel)) — run from source for embedding, not the `@montanalabs/sentinel` client SDK.

```ts
import { defaultRegistry } from 'sentinel';

const registry = defaultRegistry(
  { ledger, clinical, provider },                                  // ground-truth + second-opinion deps
  { fintech: { highValueThreshold: 50_000 }, healthcare: { allowedRegions: ['EU'] } },
);
// registry.resolve('fintech.payments') -> Check[]
```
When you run the sidecar via `buildSentinel`, pass `ledger` / `clinical` in the overrides; the provider comes from `SENTINEL_SECOND_OPINION_PROVIDER`.

---

## The rule DSL (`PolicyCheck`)
Policy rules are **plain data** (no code eval — safe to transmit and sign).

```ts
interface PolicyDefinition {
  id: string;
  rules: PolicyRule[];
  defaultEffect?: 'allow' | 'block';   // when no rule matches (default 'allow')
}
interface PolicyRule {
  id: string;
  when: Condition;
  effect: 'allow' | 'block' | 'require_approval';
  approvers?: string[];                // for require_approval
  reason?: string;
}
```
Effect → verdict: `allow`→ALLOW, `block`→BLOCK, `require_approval`→ESCALATE. When several rules match, the highest-precedence effect wins (block > require_approval > allow).

### Conditions
```ts
type Condition =
  | { field: string; op: CompareOp; value: unknown }
  | { all: Condition[] }     // AND
  | { any: Condition[] }     // OR
  | { not: Condition };
```
**Operators (`CompareOp`):** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` (value is an array, field ∈ array), `nin` (field ∉ array), `contains` (field is an array, contains value). Numeric comparisons return `false` for non-numbers; a missing field never throws.

**Field paths** resolve against the request scope:
- `action.type`, `action.payload.<key>`, `action.meta.<key>`
- `context.runId`, `context.provider`, `context.model`, `context.actor.id`, `context.actor.roles`, `context.tenant`

### Example
```ts
const def: PolicyDefinition = {
  id: 'fintech.payments',
  rules: [
    { id: 'deny_sanctioned', when: { field: 'action.payload.to', op: 'in', value: ['acct_ofac_1'] },
      effect: 'block', reason: 'sanctioned counterparty' },
    { id: 'dual_control', when: { field: 'action.payload.amount', op: 'gt', value: 25_000 },
      effect: 'require_approval', approvers: ['treasury_ops'], reason: 'high-value transfer' },
    { id: 'cross_border', when: { all: [
        { field: 'action.payload.amount', op: 'gt', value: 1000 },
        { field: 'action.meta.region', op: 'ne', value: 'US' } ] },
      effect: 'require_approval', approvers: ['compliance'] },
  ],
};
```

---

## Checks reference
All checks implement `{ name, tier, run(input) -> CheckResult }`. Compose them in a pack.

| Check | Tier | Constructor | Behaviour |
|---|---|---|---|
| `SchemaCheck` | fast | `new SchemaCheck({ [actionType]: jsonSchema })` | Validates `action.payload` against the JSON Schema for its type. No schema for the type → ALLOW (not applicable). Invalid → BLOCK with `details.errors`. |
| `PolicyCheck` | fast | `new PolicyCheck(policyDefinition)` | Evaluates the rule DSL above. |
| `NumericReconcileCheck` | slow | `new NumericReconcileCheck({ field, relation, source, reason? })` | Reconciles a numeric `field` against `source(input)` (an async source-of-truth). `relation` ∈ `lte\|lt\|eq\|gte\|gt`. Source returns `undefined` → ESCALATE (can't verify). Non-numeric field → BLOCK. |
| `DataBoundaryCheck` | fast | `new DataBoundaryCheck({ piiFields, allowedProviders?, allowedRegions?, regionField? })` | If any `piiFields` path is present/non-empty and the provider/region isn't cleared → BLOCK. No PII → ALLOW. `regionField` default `action.meta.region`. |
| `PredicateCheck` | configurable | `new PredicateCheck({ name, tier, predicate })` | Adapts any `async (input) => { verdict, reason?, details? }`. Predicate throws → ESCALATE (fail-safe). Use for connector-backed checks. |
| `SecondOpinionCheck` | slow | `new SecondOpinionCheck({ provider, question })` | Asks an independent model. Agree → ALLOW, disagree → ESCALATE, provider error → ESCALATE. `question` is a string or `(input) => string`. |

`CheckResult`:
```ts
{ check: string; outcome: 'pass'|'fail'|'inconclusive'; verdict: 'ALLOW'|'BLOCK'|'ESCALATE';
  reason?: string; details?: Record<string, unknown>; latencyMs?: number }
```

---

## Write a custom pack (step by step)
Goal: gate a `record_update` so it's schema-valid, requires sign-off for clinically-significant changes, and (if a clinical connector is wired) only writes for known patients.

```ts
import {
  SchemaCheck, PolicyCheck, PredicateCheck, type Check,
} from 'sentinel';
import type { PackDeps, PolicyPack } from 'sentinel';

const RECORD_SCHEMA = {
  type: 'object', required: ['patientId', 'field', 'value'],
  properties: { patientId: { type: 'string' }, field: { type: 'string' }, value: {}, clinicalSignificant: { type: 'boolean' } },
};

export function clinicalNotesPack(): PolicyPack {
  return {
    id: 'clinical.notes',
    build(deps: PackDeps): Check[] {
      const checks: Check[] = [
        new SchemaCheck({ record_update: RECORD_SCHEMA }),
        new PolicyCheck({
          id: 'clinical.notes',
          rules: [{ id: 'signoff', when: { field: 'action.payload.clinicalSignificant', op: 'eq', value: true },
                    effect: 'require_approval', approvers: ['attending_physician'], reason: 'significant change' }],
        }),
      ];
      if (deps.clinical) {
        const clinical = deps.clinical;
        checks.push(new PredicateCheck({
          name: 'patient-exists', tier: 'slow',
          predicate: async ({ action }) => {
            const exists = await clinical.patientExists(String(action.payload['patientId']));
            if (exists === false) return { verdict: 'BLOCK', reason: 'unknown patient' };
            if (exists === undefined) return { verdict: 'ESCALATE', reason: 'could not verify patient' };
            return { verdict: 'ALLOW' };
          },
        }));
      }
      return checks;
    },
  };
}
```
Register and run it:
```ts
import { PolicyRegistry, buildServer, Engine, RecordBuilder, Signer, openStore, EscalationManager } from 'sentinel';

const store = await openStore(process.env.SENTINEL_DATABASE_URL);
const registry = new PolicyRegistry({ clinical }).register(clinicalNotesPack());
const builder = new RecordBuilder(Signer.generate());
const engine = new Engine({ resolve: (id) => registry.resolve(id), builder, store });
const app = buildServer({ engine, store, escalations: new EscalationManager(), builder });
await app.listen({ port: 4000 });
```
Now `POST /v1/guard` with `"policy": "clinical.notes"` runs your checks.
