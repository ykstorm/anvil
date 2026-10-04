import type { WebhookHandler } from "@ykstormsorg/anvil";

/**
 * Default handler: parse the JSON body and log it. Replace this with your own
 * business logic via createWorker(handler). Throwing triggers the retry
 * schedule; returning normally marks the job complete.
 */
export const defaultHandler: WebhookHandler = async (data) => {
  let event: { id?: unknown };
  try {
    event = JSON.parse(data.body);
  } catch {
    // A body that is not JSON is a permanent failure, not a transient one.
    // Throw so it retries and then dead-letters rather than crashing the worker.
    throw new Error("webhook body is not valid JSON");
  }
  console.log("processed webhook", event.id ?? "(no id)");
};
