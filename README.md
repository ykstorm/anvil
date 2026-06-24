# Anvil

[![CI](https://github.com/ykstorm/anvil/actions/workflows/ci.yml/badge.svg)](https://github.com/ykstorm/anvil/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ykstormsorg/anvil?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ykstormsorg/anvil)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)

Idempotent webhook to BullMQ worker pipeline.

Anvil is the piece between a provider's webhook and your business logic. It
verifies the signature, drops duplicates, puts one job on a queue, and returns
202 fast. A worker processes the job in the background with a fixed retry
schedule and a dead-letter queue for jobs that never succeed.

## What it does

A webhook arrives over HTTP. Anvil:

1. verifies the HMAC-SHA256 signature over the raw body, in constant time;
2. computes an idempotency key from the signature and the payload bytes;
3. enqueues exactly one BullMQ job per key, even under re-delivery;
4. returns 202 with the job id;
5. runs your handler in a worker, retrying on backoff and dead-lettering after
   the schedule is spent.

Replay of dead jobs is a separate, manual step so a broken handler cannot loop.

## Quickstart

Install the SDK in your app with `npm install @ykstormsorg/anvil` — published
with [SLSA build provenance](https://slsa.dev/), which npm verifies on install.
To run this repo (worker + server + examples) from source you need Node 20+ and
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
WEBHOOK_SECRET=whsec_dev REDIS_URL=redis://localhost:6379 \
  pnpm --filter @anvil/server start
```

Send a signed request:

```bash
BODY='{"id":"evt_1","type":"charge.succeeded"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac whsec_dev | awk '{print $2}')"
curl -i -X POST http://localhost:3000/webhooks \
  -H "x-signature: $SIG" \
  -H "content-type: application/json" \
  --data "$BODY"
```

You get back `202 { "jobId": "...", "replayed": false }`. Send the same request
again and `replayed` is `true` with the same `jobId`; the worker still runs the
job once.

## Contracts

These five behaviours have tests. Each is the reason a line of code exists.

- **One job per delivery.** The idempotency key is `sha256(signature + raw
  payload)`. Re-delivering a webhook N times enqueues one job; the server
  returns the original job id with `replayed: true`. A different body under the
  same signature is a different key, so it gets its own job.
- **Constant-time signature check.** `verify(body, sigHeader, secret)` accepts a
  valid `sha256=<hex>` signature and rejects a tampered body or a flipped
  signature byte. It compares with `crypto.timingSafeEqual` and guards the
  length check first so the compare never throws.
- **Fixed retry backoff.** Failed jobs retry on `[1000, 5000, 30000, 300000]`
  ms. After the fourth failure the job moves to `webhooks.dead` carrying
  `failureContext: { attempts, lastError }`.
- **Replay is a separate consumer.** `replayDeadLetter(jobId)` moves a dead job
  back to the main queue and returns `{ replayed: true }`. The replay module
  starts no worker on the main queue, so importing it cannot kick off a retry
  loop.
- **Small SDK surface.** `@ykstormsorg/anvil` exports exactly `createServer`,
  `createWorker`, and `replayDeadLetter`. `createServer({ secret })` returns an
  Express app; `createWorker(handler, opts)` returns `{ start, close }`;
  `replayDeadLetter` is async.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the request flow and the
other docs for the reasoning behind each contract.

## Performance

Signature verification runs on every inbound webhook, and "constant-time"
should mean what it says. Measured over 500k verifications of a ~340-byte
payload:

| Metric | Result |
|---|---|
| Per-verify cost | **~4.2 µs** (~238k verifies/sec) |
| Valid vs same-length **wrong** signature | **0.8% timing delta** |

A sub-1% delta between a valid signature and a same-length forgery is the
evidence behind the constant-time claim — `timingSafeEqual` plus the
length-guard means there is no timing or length oracle for an attacker to grind
against. Reproduce with `node bench/verify.mjs` (Node 24, pure CPU, no Redis).

## Deploy

Two ways to stand up the pipeline (server + worker + Redis). Both are 0.x
scaffolds and provision only what Anvil uses; there is no database.

- **Hetzner Cloud (Terraform):** [infra/terraform/](./infra/terraform/) brings
  up a Redis VM, the webhook server, and a worker pool whose size is set by
  `worker_count`. Hetzner has no managed Redis, so the module runs Redis on a
  VM via cloud-init; the README there explains the trade.
- **Kubernetes (Helm):** [charts/anvil/](./charts/anvil/) deploys the server
  (Deployment + Service + Ingress on `/webhooks`), the worker (replicas =
  `worker.replicas`), and an in-cluster Redis. `REDIS_URL` and the
  `WEBHOOK_SECRET` are wired in for you.

```bash
# Terraform
terraform -chdir=infra/terraform init && terraform -chdir=infra/terraform apply

# Helm
helm install anvil ./charts/anvil --set secret.webhookSecret=whsec_real
```

## Known limitations

This is 0.1. It is honest about what it is not yet.

- The replay path is single-job and manual. There is no batch-replay tool and
  no UI.
- Assumes one Redis and one region. Multi-region delivery and cross-region
  dedupe are out of scope.
- Replay-attack timestamp checking is documented but left to the handler; the
  server does not enforce a timestamp window for you.

## Roadmap

- A `replayDeadLetter` batch mode and a small CLI.
- An optional timestamp-tolerance check in the server middleware.

## License

MIT. See [LICENSE](./LICENSE).
