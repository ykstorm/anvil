/**
 * Example: a GitHub webhook ingress built on Anvil. Example code, not
 * production config.
 *
 * GitHub signs every delivery with `X-Hub-Signature-256: sha256=<hex>` — exactly
 * the format Anvil's `verify` expects, so this wires up with no header
 * adaptation (unlike the Stripe example, whose `t=,v1=` header needs
 * reformatting first). Just point `signatureHeader` at it.
 *
 * Run with: WEBHOOK_SECRET=<gh webhook secret> REDIS_URL=redis://localhost:6379 \
 *   node --experimental-strip-types examples/github/server.ts
 */
import { createServer } from "@ykstormsorg/anvil";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  throw new Error("set WEBHOOK_SECRET to your GitHub webhook secret");
}

const app = createServer({
  secret,
  queueName: "webhooks",
  signatureHeader: "x-hub-signature-256",
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`github example server on :${port}`);
});
