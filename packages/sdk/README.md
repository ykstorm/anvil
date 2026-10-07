# @ykstormsorg/anvil

[![npm](https://img.shields.io/npm/v/@ykstormsorg/anvil?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ykstormsorg/anvil)
[![CI](https://github.com/ykstorm/anvil/actions/workflows/ci.yml/badge.svg)](https://github.com/ykstorm/anvil/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@ykstormsorg/anvil?color=blue)](https://github.com/ykstorm/anvil/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ykstormsorg/anvil)](https://nodejs.org)

Idempotent webhook to BullMQ worker pipeline. The piece between a provider's
webhook and your business logic: verify the signature, drop duplicates, enqueue
one job, return `202` fast. A worker runs the job in the background on a fixed
retry schedule, and a dead-letter queue holds whatever never succeeds.

Re-delivery is a real failure mode, Stripe re-sends, GitHub re-sends, your
worker crashes mid-job. Most examples cover one step. Anvil covers the chain:
verify to dedupe to enqueue to retry to dead-letter to replay.

## Install

```bash
npm install @ykstormsorg/anvil
# needs a Redis instance (BullMQ runs on it)
```

## Quick start

```ts
import { createServer, createWorker } from "@ykstormsorg/anvil";

// 1. Webhook ingress, verifies HMAC over the raw body, dedupes, enqueues, 202s.
const app = createServer({
  secret: process.env.WEBHOOK_SECRET!,
  redisUrl: process.env.REDIS_URL,      // default redis://localhost:6379
  signatureHeader: "x-signature",       // "sha256=<hex>"
});
app.listen(3000);

// 2. Worker, runs your handler, retries after 1s, 5s and 30s, then dead-letters.
const worker = createWorker(async ({ body }) => {
  const event = JSON.parse(body);
  await doTheWork(event);               // throw to trigger a retry
}, { concurrency: 8 });
await worker.start();
```

## The five contracts

Each of these has a test, and each is the reason a line of code exists.

- One job per delivery. The idempotency key is `sha256(signature + raw
  body)`, where the signature is first reduced to one canonical form
  (`sha256=` and 64 lower-case hex digits), so different spellings of one valid
  signature cannot make different keys. The first delivery claims the key with
  an atomic
  `SET key <token> NX EX <ttl>` and enqueues one job; later deliveries of the
  same key find it already set and return `replayed: true` without enqueuing
  again. Two concurrent copies of the same delivery still yield exactly one job.
  If adding the job fails after the claim, the claim is released and the server
  answers 503, so the provider's retry is treated as new. The key expires after
  the dedupe TTL (one week by default), which bounds the memory.
- Constant-time signature check. `verify(body, sigHeader, secret)` recomputes
  the HMAC-SHA256 over the raw bytes and compares with `crypto.timingSafeEqual`
  after a length check, so the compare never throws and leaks no length oracle.
  An empty secret, a malformed header, or a digest that is not exactly 64 hex
  digits is a plain `false`.
- Fixed retry backoff. A failing handler retries after 1s, 5s and 30s;
  after the fourth failure the job moves to the dead-letter queue,
  `<queueName>.dead` (`webhooks.dead` by default), with
  `failureContext: { attempts, lastError }`, where
  `lastError` is truncated and has credential-looking query params redacted.
- Replay is a separate consumer. `replayDeadLetter(jobId)` moves a dead job
  back to the main queue with a fresh retry schedule and returns
  `{ replayed: true }`. The replay path starts no worker on the main queue, so
  importing it cannot kick off a retry loop.
- Small SDK surface. `@ykstormsorg/anvil` exports exactly `createServer`,
  `createWorker`, and `replayDeadLetter`.

A provider that rotates the signature on re-delivery produces a different key,
so that case is not deduped; see the
[idempotency notes](https://github.com/ykstorm/anvil/blob/main/docs/IDEMPOTENCY.md).

## API

### `createServer(options) to Express app`
Verifies the `sha256=<hex>` HMAC over the raw request body with a
constant-time compare, computes the idempotency key, enqueues to BullMQ, and
returns `202`. A duplicate returns the original job's id without enqueuing again.
It answers `401` for a bad signature, `413` for an oversized body, `429` when
shedding load, and `503` when the queue cannot take the job. It also serves
`/healthz` (liveness) and `/readyz` (`200` once Redis answers a `PING`, `503`
until then).

| option | default | meaning |
| --- | --- | --- |
| `secret` |, (required) | HMAC secret, at least 16 characters |
| `redisUrl` | `REDIS_URL`, else `redis://localhost:6379` | BullMQ connection |
| `queueName` | `webhooks` | main queue |
| `signatureHeader` | `x-signature` | header holding `sha256=<hex>` |
| `maxBodyBytes` | `256kb` | largest accepted body, `413` above it |
| `maxInFlight` | `1000` | requests handled at once, `429` above it |
| `dedupeTtlSeconds` | one week | how long a seen delivery is remembered |
| `rateLimit` | off | `{ windowMs, max }` per-IP fixed window |

### `createWorker(handler, options?) to { start, close }`
Runs `handler({ body, sig, receivedAt }, job)`. On a thrown error it retries after 1s, 5s
and 30s; after the 4th failure the job moves to the dead-letter queue,
`<queueName>.dead` (`webhooks.dead` by default), with its failure context. The dead queue is written but never
consumed here, replay is a separate process so a bad job can't drive a retry storm.

### `replayDeadLetter(jobId, options?) to { replayed, jobId }`
Moves one dead-lettered job back onto the main queue. Run it from a CLI or a
gated admin path, not inside the worker.

## Known limitations

- You map the provider signature header yourself (`signatureHeader`); there is no per-provider preset yet.
- The secret must be at least 16 characters; `createServer` throws on a shorter one.
- Replay is one job at a time, no batch mode.
- BullMQ and Redis are the only backend.
- The HMAC covers the body only, so a captured signed request can be replayed; enforce a timestamp window in your handler if your provider signs one.
- Jobs run at least once: a crashed or stalled job runs again, so make the handler safe to repeat.
- A worker started before Redis is reachable may process nothing until it is restarted; start workers after Redis.
- Raw-body access is required: do not `express.json()` before Anvil verify, or the HMAC will not match.
- The `./internal/*` subpath is exported and importable, but it is unstable and not public API; use the three top-level functions.

## Links

- Source, Terraform module, and Helm chart: [github.com/ykstorm/anvil](https://github.com/ykstorm/anvil)
- Runnable example: [`examples/stripe`](https://github.com/ykstorm/anvil/tree/main/examples/stripe)

MIT © Lakshyaraj Singh Rao
