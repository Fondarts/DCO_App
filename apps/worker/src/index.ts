import { Worker } from "bullmq";
import IORedis from "ioredis";
import { processRenderJob } from "./processors/render";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

console.log("[DCO Worker] Starting render worker...");
console.log(`[DCO Worker] Connecting to Redis: ${REDIS_URL}`);

const worker = new Worker("render", processRenderJob, {
  connection,
  concurrency: 1, // one render at a time per worker
});

worker.on("completed", (job) => {
  console.log(`[DCO Worker] Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[DCO Worker] Job ${job?.id} failed:`, err.message);
});

worker.on("error", (err) => {
  console.error("[DCO Worker] Worker error:", err);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[DCO Worker] Shutting down...");
  await worker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[DCO Worker] Shutting down...");
  await worker.close();
  process.exit(0);
});

console.log("[DCO Worker] Ready. Waiting for jobs...");
