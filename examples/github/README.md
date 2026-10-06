# GitHub example

Example code showing how to wire the Anvil SDK for GitHub webhooks. GitHub signs
each delivery with `X-Hub-Signature-256: sha256=<hex>`, exactly the format Anvil
verifies, so, unlike the Stripe example, there is no header adaptation: pass
`signatureHeader: "x-hub-signature-256"` and `createServer` validates it directly.

## Run it

You need Redis on `localhost:6379`, Node 20+ and pnpm. The example is a
workspace package (`@anvil/example-github`) that depends on the SDK in this
repo, so run everything from the repo root:

```bash
docker run -p 6379:6379 redis:7

# install the workspace and build the SDK and the examples to dist/
pnpm install
pnpm -r build

# worker
REDIS_URL=redis://localhost:6379 pnpm --filter @anvil/example-github run worker

# server
WEBHOOK_SECRET=<your gh webhook secret> REDIS_URL=redis://localhost:6379 \
  pnpm --filter @anvil/example-github run server
```

After editing `server.ts` or `worker.ts`, rebuild with
`pnpm --filter @anvil/example-github build`. CI type-checks both examples.

Point a repository's webhook (Settings to Webhooks) at the server with content
type `application/json` and the same secret. Push a commit, open a pull request,
or file an issue, the worker logs each. Re-delivering the same event (GitHub's
"Redeliver" button) is deduped to a single job. A handler that throws moves the
delivery onto Anvil's retry schedule (retries after 1s, 5s and 30s), then, after
the fourth failure, to the `webhooks.dead` queue with a `failureContext`.
