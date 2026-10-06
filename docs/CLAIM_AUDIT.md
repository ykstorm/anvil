# Claim audit

Every public claim about anvil mapped to the code that backs it and the test
that proves it. Unit and design-contract tests run on every push; the
Redis-backed integration assertions run in CI against a `redis:7` service.

| Claim | Backed by | Proven by |
|---|---|---|
| Constant-time HMAC-SHA256 verify (no length oracle, empty secret rejected, exactly 64 hex digits) | `packages/sdk/src/internal/verify.ts`, `crypto.timingSafeEqual` with a length guard, no `===` | `packages/sdk/test/verify.test.ts` + `verify.spy.test.ts` |
| Idempotency key `sha256(canonical signature + raw body)`, one key per accepted spelling | `packages/sdk/src/internal/idempotency.ts` | `packages/sdk/test/idempotency.test.ts` |
| Atomic dedupe: one job per key, even under concurrency | `packages/sdk/src/internal/enqueue.ts`, `SET key <token> NX EX <ttl>` on the queue's Redis client | `packages/sdk/test/idempotency.test.ts` (incl. a 20-way concurrent case, Redis-gated) |
| A failed add releases the claim, so the provider's retry enqueues | `packages/sdk/src/internal/enqueue.ts`, compare-and-delete of the claim token before rethrowing | `packages/sdk/test/enqueue.test.ts` (stub) + `idempotency.test.ts` (Redis-gated) |
| One source of truth for the builders (apps are thin CLIs, no copy-paste) | `apps/server/src/index.ts` and `apps/worker/src/index.ts` import `createServer` / `createWorker` from `@ykstormsorg/anvil` | typecheck + `apps/*/test` |
| Retry backoff `[1s, 5s, 30s]`: three waits, four attempts, then dead-letter | `packages/sdk/src/internal/retry.ts`, `BACKOFF_MS` and `MAX_ATTEMPTS`, wired as the BullMQ `backoffStrategy` and the job `attempts` | `packages/sdk/test/retry.test.ts` |
| Dead-letter + replay via a separate consumer (a broken handler can't loop); error redacted + truncated; main copy removed | `packages/sdk/src/internal/deadLetter.ts` + `replayDeadLetter` (starts no `Worker`) | `packages/sdk/test/deadLetter.test.ts` |
| A replayed job still follows the backoff schedule + re-dead-letters | replay re-adds with the schedule | `packages/sdk/test/replay-schedule.test.ts` (Redis-gated) |
| The worker dead-letters to `<queueName>.dead`, the queue replay reads, including jobs BullMQ fails as unrecoverable (stalled past `maxStalledCount`) | `packages/sdk/src/createWorker.ts`, `deadQueueName()` in `packages/sdk/src/internal/defaults.ts` | `packages/sdk/test/createWorker.test.ts` (stubbed BullMQ) + `worker.e2e.test.ts` (Redis-gated) |
| HTTP ingress: 202 + jobId, duplicate `replayed: true`, 401 on bad/missing signature, 413 over limit, 503 on enqueue failure | `packages/sdk/src/createServer.ts` | `packages/sdk/test/createServer.test.ts` + `createServer.enqueueFail.test.ts` |
| Small SDK surface, exactly `createServer`, `createWorker`, `replayDeadLetter` | `packages/sdk/src/index.ts` | `packages/sdk/test/sdk.test.ts` |
| Ships a Terraform module | `infra/terraform/*.tf` | `terraform validate` + `fmt` (infra.yml) |
| Ships a Helm chart | `charts/anvil/` | `helm lint` + `helm template \| kubeconform` (infra.yml) |
| Publishes `@ykstormsorg/anvil` with build provenance | tag-gated publish job (`pnpm publish --provenance`) | `.github/workflows/ci.yml` `publish` job. npm does not verify provenance on install; run `npm audit signatures` to check it |
| Stripe + GitHub webhook examples | `examples/stripe/*`, `examples/github/*` | typecheck; GitHub's `x-hub-signature-256` is Anvil's native `sha256=<hex>` format |
| Lint is enforced (not a no-op) | ESLint flat config + `lint` scripts per package | `.github/workflows/ci.yml` runs `pnpm -r lint` on node 20 + 22 |
