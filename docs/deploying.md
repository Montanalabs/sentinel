# Deploying Sentinel in production

This guide covers running the Sentinel sidecar on real infrastructure — **EC2**, **EKS/Kubernetes**,
or **ECS** — beyond the single-host `docker compose` dev setup in [self-hosting.md](./self-hosting.md).

## Security boundary (read first)

The sidecar's `/v1/*` API is **unauthenticated by design** — it's an internal gate your agents call,
not a public endpoint. Sentinel's job is to *decide and sign*, not to do authn/z. Therefore:

- **Default bind is loopback** (`127.0.0.1`). Set `SENTINEL_HOST=0.0.0.0` only to expose it (the
  container image already does). When exposed, keep it on a **private network** and front it with an
  **API gateway / ingress / mTLS** that authenticates callers.
- **Turn on rate limiting** when reachable by more than localhost (`SENTINEL_RATE_LIMIT_BURST` +
  `SENTINEL_RATE_LIMIT_RPS`) — `/v1/guard` can trigger paid model calls.
- **Set a stable signing seed** (`sentinel keygen` → `SENTINEL_SIGNING_SEED`) so the provenance chain
  verifies across restarts and replicas. Without it each boot signs with an ephemeral key.
- **Use a durable, shared store** (`SENTINEL_DATABASE_URL=postgres://…`). The provenance chain *and*
  the single-use nonce ledger are safe under concurrent writers, so multiple replicas can share one
  Postgres. (In-memory/SQLite are single-node only.)

## The image

Released tags push a multi-arch image to GHCR:

```
ghcr.io/montanalabs/sentinel:1.0.2      # pin a released tag in production
ghcr.io/montanalabs/sentinel:latest
```

It runs `sentinel start` as an unprivileged user, binds `0.0.0.0:4000`, handles `SIGTERM` gracefully
(drains in-flight requests), and exposes `GET /healthz` (liveness) and `GET /readyz` (readiness —
returns 503 when the store is unreachable).

## EC2 (single instance or ASG)

1. **Provision Postgres** — Amazon RDS for PostgreSQL (recommended) or a Postgres container. Note the
   endpoint and credentials.
2. **Generate a signing seed** once and store it in **SSM Parameter Store / Secrets Manager** (not on
   disk): `sentinel keygen`.
3. **Run the container** (Docker installed on the instance):

   ```bash
   docker run -d --name sentinel --restart unless-stopped -p 4000:4000 \
     -e SENTINEL_HOST=0.0.0.0 \
     -e SENTINEL_DATABASE_URL="postgres://sentinel:***@your-rds:5432/sentinel" \
     -e SENTINEL_SIGNING_SEED="$(aws ssm get-parameter --name /sentinel/seed --with-decryption --query Parameter.Value --output text)" \
     -e SENTINEL_PROTOCOL_ENABLED=1 \
     -e SENTINEL_SECOND_OPINION_PROVIDER=anthropic -e ANTHROPIC_API_KEY="***" \
     -e SENTINEL_RATE_LIMIT_BURST=200 -e SENTINEL_RATE_LIMIT_RPS=100 \
     ghcr.io/montanalabs/sentinel:1.0.2
   ```

   Or as a **systemd** unit (`/etc/systemd/system/sentinel.service`) wrapping the same `docker run`
   (or the standalone binary), with `Restart=always` and an `EnvironmentFile=/etc/sentinel/env`.
4. **Network** — put the instance in a private subnet; allow `:4000` only from your agent workloads'
   security group. For external access, terminate **TLS at an ALB** and authenticate at the ALB / an
   API gateway in front — never expose `/v1/*` directly.
5. **Health** — point the ALB target group health check at `/readyz`.

## EKS / Kubernetes

A ready-to-edit manifest is in [`deploy/k8s/sentinel.yaml`](../deploy/k8s/sentinel.yaml): a 2-replica
Deployment + Service + Secret, with liveness/readiness probes, a 30s graceful-termination window,
resource requests/limits, a hardened `securityContext` (non-root, read-only rootfs, dropped caps),
and a zero-downtime rolling-update strategy.

```bash
kubectl create namespace sentinel
# Fill in real values first — use a sealed secret / external-secrets / IRSA + SSM, not plaintext:
kubectl apply -f deploy/k8s/sentinel.yaml
```

Key points the manifest encodes:

- **Postgres**: point `SENTINEL_DATABASE_URL` at RDS (or an in-cluster Postgres StatefulSet). All
  replicas share it.
- **Secrets**: `SENTINEL_SIGNING_SEED`, `SENTINEL_DATABASE_URL`, and any provider key live in a
  `Secret` (swap for sealed-secrets / external-secrets in real clusters).
- **Probes**: liveness `/healthz` (never touches the DB, so a DB blip won't kill healthy pods),
  readiness `/readyz` (drains a pod whose store is down).
- **Graceful shutdown**: `terminationGracePeriodSeconds: 30` lets the SIGTERM handler drain in-flight
  decisions and the provenance append before the pod dies.
- **Exposure**: the `Service` is `ClusterIP` (private). Add an `Ingress` (or service mesh) that does
  **TLS + authentication** in front of it.

## ECS (Fargate)

Use the same image and env in a Task Definition: 2+ tasks behind an internal ALB, `SENTINEL_HOST=0.0.0.0`,
secrets via Secrets Manager (`secrets:` in the container definition), the ALB health check on `/readyz`,
and `stopTimeout: 30` so the SIGTERM drain completes.

## Production checklist

- [ ] `SENTINEL_SIGNING_SEED` set from a secret store (stable across restarts/replicas)
- [ ] `SENTINEL_DATABASE_URL` → shared Postgres (RDS); `SENTINEL_PROTOCOL_ENABLED=1` if using receipts
- [ ] `SENTINEL_HOST=0.0.0.0` only behind a private network + authenticating gateway/mTLS
- [ ] Rate limiting on (`SENTINEL_RATE_LIMIT_BURST` + `_RPS`)
- [ ] Liveness `/healthz`, readiness `/readyz`, graceful-termination window ≥ 15s
- [ ] TLS terminated at the ALB/ingress; `/v1/*` never publicly exposed
- [ ] `GET /v1/verify` wired into monitoring (alerts if the chain ever reports `ok:false`)
