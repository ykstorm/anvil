# @ykstormsorg/anvil

[![npm](https://img.shields.io/npm/v/@ykstormsorg/anvil?color=cb3837&logo=npm)](https://www.npmjs.com/package/@ykstormsorg/anvil)
[![CI](https://github.com/ykstorm/anvil/actions/workflows/ci.yml/badge.svg)](https://github.com/ykstorm/anvil/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@ykstormsorg/anvil?color=blue)](https://github.com/ykstorm/anvil/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@ykstormsorg/anvil)](https://nodejs.org)

Idempotent webhook → BullMQ worker pipeline. The piece between a provider's
webhook and your business logic: verify the signature, drop duplicates, enqueue
one job, return `202` fast. A worker runs the job in the background on a fixed
retry schedule, and a dead-letter queue holds whatever never succeeds.

Re-delivery is a real failure mode — Stripe re-sends, GitHub re-sends, your
worker crashes mid-job. Most examples cover one step. Anvil covers the chain:
verify → dedupe → enqueue → retry → dead-letter → replay.

## Install

```bash
npm install @ykstormsorg/anvil
# needs a Redis instance (BullMQ runs on it)
```

## Quick start

```ts
import { createServer, createWorker } from "@ykstormsorg/anvil";

// 1. Webhook ingress — verifies HMAC over the raw body, dedupes, enqueues, 202s.
const app = createServer({
  secret: process.env.WEBHOOK_SECRET!,
  redisUrl: process.env.REDIS_URL,      // default redis://localhost:6379
  signatureHeader: "x-signature",       // "sha256=<hex>"
});
app.listen(3000);

// 2. Worker — runs your handler, retries on [1s, 5s, 30s, 5m], then dead-letters.
const worker = createWorker(async ({ body }) => {
  const event = JSON.parse(body);
  await doTheWork(event);               // throw to trigger a retry
}, { concurrency: 8 });
await worker.start();
```

A re-delivered webhook (same signature + body) enqueues **exactly one** job,
ever. The idempotency key is `sha256(signatureHeader + rawBody)`, so a provider
that rotates signatures on re-delivery still dedupes on the payload.

## API

### `createServer(options) → Express app`
Verifies the `sha256=<hex>` HMAC over the **raw** request body with a
constant-time compare, computes the idempotency key, enqueues to BullMQ, and
returns `202`. A duplicate returns the original job's id without enqueuing again.

| option | default | meaning |
| --- | --- | --- |
| `secret` | — (required) | HMAC secret |
| `redisUrl` | `redis://localhost:6379` | BullMQ connection |
| `queueName` | `webhooks` | main queue |
| `signatureHeader` | `x-signature` | header holding `sha256=<hex>` |

### `createWorker(handler, options?) → { start, close }`
Runs `handler({ body, sig }, job)`. On a thrown error it retries on the backoff
schedule `[1s, 5s, 30s, 5m]`; after the 4th failure the job moves to
`webhooks.dead` with its failure context. The dead queue is written but never
consumed here — replay is a separate process so a bad job can't drive a retry storm.

### `replayDeadLetter(jobId, options?) → { replayed, jobId }`
Moves one dead-lettered job back onto the main queue. Run it from a CLI or a
gated admin path, not inside the worker.

## Known limitations

- You map the provider's signature header yourself (`signatureHeader`); there's no per-provider preset yet.
- Replay is one job at a time — no batch mode.
- BullMQ + Redis is the only backend.
- Raw-body access is required: do not `express.json()` before Anvil's verify, or the HMAC won't match.

## Links

- Source, Terraform module, and Helm chart: [github.com/ykstorm/anvil](https://github.com/ykstorm/anvil)
- Runnable example: [`examples/stripe`](https://github.com/ykstorm/anvil/tree/main/examples/stripe)

MIT © Lakshyaraj Singh Rao
