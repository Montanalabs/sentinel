# Security & trust model

What Sentinel protects, what it assumes you handle, and how to deploy it safely.

## Trust boundary

The sidecar is a **separate process / trust domain** from the agent. It holds the policy, the
connectors, and the **signing key the agent never sees**. The agent can only *propose*; it cannot
forge a verdict, because a verdict is a record signed by the sidecar's Ed25519 key.

| Agent process | Sidecar process — the trust boundary |
|---|---|
| Proposes actions | Owns the policy, the connectors, and the signing key |
| Receives verdicts | Renders **and signs** every decision |
| **Cannot** sign or forge a verdict | **Cannot** be bypassed without detection (the hash chain) |

## What it protects against

- **An agent self-certifying.** A model vendor blessing its own output isn't acceptable to an
  auditor; an independent gate is.
- **Tampering with the audit trail.** Every decision is an append-only, hash-chained, signed record.
  Any insert/delete/edit breaks `GET /v1/verify`. See [provenance](./provenance.md).
- **Silent failure.** Uncertainty resolves to ESCALATE/BLOCK, never a quiet ALLOW (see
  [fail-safe](./concepts.md#fail-safe-by-construction)). The SDK fails **closed** on transport failure.
- **Key-substitution forgery.** The signer's public key is bound into the signed record body and the
  `keyId` is the **full SHA-256** of that key; verification re-derives it and recomputes the content
  hash *before* checking the signature. You cannot swap keys or truncate-collide a `keyId`.

## What it does NOT do (your responsibility)

- **The `/v1/*` API is unauthenticated by design.** It is an *internal gate*, not a public endpoint.
  Anyone who can reach the port can ask for a verdict. Therefore:
  - The sidecar **binds loopback (`127.0.0.1`) by default.** Keep it there for a true sidecar
    (same pod/host as the agent, talking over localhost).
  - To listen beyond loopback (`SENTINEL_HOST=0.0.0.0`, as containers do), put it on a **private
    network behind an authenticating gateway / mTLS / ingress** — never on the public internet.
  - Turn on `SENTINEL_RATE_LIMIT_BURST` + `SENTINEL_RATE_LIMIT_RPS` and `SENTINEL_MAX_CONCURRENT`
    when exposed.
- **It is not a secrets manager.** Provide API keys and the signing seed via your platform's secret
  store / env injection.

## The signing key

- Set **`SENTINEL_SIGNING_SEED`** (base64 Ed25519 seed; generate with `sentinel keygen`) in
  production and store it as a **secret**. It is the identity that signs your entire audit trail.
- Without it, the sidecar generates an **ephemeral** key at boot — fine for dev, but records signed
  before a restart can't be verified against the new key.
- **Key rotation:** verification accepts a set of trusted keys, so you can roll the seed and keep
  verifying historical records against the prior key id. The `/v1/verify` path pins to the active
  signer plus rotated keys.

## Connectors fail safe

Ground-truth [connectors](./connectors.md) (ledger, EHR, APIs) are written so that an *unavailable*
or *unknown* answer becomes **ESCALATE**, never a silent ALLOW. A backend outage degrades the gate to
"hold for a human," not "wave it through."

## Data handling

- Keep secrets in `.env` (gitignored); never commit them. `.env.example` (tracked) holds only blanks.
- For regulated data (PHI/PCI), run the sidecar **in-VPC / on-prem** and point connectors at internal
  systems so sensitive values never leave your boundary. The healthcare pack's `DataBoundaryCheck`
  blocks PHI from reaching an uncleared provider/region.
- Provenance records store the action and a fingerprint; scope what you put in `action.payload`
  accordingly.

## The adjudication protocol (stronger guarantee)

The base gate returns a verdict. The optional [adjudication protocol](./adjudication-protocol.md)
(`SENTINEL_PROTOCOL_ENABLED=1`) turns an ALLOW into a **single-use, execution-bound authorization
receipt** and adds a complete-mediation audit — closing the gap between "was approved" and "the
*approved* action is the one that executed, exactly once." Use it when an attacker controls the
execution path, not just the proposal.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md) for the disclosure process.

## Deployment checklist

- [ ] `SENTINEL_SIGNING_SEED` set from a secret store (stable signer)
- [ ] Durable `SENTINEL_DATABASE_URL` (sqlite or postgres), backed up
- [ ] Loopback by default; if `0.0.0.0`, it's behind a gateway / mTLS on a private network
- [ ] Rate limit + max-concurrent configured when exposed
- [ ] API keys & seed injected as secrets, not baked into images
- [ ] `GET /readyz` wired to your load-balancer / k8s readiness probe
- [ ] `sentinel verify` (or `GET /v1/verify`) run periodically as an integrity check
