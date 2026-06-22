# GitHub example

Example code showing how to wire the Anvil SDK for GitHub webhooks. GitHub signs
each delivery with `X-Hub-Signature-256: sha256=<hex>` — exactly the format Anvil
verifies — so, unlike the Stripe example, there is no header adaptation: pass
`signatureHeader: "x-hub-signature-256"` and `createServer` validates it directly.

## Run it

You need Redis on `localhost:6379` and Node 20+.

```bash
docker run -p 6379:6379 redis:7

# build the SDK first
pnpm -r build

# worker
REDIS_URL=redis://localhost:6379 \
  node --experimental-strip-types examples/github/worker.ts

# server
WEBHOOK_SECRET=<your gh webhook secret> REDIS_URL=redis://localhost:6379 \
  node --experimental-strip-types examples/github/server.ts
```

Point a repository's webhook (Settings → Webhooks) at the server with content
type `application/json` and the same secret. Push a commit, open a pull request,
or file an issue — the worker logs each. Re-delivering the same event (GitHub's
"Redeliver" button) is deduped to a single job. A handler that throws moves the
delivery onto Anvil's retry schedule `[1s, 5s, 30s, 5m]`, then to the
`webhooks.dead` queue with a `failureContext`.
