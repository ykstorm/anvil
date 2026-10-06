# Idempotency

The idempotency key is `sha256(signature_header + raw_payload_bytes)`. On the
first delivery of a key the server claims it atomically with
`SET anvil:dedupe:<key> <token> NX EX <ttl>` on Redis and enqueues one BullMQ
job under that key as the jobId. Every later delivery of the same key finds it
already set and returns `replayed: true` without enqueuing again. Because the
claim is a single atomic operation, two concurrent copies of the same delivery
still produce exactly one job: one wins the `SET NX`, the other sees it is taken.

The claim and the add are two round trips. If the add fails, the server deletes
the key (only if it still holds the token this request wrote) and answers 503,
so the provider's retry claims the key again and enqueues. If Redis is failing
so badly that the delete fails too, the key stays until its TTL runs out and the
server logs `could not release dedupe claim`.

The key expires after the TTL (one week by default), which bounds how much Redis
the dedupe set uses. A re-delivery after the window has passed is treated as new.

## What this does and does not dedupe

The key folds in both the signature header and the raw body, so:

- An exact re-delivery, the same signed request, byte for byte, collapses to one
  job. This is the common provider retry and the case Anvil guarantees.
- Two different payloads never collide, even if a provider happened to reuse a
  signature value, because the body bytes are part of the key.

What it does not cover: a provider that rotates the signature when it re-delivers
the same logical event (some sign a timestamp that changes on retry). A rotated
signature changes the key, so that re-delivery looks new. We hash the raw bytes
rather than a parsed-and-restringified copy, because re-serialization can
reorder keys or change whitespace and would itself produce a different digest
for the same logical payload. Deduping on a provider's stable event id, which
would survive signature rotation, is out of scope for 0.x.
