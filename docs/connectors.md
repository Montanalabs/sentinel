# Connectors (ground truth)

Checks reconcile proposed actions against **your** systems of record. A connector is the independent source of truth Sentinel reads — its lookups **fail safe** so that when the truth is unavailable the gate ESCALATES rather than wrongly allowing.

> **Wiring custom connectors is an embedding feature.** The `import { … } from 'sentinel'` examples below require running the gate **from source** (`git clone` + `npm install`) — here `sentinel` is the **server** package ([github.com/montanalabs/sentinel](https://github.com/montanalabs/sentinel)), distinct from the `@montanalabs/sentinel` client SDK, and is not yet published to npm. The standalone binary and Docker image run with the **built-in** packs/connectors; the published-package path for custom connectors via `sentinel.config.mjs` lands when the package is published.

## Ledger connector
```ts
interface LedgerConnector {
  name: string;
  balance(account: string): Promise<number | undefined>;          // undefined = unknown/unavailable
  counterpartyStatus(id: string): Promise<'ok' | 'sanctioned' | 'unknown'>;
}
```
Used by the fintech pack for balance reconciliation and sanctioned-counterparty denial.

**Built-in implementations:**
```ts
import { StaticLedgerConnector, HttpLedgerConnector } from 'sentinel';

// dev / tests
const ledger = new StaticLedgerConnector({ balances: { acct_ops: 250_000 }, sanctioned: ['acct_ofac_1'] });

// production: REST core-banking/ledger
const ledger = new HttpLedgerConnector('https://ledger.internal', { headers: { authorization: 'Bearer …' } });
//   GET {base}/accounts/:id/balance        -> { balance: number }   (404 -> undefined)
//   GET {base}/counterparties/:id          -> { status: 'ok'|'sanctioned'|'unknown' }
// Any network error -> balance undefined / status 'unknown' (so reconciliation ESCALATES).
```

## Clinical connector (FHIR-style)
```ts
interface ClinicalConnector {
  name: string;
  patientExists(patientId: string): Promise<boolean | undefined>; // undefined = couldn't determine
  getAllergies(patientId: string): Promise<string[]>;
}
```
Used by the healthcare pack for patient-exists verification.

```ts
import { StaticClinicalConnector, HttpFhirConnector } from 'sentinel';

const clinical = new StaticClinicalConnector({ patients: ['p1', 'p2'], allergies: { p1: ['penicillin'] } });

const clinical = new HttpFhirConnector('https://fhir.internal');
//   GET {base}/Patient/:id                 -> 200 exists / 404 not-found / error -> undefined
//   GET {base}/Patient/:id/allergies       -> { allergies: string[] }   (error -> [])
```

## Wiring a connector into the engine
Pass connectors as pack dependencies; the built-in packs add the relevant checks automatically when a connector is present:
```ts
import { buildSentinel } from 'sentinel';

const { app } = await buildSentinel(config, { ledger, clinical });
```
or with a registry directly:
```ts
const registry = defaultRegistry({ ledger, clinical, provider });
```

## Write a custom connector
Implement the interface and back it with whatever you like (gRPC, a warehouse, an internal API). Then use it from a pack via `NumericReconcileCheck` (for numbers) or `PredicateCheck` (for anything else):
```ts
import { NumericReconcileCheck, PredicateCheck } from 'sentinel';

// reconcile amount <= live balance
new NumericReconcileCheck({
  field: 'action.payload.amount', relation: 'lte',
  reason: 'insufficient funds',
  source: async ({ action }) => myLedger.balance(String(action.payload['from'])),
});

// arbitrary connector-backed rule
new PredicateCheck({
  name: 'inventory-available', tier: 'slow',
  predicate: async ({ action }) => {
    const onHand = await myWarehouse.stock(String(action.payload['sku']));
    if (onHand === undefined) return { verdict: 'ESCALATE', reason: 'stock unknown' };
    return onHand >= Number(action.payload['qty'])
      ? { verdict: 'ALLOW' }
      : { verdict: 'BLOCK', reason: 'insufficient stock', details: { onHand } };
  },
});
```

## Fail-safe principle
Every connector lookup that can't return a confident answer should resolve to "unknown" (`undefined` / `'unknown'`) — the checks turn that into **ESCALATE**, never a silent ALLOW. This is what keeps the gate trustworthy when a backend is down.
