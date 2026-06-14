import type { Queue } from "bullmq";

export interface WebhookJobData {
  body: string;
  sig: string;
}

export interface EnqueueResult {
  jobId: string;
  /** true when this delivery matched an already-enqueued idempotency key. */
  replayed: boolean;
}

/**
 * Enqueue a webhook job keyed by its idempotency key.
 *
 * The idempotency key is used as the BullMQ jobId. BullMQ treats a duplicate
 * jobId as a no-op add (it returns the existing job and creates nothing), so
 * N re-deliveries of the same key yield exactly one job. We check for the
 * existing job first to report `replayed` honestly and to return the original
 * job's id.
 */
export async function enqueueWebhook(
  queue: Queue,
  idempotencyKey: string,
  data: WebhookJobData,
): Promise<EnqueueResult> {
  const existing = await queue.getJob(idempotencyKey);
  if (existing) {
    return { jobId: existing.id!, replayed: true };
  }

  const job = await queue.add("webhook", data, {
    jobId: idempotencyKey,
    removeOnComplete: false,
    removeOnFail: false,
  });

  // A race can still let two concurrent adds resolve; BullMQ keeps only the
  // first under the shared jobId, so the returned id is the canonical one.
  return { jobId: job.id ?? idempotencyKey, replayed: false };
}
