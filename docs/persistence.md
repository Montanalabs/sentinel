# Persistence & storage

Sentinel persists its **audit trail** — and, when the [adjudication protocol](./adjudication-protocol.md)
is enabled, its **receipt/nonce/revocation ledgers** — to a store you choose with a single setting:
`SENTINEL_DATABASE_URL`. This page covers the backends, what's stored where, HA, schema, backups, and
retention.

## One setting, three backends

| `SENTINEL_DATABASE_URL` | Backend | Durable? | Multi-writer / HA? | Needs |
|---|---|---|---|---|
| `memory` *(default)* | in-process | ❌ lost on restart | ❌ single process | nothing — dev only |
| `sqlite:./sentinel.db` | embedded SQLite (`node:sqlite`) | ✅ on disk | ❌ single node | Node ≥ 22.5 (or the binary/image, which bundle it) |
| `postgres://user:pass@host/db` | PostgreSQL | ✅ | ✅ many sidecars, one DB | a reachable Postgres (RDS, Neon, self-hosted…) |

The **same URL** drives both the provenance chain and the protocol stores — one configuration point for
all persistence.

```bash
SENTINEL_DATABASE_URL=memory                                   # dev, non-durable
SENTINEL_DATABASE_URL=sqlite:/var/lib/sentinel/sentinel.db     # durable single-node
SENTINEL_DATABASE_URL=postgres://sentinel:***@rds:5432/sentinel # durable, HA
```

## What gets stored

**Always — the provenance chain.** One append-only, hash-chained, Ed25519-signed record per decision
(ALLOW/BLOCK/ESCALATE) and per human approve/deny. This *is* the audit trail. See
[provenance & audit](./provenance.md) for the record format and verification.

**When `SENTINEL_PROTOCOL_ENABLED=1` — four additional ledgers** (same database, separate tables):

| Store | Holds | Why durability matters |
|---|---|---|
| **nonce** | single-use authorization-receipt nonces | a receipt must be spendable **exactly once** — across all replicas |
| **receipt** | issued authorization receipts | validation & audit look them up |
| **execution** | ingested signed execution receipts | the complete-mediation audit reconciles these against authorizations |
| **revocation** | revoked receipt ids | a revoked receipt must fail closed at the next validation, everywhere |

> **Durability of the protocol stores:** on **`sqlite:`** (same DB file, separate tables) and
> **`postgres://`** (durable, multi-writer tables) these ledgers are persistent. Only **`memory`** is
> non-durable. Postgres is **required for HA** — every sidecar must share one nonce ledger and one
> revocation list, or the single-use / revocation guarantees degrade to per-instance.

## Schema & migrations

There are none to run. Each backend **ensures its own schema on connect** (idempotent `CREATE TABLE IF
NOT EXISTS …`) — the provenance table for the chain, plus the four protocol tables when enabled. Point
the URL at an empty database and the sidecar creates what it needs. SQLite keeps everything in the one
file; Postgres creates the tables in the target database.

## Connection handling (Postgres)

- Connections use a **pooled** client, so concurrent guards don't open a connection each.
- On startup the sidecar **retries the initial connect** with backoff (~20s window) so it can come up
  alongside a database that's still warming (e.g. RDS failover, `docker compose` ordering) instead of
  crash-looping.
- A store that becomes unreachable at runtime surfaces as **`503` on `/readyz`** (so your load balancer
  drains the pod) and provenance appends retry per `SENTINEL_APPEND_RETRIES`.

## High availability

Run several sidecars behind a load balancer, all pointing at **one Postgres**:

- **Provenance chain:** a unique-sequence constraint + optimistic retry (`SENTINEL_APPEND_RETRIES`,
  default 12) means concurrent appends from many replicas still produce **one linear, fork-free chain**
  that verifies `ok:true`. Raise the retry count under very heavy write contention.
- **Protocol ledgers:** single-use nonce consumption is an **atomic conditional upsert** at the
  database layer (no read-then-write race), so firing N parallel executors at one receipt yields exactly
  one winner — cluster-wide. Revocations are shared, so a revoked receipt fails closed on every replica.

SQLite and `memory` are **single-node**; use Postgres for more than one replica.

## Backups & recovery

- **Postgres:** back up with your normal tooling (managed snapshots, `pg_dump`, PITR). Because the chain
  is self-verifying, you can confirm a restore's integrity immediately with `GET /v1/verify` /
  `sentinel verify`.
- **SQLite:** back up the `.db` file (and its `-wal`/`-shm` siblings) — snapshot while the process is
  quiesced, or use SQLite's online backup. The default scaffold `.gitignore` excludes `*.db`.
- After any restore, run **`sentinel verify`** to confirm the chain is intact (`ok:true`).

## Retention

The trail is **append-only by design** — records are never edited and there is no built-in pruning,
because deleting records would break the hash chain and defeat the audit guarantee. To manage long-term
volume, **export and archive**: `GET /v1/export` (same filters as `/v1/records`) streams the signed
records to a GRC platform, the separate control-plane project, or your own cold storage. If you must
truncate, do it at a chain boundary and treat the prior segment as a sealed, separately-verified bundle.

## Choosing a backend

- **Local dev / CI:** `memory` (zero setup) or `sqlite:` (durable across runs).
- **Single node, durable, no DB server:** `sqlite:` on a persistent volume.
- **Production / multiple replicas / HA / receipts:** **Postgres** — the only backend that is both
  durable *and* multi-writer.

See also: [self-hosting](./self-hosting.md) (full config table), [deploying](./deploying.md) (RDS, k8s
StatefulSet, ECS), and [provenance & audit](./provenance.md) (record format & verification).
