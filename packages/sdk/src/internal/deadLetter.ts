import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Job } from "bullmq";
import { RETRY_JOB_OPTIONS } from "./retry.js";

export const DEAD_QUEUE_NAME = "webhooks.dead";

/** Cap on a stored error message, so one huge error cannot bloat Redis. */
const MAX_ERROR_LENGTH = 2048;

/** Strip query-string secrets out of an error before it is persisted. */
const SECRET_QS = /([?&](?:key|token|secret|sig)=)[^&\s]+/gi;

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
 * Redact credential-looking query params and truncate, so a dead-letter record
 * never persists a secret an upstream error happened to echo back in a URL.
 */
export function sanitizeErrorMessage(message: string): string {
  return message.replace(SECRET_QS, "$1REDACTED").slice(0, MAX_ERROR_LENGTH);
}

/**
 * Build a handler that moves an exhausted job onto the dead-letter queue,
 * stamping it with a sanitized failureContext, then removes the main-queue
 * copy. Wire it to a Worker's "failed" event for jobs that have reached
 * MAX_ATTEMPTS.
 *
 * This module never constructs a BullMQ Worker: importing it starts no
 * consumer. The dead-letter queue is drained by a separate, manually run
 * process (see replayDeadLetter), which is what stops a runaway retry loop.
 */
export function makeDeadLetterHandler(deadQueue: Queue) {
  return async function onDead(job: Job, err: Error): Promise<void> {
    const failureContext: FailureContext = {
      attempts: job.attemptsMade,
      lastError: sanitizeErrorMessage(err?.message ?? String(err)),
    };
    // Let the dead queue auto-assign the id: BullMQ rejects a custom jobId that
    // parses as an integer, and the main queue's auto ids are exactly that.
    // Keep the origin id in the data for tracing instead.
    await deadQueue.add(job.name, { ...job.data, failureContext, originalJobId: job.id });
    // Drop the main-queue copy now that it is safely on the dead queue.
    await job.remove();
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

interface OpenedQueues {
  mainQueue: Queue;
  deadQueue: Queue;
  ownConnection: IORedis | null;
}

/**
 * Resolve the main and dead queues for a replay. Caller-supplied queues are
 * used as-is; otherwise a connection is opened here and returned so the caller
 * can close exactly what it created.
 */
function openReplayQueues(deps: ReplayDeps): OpenedQueues {
  if (deps.mainQueue || deps.deadQueue) {
    const mainName = deps.mainQueueName ?? "webhooks";
    return {
      mainQueue: deps.mainQueue ?? new Queue(mainName, { connection: new IORedis() }),
      deadQueue: deps.deadQueue ?? new Queue(`${mainName}.dead`, { connection: new IORedis() }),
      ownConnection: null,
    };
  }

  const ownConnection = new IORedis(
    deps.redisUrl ?? process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: null },
  );
  const mainName = deps.mainQueueName ?? "webhooks";
  return {
    mainQueue: new Queue(mainName, { connection: ownConnection }),
    deadQueue: new Queue(`${mainName}.dead`, { connection: ownConnection }),
    ownConnection,
  };
}

/**
 * Replay a single dead-lettered job back onto the main queue.
 *
 * Runs as its own consumer (a CLI invocation), separate from the worker: it
 * reads the dead job, re-adds the original payload with the full retry schedule,
 * removes the dead copy, and returns { replayed: true }. Replaying is a manual,
 * gated action so a broken handler cannot drive an endless auto-retry loop.
 */
export async function replayDeadLetter(
  jobId: string,
  deps: ReplayDeps = {},
): Promise<ReplayResult> {
  const { mainQueue, deadQueue, ownConnection } = openReplayQueues(deps);

  try {
    const dead = await deadQueue.getJob(jobId);
    if (!dead) {
      return { replayed: false, jobId };
    }

    // Drop both the failure context and the origin id: the replayed job is a
    // clean attempt with a reset retry counter, not a continuation of the old
    // one, and it must follow the full [1s,5s,30s,5m] schedule again.
    const { failureContext, originalJobId, ...payload } = dead.data as DeadJobData;
    void failureContext;
    void originalJobId;
    const revived = await mainQueue.add(dead.name, payload, { ...RETRY_JOB_OPTIONS });
    await dead.remove();

    return { replayed: true, jobId: revived.id ?? jobId };
  } finally {
    if (ownConnection) {
      await mainQueue.close();
      await deadQueue.close();
      await ownConnection.quit();
    }
  }
}
