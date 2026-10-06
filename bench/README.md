# Benchmarks

Two micro-benchmarks. Both are pure-Node, no Redis, and import the SDK's
real internals from `packages/sdk/dist`, build first with
`pnpm --filter @ykstormsorg/anvil build`.

## `verify.mjs`, constant-time signature check

Times `verify()` over 500k iterations of a ~340-byte payload, comparing a
valid signature against a same-length wrong signature. A small timing delta is
the evidence behind the constant-time claim (no timing/length oracle).

```bash
node bench/verify.mjs
```

## `throughput.mjs`, webhook ingress throughput

Drives Anvil's ingress path, `verify` then `computeIdempotencyKey` then
`enqueueWebhook`, under HTTP load with [autocannon]. The BullMQ queue is
replaced by an in-memory mock: `enqueueWebhook` claims the key with `SET NX EX`
on `queue.client` and then calls `queue.add`, and the mock answers both from
`Map`s, so the dedupe decision runs as in production while Redis is left out of
the measurement. It measures Anvil's own cost per request, not Redis'.

The request set is `BENCH_UNIQUE` distinct signed payloads plus a ~5% tampered
slice. autocannon cycles the set, so repeats of a body collapse to one queued
job (`replayed: true`), the reported **dedupe rate**, and the tampered slice
drives the **401 reject rate**.

```bash
node bench/throughput.mjs
# tunables (defaults): BENCH_DURATION=10 BENCH_CONNECTIONS=50 BENCH_UNIQUE=200
```

Writes `report-latest.md` (human) and `report-latest.json` (machine), each
with the date, the machine and the Node version. Those files are not committed:
a number only means something next to the run that produced it. If a result is
ever quoted in the README, commit the report it came from alongside it.

**What it does not measure:** retry rate and dead-letter rate are worker-side
outcomes. An ingress throughput bench runs no worker, so those are reported as
`n/a` rather than fabricated. See `apps/worker` and `docs/DEAD_LETTER.md`.

[autocannon]: https://github.com/mcollina/autocannon
