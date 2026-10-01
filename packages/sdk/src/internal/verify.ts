import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify an HMAC-SHA256 webhook signature in constant time.
 *
 * The header has the shape `sha256=<hex>`. We recompute the digest over the raw
 * body bytes with the shared secret and compare with crypto.timingSafeEqual
 * after a length check. The length guard matters twice over: timingSafeEqual
 * throws on unequal-length buffers, which would both crash the request and leak
 * a length oracle, so a mismatch returns false up front.
 *
 * Pass the raw body exactly as received. Do not JSON.parse and re-stringify
 * first, that changes the bytes and breaks the signature. See docs/SECURITY.md.
 */
export function verify(
  body: string | Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  // An empty secret can never produce a trustworthy HMAC; reject outright.
  if (!secret) {
    return false;
  }

  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]+$/i.test(provided)) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  const providedBuf = Buffer.from(provided, "hex");
  const expectedBuf = Buffer.from(expected, "hex");

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
