# Idempotency

The idempotency key is `sha256(signature_header + raw_payload_bytes)`. That key
becomes the BullMQ `jobId`. BullMQ treats a second add with an existing jobId as
a no-op, so re-delivering the same webhook ten times still produces one job. The
server reports `replayed: true` and returns the original job's id for every
delivery after the first.

It would be simpler to key on the signature header alone, but that breaks in
practice. Some providers rotate the signature when they re-deliver the same
logical event: the signature often covers a timestamp, and a retried delivery
carries a fresh timestamp, so the header changes even though the body did not.
Key on the signature alone and those re-deliveries look like new events, so you
process the same payload twice. Putting the raw payload bytes in the key fixes
both directions: the same body collapses to one key regardless of signature
churn, and two different bodies never collide even when a provider happens to
reuse a signature value. We hash the raw bytes, not a parsed-and-restringified
copy, because re-serialization can reorder keys or change whitespace and would
produce a different digest for the same logical payload.
