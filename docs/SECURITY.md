# Security

Anvil verifies every webhook with HMAC-SHA256 before doing anything else. The
provider shares a secret with you and signs each request; the signature arrives
in a header as `sha256=<hex>`. The server recomputes the HMAC over the request
body using the same secret and compares it to the header value. A request whose
signature does not match gets a 401 and is never enqueued.

The compare uses `crypto.timingSafeEqual`, not `===`. A normal string compare
returns as soon as it finds a differing byte, so the time it takes leaks how
many leading bytes were correct. An attacker can use that timing to guess a
valid signature byte by byte. `timingSafeEqual` always reads both buffers fully,
so the comparison takes the same time whether the first byte differs or the
last. Before calling it we check that the two digests are the same length:
`timingSafeEqual` throws on length-mismatched buffers, and a thrown error would
both crash the request and leak length information. A length mismatch is a plain
`false`.

Verify over the raw bytes, never a parsed copy. The middleware reads the body
with `express.raw`, not `express.json`, on purpose. The signature covers the
exact bytes the provider sent; if you `JSON.parse` and re-serialize first, key
order and whitespace can change, the recomputed HMAC no longer matches, and
valid webhooks start failing. Parse the body only after verification passes, in
the worker.

Signature verification proves the body is genuine, but a captured-and-resent
request still carries a valid signature. Most providers include a timestamp in
the signed material to bound this; check it and reject requests outside a small
tolerance (five minutes is a common window) so an old capture cannot be replayed
indefinitely. Anvil's idempotency key gives a second layer here: a byte-for-byte
resend collapses onto the same job and is processed once, not again. Keep the
shared secret out of source control and rotate it if it is ever exposed.
