# Stripe example

Example code. It shows how to wire the Anvil SDK for a Stripe-style webhook. It
is not a drop-in production integration: real Stripe signatures use a
`Stripe-Signature` header with a timestamp and a `v1=` signature, and you would
adapt that format before handing it to `createServer`. This example uses Anvil's
default `x-signature` header so the focus stays on the pipeline.

## Run it

You need Redis on `localhost:6379` and Node 20+.

```bash
docker run -p 6379:6379 redis:7

# build the SDK first
pnpm -r build

# worker
REDIS_URL=redis://localhost:6379 \
  node --experimental-strip-types examples/stripe/worker.ts

# server
WEBHOOK_SECRET=whsec_dev REDIS_URL=redis://localhost:6379 \
  node --experimental-strip-types examples/stripe/server.ts
```

Send a `charge.succeeded` event and watch the worker log it. Send an
`invoice.payment_failed` event and watch the handler throw, retry on the
backoff schedule, and dead-letter after the fourth failure.

## Files

- `server.ts` — the ingress: verify, dedupe, enqueue, 202.
- `worker.ts` — the handler with a per-event-type switch.
