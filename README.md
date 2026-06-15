# Anvil

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

You need Node 20+ and a Redis instance. Local Redis in one line:

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

- Not published to npm. Install from source for now.
- Only the Stripe example is written. A GitHub example is planned but not built.
- The replay path is single-job and manual. There is no batch-replay tool and
  no UI.
- Assumes one Redis and one region. Multi-region delivery and cross-region
  dedupe are out of scope.
- Replay-attack timestamp checking is documented but left to the handler; the
  server does not enforce a timestamp window for you.

## Roadmap

- A `replayDeadLetter` batch mode and a small CLI.
- The GitHub webhook example.
- An optional timestamp-tolerance check in the server middleware.
- Publish `@ykstormsorg/anvil` to npm once the surface settles.

## License

MIT. See [LICENSE](./LICENSE).
