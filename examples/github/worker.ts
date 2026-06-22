/**
 * Example: an Anvil worker that handles GitHub events. Example code, not
 * production config.
 *
 * Run with: REDIS_URL=redis://localhost:6379 \
 *   node --experimental-strip-types examples/github/worker.ts
 */
import { createWorker } from "@ykstormsorg/anvil";

const worker = createWorker(
  async (data) => {
    const event = JSON.parse(data.body);

    // GitHub carries the event type in the X-GitHub-Event header; for a
    // self-contained example we infer from the payload shape instead.
    if (event.pusher) {
      console.log("push to", event.ref, "by", event.pusher?.name);
    } else if (event.pull_request) {
      console.log("pull_request", event.action, "#" + event.number);
    } else if (event.issue) {
      console.log("issue", event.action, "#" + event.issue?.number);
    } else {
      // Throwing here puts the job on Anvil's retry schedule, then the
      // dead-letter queue once the schedule is spent.
      console.log("ignoring event", Object.keys(event).slice(0, 4).join(","));
    }
  },
  { queueName: "webhooks" },
);

await worker.start();
console.log("github example worker started");

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
