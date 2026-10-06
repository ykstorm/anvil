# Stripe example

Example code. It shows how to wire the Anvil SDK for a Stripe-style webhook. It
is not a drop-in production integration: real Stripe signatures use a
`Stripe-Signature` header with a timestamp and a `v1=` signature, and you would
adapt that format before handing it to `createServer`. This example uses Anvil's
default `x-signature` header so the focus stays on the pipeline.

## Run it

You need Redis on `localhost:6379`, Node 20+ and pnpm. The example is a
workspace package (`@anvil/example-stripe`) that depends on the SDK in this
repo, so run everything from the repo root:

```bash
docker run -p 6379:6379 redis:7

# install the workspace and build the SDK and the examples to dist/
pnpm install
pnpm -r build

# worker
REDIS_URL=redis://localhost:6379 pnpm --filter @anvil/example-stripe run worker

# server (a public dev secret; createServer needs at least 16 characters)
WEBHOOK_SECRET=whsec_dev_only_not_a_real_secret REDIS_URL=redis://localhost:6379 \
  pnpm --filter @anvil/example-stripe run server
```

After editing `server.ts` or `worker.ts`, rebuild with
`pnpm --filter @anvil/example-stripe build`. CI type-checks both examples.

Send a `charge.succeeded` event and watch the worker log it. Send an
`invoice.payment_failed` event and watch the handler throw, retry on the
backoff schedule, and dead-letter after the fourth failure.

## Files

- `server.ts`, the ingress: verify, dedupe, enqueue, 202.
- `worker.ts`, the handler with a per-event-type switch.
