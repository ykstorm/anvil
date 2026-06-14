/**
 * Example: an Anvil worker that handles Stripe events. Example code, not
 * production config.
 *
 * Run with: REDIS_URL=redis://localhost:6379 \
 *   node --experimental-strip-types examples/stripe/worker.ts
 */
import { createWorker } from "@ykstormsorg/anvil";

const worker = createWorker(
  async (data) => {
    const event = JSON.parse(data.body);

    switch (event.type) {
      case "charge.succeeded":
        console.log("charge succeeded", event.data?.object?.id);
        break;
      case "invoice.payment_failed":
        // Throwing here puts the job on the retry schedule. After the schedule
        // is spent it moves to webhooks.dead with a failureContext.
        throw new Error("payment processor unreachable");
      default:
        console.log("ignoring", event.type);
    }
  },
  { queueName: "webhooks" },
);

await worker.start();
console.log("stripe example worker started");

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
