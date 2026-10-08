# Changelog

All notable changes to `@ykstormsorg/anvil`. Dates are UTC; 0.1.0 and 0.1.1 are
the days npm published them. Anvil is 0.x, so a minor version can break things;
items that can break an existing install are marked Breaking.

## 0.2.1 - 2026-10-08

Docs only. The text that ships with the package was made plain: the README no
longer uses bold markers. It also now says that `rateLimit` is off unless you
set it, and what to do about that on a public deployment. Nothing in the code
changed.

## 0.2.0 - 2026-10-07

Everything below is relative to 0.1.1.

### Changed behaviour

- Breaking: `verify` accepts only `sha256=` followed by exactly 64 hex digits.
  Before, any run of hex digits passed the shape check and a trailing odd digit
  was silently dropped when decoding, so a 65-character value could verify.
  Upper-case hex is still accepted. An empty secret now returns `false`.
- Breaking: `createServer` throws if `secret` is shorter than 16 characters.
  A short secret can be guessed offline from one captured signed request.
- The idempotency key is `sha256("sha256=" + canonical signature hex + raw body)`,
  where the signature is first reduced to 64 lower-case hex digits. Keys for the
  lower-case signatures providers send are the same as before. The internal
  `computeIdempotencyKey` now throws on a header `verify` would reject.
- Dedupe is one atomic `SET anvil:dedupe:<key> <token> NX EX <ttl>`. The first
  delivery claims the key and enqueues; later ones return `replayed: true`
  without touching the queue.
- Breaking: dedupe has a window. `dedupeTtlSeconds` defaults to one week.
  Before, a key was remembered for as long as its job stayed in Redis, which was
  forever because jobs were never trimmed. Completed and failed jobs are now
  removed after the same window, and a re-delivery after it is treated as new.
- If the add fails after the key was claimed, the claim is released (a
  compare-and-delete on the claim's own token), so the provider's retry is not
  answered `replayed: true` with nothing queued.
- `POST /webhooks` answers `503` when the queue cannot take the job (Redis down,
  not ready, or a command timed out). Before, the rejection went unhandled and
  could take the process down.
- Redis commands on the server fail at once while disconnected instead of
  queueing (`enableOfflineQueue: false`), with 5 s connect and command timeouts.
  A server started before Redis is reachable builds its queue only once the
  connection is ready, so it recovers on its own.
- `GET /readyz` is new: `200` only when the queue is usable and Redis answers a
  `PING` within one second, `503` otherwise. `/healthz` is unchanged (liveness).
- Breaking: a custom `queueName` dead-letters to `<queueName>.dead`. Before,
  the worker always wrote to `webhooks.dead` while `replayDeadLetter` read
  `<queueName>.dead`, so a replay could not find the job. Anything reading
  `webhooks.dead` for a custom queue must read the new name. The default queue
  is unaffected.
- Jobs BullMQ fails as unrecoverable are dead-lettered too: a job that stalled
  more than `maxStalledCount` times, or a handler that throws `UnrecoverableError`.
  Before, only jobs that used all four attempts reached the dead queue.
- Dead-lettering also removes the main-queue copy. The stored `lastError` is cut
  to 2048 characters and has `key`, `token`, `secret` and `sig` query values
  redacted. `replayDeadLetter` drops `originalJobId` along with `failureContext`,
  so a replayed job is a clean first attempt.
- The retry schedule is documented and exported as 1 s, 5 s, 30 s, then
  dead-letter after the fourth failure. Job timing is unchanged: 0.1.1
  listed a 5 minute step, but four attempts have only three waits, so that step
  was never reached. Breaking only for code importing the unstable
  `./internal/*` subpath: `BACKOFF_MS` has three entries and `backoffStrategy`
  is gone (use `backoffDelay`). `MAX_ATTEMPTS` is still 4.
- Breaking for TypeScript users: `WebhookJobData` has a required `receivedAt`
  (ISO timestamp the server stamped on acceptance), which the handler receives
  next to `body` and `sig`. Jobs already in Redis from 0.1.1 lack it.
- Requests are bounded: `maxBodyBytes` (default `256kb`, oversized gets `413`),
  `maxInFlight` (default 1000, excess gets `429`), and an optional per-IP
  `rateLimit`. Bodies are not inflated, so a gzip-encoded request is rejected
  with `400` before verification.
- Deploy, not in the npm package. Helm: `image.repository` and
  `secret.webhookSecret` have no default and the chart refuses the
  `whsec_changeme` placeholder; an optional Redis password turns on
  `requirepass`, and a NetworkPolicy limits Redis to the server and worker pods.
  Terraform: `WEBHOOK_SECRET` is no longer written into cloud-init user data
  (provision it after boot), and `ssh_allowed_cidrs` defaults to `[]`, which
  creates no SSH rule.

### Fixed

- Dedupe bypass: one captured signed request could be queued up to three times
  by resending it with upper-case hex or one extra trailing hex digit, because
  `verify` accepted both and the key hashed the header text as received.
- An error thrown while dead-lettering no longer becomes an unhandled rejection
  inside the worker's `failed` listener; it is logged and the worker carries on.
- Oversized or malformed requests no longer get Express's default error page,
  which includes a stack trace outside production; they get fixed JSON bodies
  (`413`, `400`, or `500`).
- Production `pnpm audit` is clean again: patched `proxy-addr`, `qs` and
  `body-parser` are pinned in the workspace root. The published package's
  dependency ranges are unchanged.

### Docs

- The retry schedule is described as 1 s, 5 s, 30 s everywhere (README, SDK
  README, architecture notes, claim audit, GitHub example).
- The webhook flow in `docs/ARCHITECTURE.md` is numbered steps checked against
  the code, and credits dedupe to the `SET NX` claim, not to BullMQ ignoring a
  repeated job id.
- The unmeasured throughput figure is gone from the README; `bench/` holds a
  working benchmark that says what it does and does not measure. The SLSA note
  now says npm does not verify provenance on install: run `npm audit signatures`.
- The idempotency and dead-letter docs are rewritten to match the code,
  including what the key does not dedupe and that a worker started before Redis
  is reachable may need a restart.
- Examples are workspace packages that run on Node 20 and are type-checked in CI.
- The npm README now carries the five contracts and every `createServer` option.

## 0.1.1 - 2026-06-23

- Shared crypto, idempotency, enqueue, retry and dead-letter code moved into the
  SDK's `internal` modules, with the server and worker apps using them.
- Added `examples/stripe` and `examples/github`, a real lint setup and a claim
  audit.

## 0.1.0 - 2026-06-15

- First npm release: `createServer`, `createWorker` and `replayDeadLetter`,
  published with provenance.
