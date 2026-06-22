import express, { type Express, type Request, type Response } from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { verify } from "./internal/verify.js";
import { computeIdempotencyKey } from "./internal/idempotency.js";
import { enqueueWebhook } from "./internal/enqueue.js";

export interface ServerOptions {
  secret: string;
  redisUrl?: string;
  queueName?: string;
  signatureHeader?: string;
}

/**
 * Build the Anvil webhook ingress app. Verifies the HMAC over the raw body,
 * dedupes by sha256(signature + payload), enqueues to BullMQ, returns 202.
 *
 * The crypto (constant-time verify), idempotency key, and enqueue de-dupe are
 * imported from ./internal — the single source of truth shared with apps/server.
 */
export function createServer(opts: ServerOptions): Express {
  const {
    secret,
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    queueName = "webhooks",
    signatureHeader = "x-signature",
  } = opts;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  const queue = new Queue(queueName, { connection });

  const app = express();

  app.post(
    "/webhooks",
    express.raw({ type: "*/*" }),
    async (req: Request, res: Response) => {
      const sig = req.header(signatureHeader) ?? "";
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");

      if (!verify(raw, sig, secret)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }

      const key = computeIdempotencyKey(sig, raw);
      const result = await enqueueWebhook(queue, key, {
        body: raw.toString("utf8"),
        sig,
      });

      res.status(202).json(result);
    },
  );

  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return app;
}
