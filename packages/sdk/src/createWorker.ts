import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { backoffDelay, MAX_ATTEMPTS } from "./internal/retry.js";
import { makeDeadLetterHandler } from "./internal/deadLetter.js";
import { DEFAULT_QUEUE_NAME, deadQueueName, resolveRedisUrl } from "./internal/defaults.js";
import type { WebhookJobData } from "./internal/enqueue.js";

export type { WebhookJobData };

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
 * dead-letters to `<queueName>.dead` (webhooks.dead by default) after
 * MAX_ATTEMPTS. The dead queue is written to but never consumed here; replay
 * is a separate process and reads the same queue name.
 */
export function createWorker(
  handler: WebhookHandler,
  opts: WorkerOptions = {},
): RunningWorker {
  const { queueName = DEFAULT_QUEUE_NAME, concurrency = 4 } = opts;

  const connection = new IORedis(resolveRedisUrl(opts.redisUrl), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 5000,
  });
  const deadQueue = new Queue(deadQueueName(queueName), { connection });
  const onDead = makeDeadLetterHandler(deadQueue);

  let worker: Worker | null = null;

  return {
    start: async () => {
      worker = new Worker(queueName, async (job: Job) => handler(job.data, job), {
        connection,
        concurrency,
        settings: { backoffStrategy: backoffDelay },
      });
      worker.on("failed", async (job, err) => {
        if (job && job.attemptsMade >= MAX_ATTEMPTS) {
          // Dead-lettering must never throw back into the failed handler: a
          // throw here would surface as an unhandled rejection and could crash
          // the worker. Log and move on.
          try {
            await onDead(job, err);
          } catch (deadErr) {
            console.error("dead-letter handling failed", deadErr);
          }
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
