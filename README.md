# Anvil

[![CI](https://github.com/ykstorm/anvil/actions/workflows/ci.yml/badge.svg)](https://github.com/ykstorm/anvil/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ykstormsorg/anvil?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ykstormsorg/anvil)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)

> Idempotent webhook to BullMQ worker pipeline. HMAC-SHA256, fixed-schedule retry, dead-letter replay.

## The problem

A provider sends you a webhook. You have to check it is genuine, make sure you
do not process the same delivery twice, and get your slow business logic off the
request path so the sender does not time out. Then the hard parts: the delivery
retries, your handler crashes mid-job, the provider re-sends the same event, and
a few jobs never succeed and need somewhere to go.

Anvil is the piece between the provider and your business logic. It verifies the
signature, drops duplicates, puts one job on a queue, and returns 202 fast. A
worker runs your handler in the background on a fixed retry schedule, and a
dead-letter queue holds whatever never succeeds. Replay of a dead job is a
separate, manual step so a broken handler cannot loop.

## The five contracts

Each of these has a test, and each is the reason a line of code exists.

- **One job per delivery.** The idempotency key is `sha256(signature header +
  raw body)`. The first delivery claims the key with an atomic
  `SET key <token> NX EX <ttl>` and enqueues one job; later deliveries of the
  same key find it already set and return `replayed: true` without enqueuing
  again. Two concurrent copies of the same delivery still yield exactly one job.
  If adding the job fails after the claim, the claim is released and the server
  answers 503, so the provider's retry is treated as new. The key expires after
  the dedupe TTL (one week by default), which bounds the memory.
- **Constant-time signature check.** `verify(body, sigHeader, secret)` recomputes
  the HMAC-SHA256 over the raw bytes and compares with `crypto.timingSafeEqual`
  after a length check, so the compare never throws and leaks no length oracle.
  An empty secret, a malformed header, or a length mismatch is a plain `false`.
- **Fixed retry backoff.** A failing handler retries after 1s, 5s and 30s;
  after the fourth failure the job moves to the dead-letter queue,
  `webhooks.dead`, with `failureContext: { attempts, lastError }`, where
  `lastError` is truncated and has credential-looking query params redacted.
- **Replay is a separate consumer.** `replayDeadLetter(jobId)` moves a dead job
  back to the main queue with a fresh retry schedule and returns
  `{ replayed: true }`. The replay path starts no worker on the main queue, so
  importing it cannot kick off a retry loop.
- **Small SDK surface.** `@ykstormsorg/anvil` exports exactly `createServer`,
  `createWorker`, and `replayDeadLetter`.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the request flow and the
other docs for the reasoning behind each contract.

## Quickstart

Install the SDK in your app:

```bash
npm install @ykstormsorg/anvil
```

The publish job builds with provenance (`pnpm publish --provenance`). npm does
not check provenance at install time, so verify it yourself after installing:

```bash
npm audit signatures
```

To run this repo (server + worker + examples) from source you need Node 20+ and
a Redis instance. Local Redis in one line:

```bash
docker run -p 6379:6379 redis:7
```

Then:

```bash
pnpm install
pnpm -r build

# terminal 1: the worker
REDIS_URL=redis://localhost:6379 pnpm --filter @anvil/worker start

# terminal 2: the server
WEBHOOK_SECRET=whsec_dev_secret_at_least_16 REDIS_URL=redis://localhost:6379 \
  pnpm --filter @anvil/server start
```

Send a signed request:

```bash
BODY='{"id":"evt_1","type":"charge.succeeded"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac whsec_dev_secret_at_least_16 | awk '{print $2}')"
curl -i -X POST http://localhost:3000/webhooks \
  -H "x-signature: $SIG" \
  -H "content-type: application/json" \
  --data "$BODY"
```

You get back `202 { "jobId": "...", "replayed": false }`. Send the same request
again and `replayed` is `true` with the same `jobId`; the worker still runs the
job once.

The secret must be at least 16 characters; `createServer` throws on a shorter
one. The server also exposes `/healthz` (liveness) and `/readyz` (readiness,
which pings Redis).

## Docker

Local dev, Redis, server, and worker in one command:

```bash
docker compose up --build
```

The server listens on `:3000`. Both app images are multi-stage
`node:20-alpine` builds that run as a non-root user; see
[apps/server/Dockerfile](./apps/server/Dockerfile) and
[apps/worker/Dockerfile](./apps/worker/Dockerfile). The project does not publish
a prebuilt image; build your own from these Dockerfiles.

## Performance

The committed numbers come from one local run of `node bench/throughput.mjs` on
Node 24, recorded in [bench/report-latest.md](./bench/report-latest.md):

| Metric | Value |
|---|---|
| Ingress throughput | ~8,800 req/s |
| Ingress latency p50 / p99 | 5 ms / 13 ms |

That bench drives the real verify, idempotency key, dedupe-enqueue path with an
**in-memory queue stub** (no Redis, no worker), so it isolates Anvil's own cost,
not Redis'. It is one machine, one run: your numbers will differ. CI runs the
benchmark on every push and attaches the output as an artifact
([benchmark.yml](.github/workflows/benchmark.yml)); it does not commit numbers
back here.

`node bench/verify.mjs` reports per-verify cost and the timing delta between a
valid signature and a same-length forgery. A small delta is the evidence for the
constant-time claim: `timingSafeEqual` plus the length guard leaves no timing or
length oracle. Methodology is in [bench/README.md](./bench/README.md).

## Deploy

Two ways to stand up the pipeline (server + worker + Redis). Both are 0.x
scaffolds and provision only what Anvil uses; there is no database.

- **Hetzner Cloud (Terraform):** [infra/terraform/](./infra/terraform/) brings
  up a Redis VM, the webhook server, and a worker pool sized by `worker_count`.
  `WEBHOOK_SECRET` is not templated into cloud-init (user_data is readable);
  provision it on the VM after boot. SSH is closed unless you set
  `ssh_allowed_cidrs`. See the README there.
- **Kubernetes (Helm):** [charts/anvil/](./charts/anvil/) deploys the server
  (Deployment + Service + Ingress on `/webhooks`), the worker, and an in-cluster
  Redis with a NetworkPolicy. You set `image.repository` (no image is published)
  and a real `secret.webhookSecret`; the chart refuses the placeholder.

```bash
# Terraform
terraform -chdir=infra/terraform init && terraform -chdir=infra/terraform apply

# Helm
helm install anvil ./charts/anvil \
  --set image.repository=ghcr.io/you/anvil \
  --set secret.webhookSecret=whsec_real
```

## Known limitations

This is 0.1. It is honest about what it is not yet.

- No container image is published. Build your own from the Dockerfiles.
- The idempotency key includes the signature header, so an exact re-delivery
  (same signature and body) dedupes, but a provider that rotates the signature
  on re-delivery produces a different key. Dedupe on a stable provider event id
  is out of scope.
- The HMAC covers the body only. A captured request with a valid signature can
  be replayed; enforce a timestamp window in your handler if your provider signs
  one. The idempotency key still collapses a byte-for-byte resend.
- The SDK's `./internal/*` subpath is exported and therefore importable by
  consumers. Treat it as unstable: it exists for the apps and bench in this repo,
  not as public API.
- The replay path is single-job and manual; no batch tool and no UI.
- One Redis, one region. Multi-region delivery and cross-region dedupe are out
  of scope.

## Roadmap

- A `replayDeadLetter` batch mode and a small CLI.
- An optional timestamp-tolerance check in the server middleware.

## License

MIT. See [LICENSE](./LICENSE).
