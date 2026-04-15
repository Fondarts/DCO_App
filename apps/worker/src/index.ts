import { Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "crypto";
import { hostname } from "os";
import { processRenderJob } from "./processors/render";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const API_URL = process.env.API_URL || "http://localhost:3000";
const API_KEY = process.env.WORKER_API_KEY || "worker-secret";
const WORKER_ID = process.env.WORKER_ID || `worker-${randomUUID().slice(0, 8)}`;

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

console.log("[DCO Worker] Starting render worker...");
console.log(`[DCO Worker] ID: ${WORKER_ID}`);
console.log(`[DCO Worker] Connecting to Redis: ${REDIS_URL}`);
console.log(`[DCO Worker] API: ${API_URL}`);

let currentJobId: string | null = null;

const worker = new Worker("render", async (job) => {
  currentJobId = job.id || null;
  try {
    return await processRenderJob(job);
  } finally {
    currentJobId = null;
  }
}, {
  connection,
  concurrency: 1,
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

// --- Heartbeat ---
async function sendHeartbeat() {
  try {
    await fetch(`${API_URL}/api/worker/heartbeat`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        workerId: WORKER_ID,
        hostname: hostname(),
        status: currentJobId ? "rendering" : "idle",
        currentJobId,
      }),
    });
  } catch {
    // Silently fail — web server might be unreachable temporarily
  }
}

const heartbeatInterval = setInterval(sendHeartbeat, 30_000);
sendHeartbeat(); // Initial heartbeat

// --- Graceful shutdown ---
async function shutdown() {
  console.log("[DCO Worker] Shutting down...");
  clearInterval(heartbeatInterval);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log("[DCO Worker] Ready. Waiting for jobs...");
