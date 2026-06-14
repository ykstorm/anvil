# Dead-letter queue

A job that fails its whole retry schedule lands on the `webhooks.dead` queue.
The dead job keeps the original payload and adds a `failureContext`:

```json
{
  "body": "{\"id\":\"evt_123\"}",
  "sig": "sha256=...",
  "failureContext": {
    "attempts": 4,
    "lastError": "downstream returned 500"
  }
}
```

`attempts` is how many times the worker ran the handler before giving up;
`lastError` is the message from the final failure. That is usually enough to
tell a transient outage apart from a payload your handler can never accept.

Replay is a separate process from the worker, and that is the point. If the
worker drained the dead queue itself, a handler with a real bug would retry,
fail, dead-letter, replay, and fail again in a tight loop, burning Redis and
downstream capacity. Keeping replay out of the worker means a dead job sits
still until a person looks at it. Fix the handler, deploy, then replay. Run it
from the SDK:

```ts
import { replayDeadLetter } from "@ykstormsorg/anvil";

const result = await replayDeadLetter("evt_123", {
  redisUrl: process.env.REDIS_URL,
});
console.log(result); // { replayed: true, jobId: "..." }
```

Replay re-adds the original payload to the main queue with a fresh retry
counter and removes the copy from the dead queue. The dropped `failureContext`
is intentional: the replayed job is a clean attempt, not a continuation of the
old one. If a job dead-letters again, the new `failureContext` reflects the new
run.
