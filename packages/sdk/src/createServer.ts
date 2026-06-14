import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { Queue } from "bullmq";
import IORedis from "ioredis";

export interface ServerOptions {
  secret: string;
  redisUrl?: string;
  queueName?: string;
  signatureHeader?: string;
}

function verify(body: Buffer, signatureHeader: string, secret: string): boolean {
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) {
    return false;
  }
  const provided = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]+$/i.test(provided)) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function idempotencyKey(signatureHeader: string, raw: Buffer): string {
  return createHash("sha256").update(signatureHeader, "utf8").update(raw).digest("hex");
}

/**
 * Build the Anvil webhook ingress app. Verifies the HMAC over the raw body,
 * dedupes by sha256(signature + payload), enqueues to BullMQ, returns 202.
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

      const key = idempotencyKey(sig, raw);
      const existing = await queue.getJob(key);
      if (existing) {
        res.status(202).json({ jobId: existing.id, replayed: true });
        return;
      }
      const job = await queue.add(
        "webhook",
        { body: raw.toString("utf8"), sig },
        { jobId: key, removeOnComplete: false, removeOnFail: false },
      );
      res.status(202).json({ jobId: job.id, replayed: false });
    },
  );

  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));

  return app;
}
