import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";

export const BACKOFF_MS: readonly number[] = [1000, 5000, 30000, 300000];
export const MAX_ATTEMPTS = BACKOFF_MS.length;
export const DEAD_QUEUE_NAME = "webhooks.dead";

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

function backoffStrategy(attemptsMade: number): number {
  const idx = attemptsMade - 1;
  if (idx < 0 || idx >= BACKOFF_MS.length) return 0;
  return BACKOFF_MS[idx]!;
}

/**
 * Build a worker that runs `handler`, retries on the backoff schedule, and
 * dead-letters to webhooks.dead after MAX_ATTEMPTS. The dead queue is written
 * to but never consumed here; replay is a separate process.
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
          await deadQueue.add(
            job.name,
            {
              ...job.data,
              failureContext: {
                attempts: job.attemptsMade,
                lastError: err?.message ?? String(err),
              },
            },
            { jobId: job.id },
          );
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
