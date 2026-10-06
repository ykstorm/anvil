import { randomUUID } from "node:crypto";
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

/**
 * Deletes the dedupe key only while it still holds the token this claim wrote,
 * so giving a claim back can never remove a claim another delivery made after
 * ours expired.
 */
const RELEASE_CLAIM_LUA =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0';

export interface EnqueueOptions {
  dedupeTtlSeconds?: number;
}

/**
 * Enqueue a webhook job keyed by its idempotency key, deduped atomically.
 *
 * The dedupe decision is a single `SET anvil:dedupe:<key> <token> NX EX <ttl>`
 * on the queue's own Redis connection. The first delivery of a key claims it
 * and enqueues the job under that key as the jobId; every later delivery finds
 * the key already set and returns replayed without touching the queue. Two
 * concurrent deliveries cannot both pass, because only one SET NX succeeds.
 *
 * The claim and the add are two round trips. If the add fails, the claim is
 * given back before the error is rethrown, so the provider's retry (the caller
 * answers 503) can enqueue instead of being told replayed with nothing queued.
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
  const dedupeKey = `${DEDUPE_KEY_PREFIX}${idempotencyKey}`;
  const token = randomUUID();

  const claimed = await client.set(dedupeKey, token, "EX", ttlSeconds, "NX");

  if (claimed === null) {
    return { jobId: idempotencyKey, replayed: true };
  }

  try {
    const job = await queue.add("webhook", data, {
      jobId: idempotencyKey,
      removeOnComplete: { age: ttlSeconds },
      removeOnFail: { age: ttlSeconds },
      // Carry the retry schedule so a failing handler retries on the backoff and
      // dead-letters after MAX_ATTEMPTS, instead of failing exactly once.
      ...RETRY_JOB_OPTIONS,
    });
    return { jobId: job.id ?? idempotencyKey, replayed: false };
  } catch (err) {
    // If the add did reach Redis before the error (a lost reply, say), the
    // retry's add reuses the same jobId and BullMQ keeps the one job.
    await releaseClaim(client, dedupeKey, token);
    throw err;
  }
}

async function releaseClaim(client: Redis, dedupeKey: string, token: string): Promise<void> {
  try {
    await client.eval(RELEASE_CLAIM_LUA, 1, dedupeKey, token);
  } catch (releaseErr) {
    // Redis is failing as well. Surface the add error to the caller; this key
    // now suppresses the delivery until its TTL runs out, so say so.
    console.error(`anvil: could not release dedupe claim ${dedupeKey}`, releaseErr);
  }
}
