import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { RETRY_JOB_OPTIONS } from "./retry.js";

export interface WebhookJobData {
  body: string;
  sig: string;
  /** ISO timestamp stamped by the server when the delivery was accepted. */
  receivedAt: string;
}

export interface EnqueueResult {
  jobId: string;
  /** true when this delivery matched an already-seen idempotency key. */
  replayed: boolean;
}

/** Dedupe window: how long a seen idempotency key suppresses re-enqueues. */
export const DEDUPE_TTL_SECONDS = 604800;

const DEDUPE_KEY_PREFIX = "anvil:dedupe:";

export interface EnqueueOptions {
  dedupeTtlSeconds?: number;
}

/**
 * Enqueue a webhook job keyed by its idempotency key, deduped atomically.
 *
 * The dedupe decision is a single `SET anvil:dedupe:<key> 1 NX EX <ttl>` on the
 * queue's own Redis connection. The first delivery of a key claims it and
 * enqueues the job under that key as the jobId; every later delivery finds the
 * key already set and returns replayed without touching the queue. One round
 * trip, and no getJob-then-add gap for two concurrent deliveries to both pass.
 *
 * The TTL bounds the dedupe memory: a key expires after dedupeTtlSeconds, so a
 * re-delivery past that window is treated as new. Completed and failed jobs are
 * trimmed on the same age so the queue does not grow without bound.
 */
export async function enqueueWebhook(
  queue: Queue,
  idempotencyKey: string,
  data: WebhookJobData,
  opts: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const ttlSeconds = opts.dedupeTtlSeconds ?? DEDUPE_TTL_SECONDS;
  // queue.client is typed as BullMQ's minimal client; it is a full ioredis
  // connection at runtime, which is what carries the SET ... NX EX overload.
  const client = (await queue.client) as unknown as Redis;

  const claimed = await client.set(
    `${DEDUPE_KEY_PREFIX}${idempotencyKey}`,
    "1",
    "EX",
    ttlSeconds,
    "NX",
  );

  if (claimed === null) {
    return { jobId: idempotencyKey, replayed: true };
  }

  const job = await queue.add("webhook", data, {
    jobId: idempotencyKey,
    removeOnComplete: { age: ttlSeconds },
    removeOnFail: { age: ttlSeconds },
    // Carry the retry schedule so a failing handler retries on the backoff and
    // dead-letters after MAX_ATTEMPTS, instead of failing exactly once.
    ...RETRY_JOB_OPTIONS,
  });

  return { jobId: job.id ?? idempotencyKey, replayed: false };
}
