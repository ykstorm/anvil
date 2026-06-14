import type { Job } from "bullmq";

export interface WebhookJobData {
  body: string;
  sig: string;
}

export type WebhookHandler = (data: WebhookJobData, job: Job) => Promise<void>;

/**
 * Default handler: parse the JSON body and log it. Replace this with your own
 * business logic via createWorker(handler). Throwing here triggers the retry
 * schedule; returning normally marks the job complete.
 */
export const defaultHandler: WebhookHandler = async (data) => {
  const event = JSON.parse(data.body);
  console.log("processed webhook", event.id ?? "(no id)");
};
