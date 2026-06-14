/**
 * Example: a Stripe webhook ingress built on Anvil. This is example code, not
 * production config. It shows the wiring; adapt secrets and the route to your
 * setup.
 *
 * Run with: WEBHOOK_SECRET=whsec_... REDIS_URL=redis://localhost:6379 \
 *   node --experimental-strip-types examples/stripe/server.ts
 */
import { createServer } from "@ykstormsorg/anvil";

const secret = process.env.WEBHOOK_SECRET;
if (!secret) {
  throw new Error("set WEBHOOK_SECRET to your Stripe signing secret");
}

// Stripe sends its signature in the `Stripe-Signature` header. Anvil expects a
// `sha256=<hex>` value; in a real integration you would adapt Stripe's header
// format (it carries a timestamp and v1 signature) before handing it over. For
// this example we use Anvil's default `x-signature` header to keep the focus on
// the pipeline rather than Stripe's header parsing.
const app = createServer({
  secret,
  queueName: "webhooks",
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`stripe example server on :${port}`);
});
