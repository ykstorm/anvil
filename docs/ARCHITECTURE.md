# Architecture

Anvil takes an inbound webhook, checks it is genuine and not a duplicate, hands
it to a background queue, and lets a worker process it with retries. The HTTP
request returns as soon as the job is on the queue, so a slow handler never
makes the sender wait or time out.

```mermaid
sequenceDiagram
    participant P as Provider
    participant S as Server (Express)
    participant Q as BullMQ (Redis)
    participant W as Worker
    participant D as webhooks.dead

    P->>S: POST /webhooks (raw body + signature)
    S->>S: verify HMAC-SHA256 (constant time)
    alt invalid signature
        S-->>P: 401
    else valid
        S->>S: key = sha256(sig + raw body)
        S->>Q: enqueue with jobId = key
        Note over Q: duplicate jobId is a no-op
        S-->>P: 202 { jobId, replayed }
        Q->>W: deliver job
        alt handler succeeds
            W-->>Q: complete
        else handler throws
            W->>Q: retry on backoff [1s, 5s, 30s, 5m]
            W->>D: after 4th failure, move to dead queue
        end
    end
```

The server is the only part that talks to the provider. Its job is small: read
the raw bytes, verify the signature over those exact bytes, compute the
idempotency key, and add one job. Everything slow or failure-prone happens
later, in the worker.

The worker pulls jobs and runs your handler. A thrown error schedules a retry
on a fixed backoff. After the schedule is spent, the job moves to a separate
`webhooks.dead` queue with a `failureContext` recording the attempt count and
the last error message.

Replay is its own process, not part of the worker. The worker never reads the
dead queue, so a handler that always fails cannot loop forever. A person (or a
script they run on purpose) decides when to move a dead job back. See
[IDEMPOTENCY.md](./IDEMPOTENCY.md), [DEAD_LETTER.md](./DEAD_LETTER.md), and
[SECURITY.md](./SECURITY.md) for the details of each step.
