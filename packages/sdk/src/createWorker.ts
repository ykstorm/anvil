import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { backoffStrategy, MAX_ATTEMPTS } from "./internal/retry.js";
import { DEAD_QUEUE_NAME, makeDeadLetterHandler } from "./internal/deadLetter.js";

export interface WebhookJobData {
  body: string;
  sig: string;
}

export type WebhookHandler = (data: WebhookJobData, job: Job) => Promise<void>;

export interface WorkerOptions {
  redisUrl?: string;
  queueName?: string;
  concurrency?: number;
}

export interface RunningWorker {
  start: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * Build a worker that runs `handler`, retries on the backoff schedule, and
 * dead-letters to webhooks.dead after MAX_ATTEMPTS. The dead queue is written
 * to but never consumed here; replay is a separate process.
 *
 * The backoff schedule and dead-letter handler are imported from ./internal —
 * the single source of truth shared with apps/worker.
 */
export function createWorker(
  handler: WebhookHandler,
  opts: WorkerOptions = {},
): RunningWorker {
  const {
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    queueName = "webhooks",
    concurrency = 4,
  } = opts;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const deadQueue = new Queue(DEAD_QUEUE_NAME, { connection });
  const onDead = makeDeadLetterHandler(deadQueue);

  let worker: Worker | null = null;

  return {
    start: async () => {
      worker = new Worker(queueName, async (job: Job) => handler(job.data, job), {
        connection,
        concurrency,
        settings: { backoffStrategy },
      });
      worker.on("failed", async (job, err) => {
        if (job && job.attemptsMade >= MAX_ATTEMPTS) {
          await onDead(job, err);
        }
      });
    },
    close: async () => {
      if (worker) await worker.close();
      await deadQueue.close();
      await connection.quit();
    },
  };
}
