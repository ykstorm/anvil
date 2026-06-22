# Claim audit

Every public claim about anvil mapped to the code that backs it and the test
that proves it. Unit + design-contract tests run on every push; the
Redis-backed integration assertions run in CI against a `redis:7` service.

| Claim | Backed by | Proven by |
|---|---|---|
| Constant-time HMAC-SHA256 verify (no length oracle) | `packages/sdk/src/internal/verify.ts` — `crypto.timingSafeEqual` with a length guard, no `===` | `apps/server/test/verify.test.ts` + `verify.spy.test.ts` |
| Dedupe by `sha256(signature + payload)` | `packages/sdk/src/internal/idempotency.ts` — used as the BullMQ jobId | `apps/server/test/idempotency.test.ts` |
| One source of truth for the signature path (no copy-paste) | `packages/sdk/src/createServer.ts` imports `verify` / `computeIdempotencyKey` / `enqueueWebhook` from `./internal/*`; apps import the same | typecheck + the verify/idempotency suites |
| Retry backoff `[1s, 5s, 30s, 5m]` | `apps/worker/src/retry.ts` — `BACKOFF_MS`, wired as the BullMQ `backoffStrategy` | `apps/worker/test/retry.test.ts` |
| Dead-letter + replay via a separate consumer (a broken handler can't loop) | `apps/worker/src/dead-letter.ts` + `replayDeadLetter` (starts no `Worker`) | `apps/worker/test/dead-letter.test.ts` |
| A replayed job still follows the backoff schedule + re-dead-letters | replay re-adds with the schedule | `apps/worker/test/replay-schedule.test.ts` (Redis-gated) |
| Small SDK surface — exactly `createServer`, `createWorker`, `replayDeadLetter` | `packages/sdk/src/index.ts` | `packages/sdk/test/sdk.test.ts` |
| Ships a Terraform module | `infra/terraform/*.tf` | `terraform validate` (infra.yml) |
| Ships a Helm chart | `charts/anvil/` | `helm lint` + `helm template \| kubeconform` (infra.yml) |
| Published `@ykstormsorg/anvil` v0.1.0 with SLSA build provenance | npm; tag-gated publish job | `.github/workflows/ci.yml` `publish` job (`pnpm publish --provenance`) |
| Stripe + GitHub webhook examples | `examples/stripe/*`, `examples/github/*` | typecheck; GitHub's `x-hub-signature-256` is Anvil's native `sha256=<hex>` format |
| Lint is enforced (not a no-op) | ESLint flat config + `lint` scripts per package | `.github/workflows/ci.yml` runs `pnpm -r lint` on node 20 + 22 |
