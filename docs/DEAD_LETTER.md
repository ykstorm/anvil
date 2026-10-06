# Dead-letter queue

A job that fails its whole retry schedule lands on the dead-letter queue,
`<queueName>.dead`, which is `webhooks.dead` for the default queue. The worker
and `replayDeadLetter` both derive that name from the main queue name, so pass
the same `queueName` to `createWorker` and `mainQueueName` to replay.

The dead job keeps the original payload and adds a `failureContext`:

```json
{
  "body": "{\"id\":\"evt_123\"}",
  "sig": "sha256=...",
  "receivedAt": "2026-10-05T12:00:00.000Z",
  "failureContext": {
    "attempts": 4,
    "lastError": "downstream returned 500"
  },
  "originalJobId": "<the main-queue job id, the 64-hex idempotency key>"
}
```

`attempts` is how many times the worker ran the handler before giving up;
`lastError` is the message from the final failure. That is usually enough to
tell a transient outage apart from a payload your handler can never accept.

## What reaches the dead queue

BullMQ runs a job at least once, not exactly once. A job whose worker stops
renewing its lock (the process crashed, or blocked the event loop for longer
than BullMQ's 30-second lock) is stalled: BullMQ puts it back on the waiting
list and a worker runs it again. That is a second run of your handler, so the
handler has to be safe to repeat.

Dead-lettering is done by the worker's listener on BullMQ's `failed` event. It
moves a job when BullMQ will not run it again:

- the job failed its fourth attempt;
- the job failed with BullMQ's `UnrecoverableError`. BullMQ raises this itself
  for a job that stalled more than `maxStalledCount` times (default 1, so the
  second stall), failing it the next time a worker picks it up. Such a job
  arrives with fewer than four attempts, and `failureContext.attempts` says how
  many it had. A handler can also throw `UnrecoverableError` to skip the
  remaining retries.

What does not reach it: the move runs inside the worker process. If that
process dies after BullMQ marks the job failed and before the move finishes, or
the add to the dead queue fails (the listener logs `dead-letter handling
failed`), the job stays in the main queue's failed list. BullMQ deletes it from
there once it is older than the dedupe TTL, seven days by default. Check that
list (`queue.getFailed()`) if a delivery seems to have vanished.

Replay is a separate process from the worker, and that is the point. If the
worker drained the dead queue itself, a handler with a real bug would retry,
fail, dead-letter, replay, and fail again in a tight loop, burning Redis and
downstream capacity. Keeping replay out of the worker means a dead job sits
still until a person looks at it. Fix the handler, deploy, then replay. Run it
from the SDK.

`replayDeadLetter` takes the id of the job on the dead queue. BullMQ assigns
that id when the job is dead-lettered, as a counting number ("1", "2", ...); it
is not the provider's event id and not the main-queue id. The SDK has no list
function yet, so find the id with BullMQ (a dependency of the SDK; add it to
your own package.json to import it):

```ts
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
const dead = new Queue("webhooks.dead", { connection });
for (const job of await dead.getJobs(["waiting"])) {
  console.log(job.id, job.data.originalJobId, job.data.failureContext.lastError);
}
await dead.close();
await connection.quit();
```

Then replay one by that id:

```ts
import { replayDeadLetter } from "@ykstormsorg/anvil";

const result = await replayDeadLetter("1", {
  redisUrl: process.env.REDIS_URL,
  // mainQueueName: "orders", if the worker runs with queueName: "orders"
});
console.log(result); // { replayed: true, jobId: "<new main-queue id>" }
// or { replayed: false, jobId: "1" } when there is no dead job with that id
```

Replay re-adds the original payload to the main queue with a fresh retry
counter and removes the copy from the dead queue. The dropped `failureContext`
is intentional: the replayed job is a clean attempt, not a continuation of the
old one. If a job dead-letters again, the new `failureContext` reflects the new
run.
