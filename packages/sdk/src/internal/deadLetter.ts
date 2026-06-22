import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Job } from "bullmq";

export const DEAD_QUEUE_NAME = "webhooks.dead";

export interface FailureContext {
  attempts: number;
  lastError: string;
}

export interface DeadJobData {
  body?: string;
  sig?: string;
  failureContext: FailureContext;
  [key: string]: unknown;
}

/**
 * Build a handler that moves an exhausted job onto the dead-letter queue,
 * stamping it with failureContext. Wire it to a Worker's "failed" event for
 * jobs whose attemptsMade has reached MAX_ATTEMPTS.
 *
 * This module deliberately does NOT construct a BullMQ Worker. Importing it
 * starts no consumer; the dead-letter queue is drained by a separate, manually
 * run process (see replayDeadLetter and docs/DEAD_LETTER.md). That separation
 * is what stops a runaway auto-retry loop on the main queue.
 *
 * Single source of truth, shared by the SDK's createWorker, replayDeadLetter,
 * and apps/worker.
 */
export function makeDeadLetterHandler(deadQueue: Queue) {
  return async function onDead(job: Job, err: Error): Promise<void> {
    const failureContext: FailureContext = {
      attempts: job.attemptsMade,
      lastError: err?.message ?? String(err),
    };
    // Let the dead-letter queue auto-assign the job id. BullMQ rejects a custom
    // jobId that parses as an integer ("Custom Ids cannot be integers"), and the
    // main queue's auto ids are exactly that. Keep the origin id in the data for
    // tracing instead of forcing it as the DLQ job id.
    await deadQueue.add(job.name, { ...job.data, failureContext, originalJobId: job.id });
  };
}

export interface ReplayDeps {
  mainQueue?: Queue;
  deadQueue?: Queue;
  redisUrl?: string;
  mainQueueName?: string;
}

export interface ReplayResult {
  replayed: boolean;
  jobId: string;
}

/**
 * Replay a single dead-lettered job back onto the main queue.
 *
 * Runs as its own consumer (a CLI invocation), separate from the worker. It
 * reads the dead job, re-adds the original payload to the main queue, removes
 * the dead copy, and returns `{ replayed: true }`. Pass live queues for tests,
 * or a redisUrl for the CLI/SDK path.
 *
 * Replaying is a manual, gated action so a broken handler cannot put failures
 * into an endless auto-retry loop. Importing this module starts no worker.
 */
export async function replayDeadLetter(
  jobId: string,
  deps: ReplayDeps = {},
): Promise<ReplayResult> {
  const ownConnection =
    deps.mainQueue || deps.deadQueue
      ? null
      : new IORedis(deps.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379", {
          maxRetriesPerRequest: null,
        });

  const mainName = deps.mainQueueName ?? "webhooks";
  const mainQueue =
    deps.mainQueue ?? new Queue(mainName, { connection: ownConnection! });
  const deadQueue =
    deps.deadQueue ?? new Queue(`${mainName}.dead`, { connection: ownConnection! });

  try {
    const dead = await deadQueue.getJob(jobId);
    if (!dead) {
      return { replayed: false, jobId };
    }

    const { failureContext, ...payload } = dead.data as DeadJobData;
    void failureContext; // dropped on replay; the retry counter resets
    const revived = await mainQueue.add(dead.name, payload);
    await dead.remove();

    return { replayed: true, jobId: revived.id ?? jobId };
  } finally {
    // Only close queues we created here; caller-owned queues stay open.
    if (ownConnection) {
      await mainQueue.close();
      await deadQueue.close();
      await ownConnection.quit();
    }
  }
}
