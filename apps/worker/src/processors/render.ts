import { Job } from "bullmq";
import type { RenderJobPayload } from "@dco/shared";
import { RenderEngine } from "../lib/render-engine";

const API_URL = process.env.API_URL || "http://localhost:3000";
const API_KEY = process.env.WORKER_API_KEY || "worker-secret";

// Single engine instance per worker process
const engine = new RenderEngine();

// --- Status update helper ---

async function updateJobStatus(
  jobId: string,
  status: string,
  data?: Record<string, unknown>
) {
  try {
    const res = await fetch(`${API_URL}/api/worker/jobs/${jobId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ status, ...data }),
    });
    if (!res.ok) {
      console.error(`[Worker] Status update failed (${res.status}): ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[Worker] Failed to update job ${jobId}:`, err);
  }
}

// --- Main processor ---

export async function processRenderJob(job: Job<RenderJobPayload>) {
  const payload = job.data;
  console.log(`[Worker] Processing job ${payload.jobId}`);
  console.log(`[Worker] Template: ${payload.manifest.name} (${payload.manifest.format})`);
  console.log(`[Worker] File: ${payload.templateFilePath}`);

  try {
    await updateJobStatus(payload.jobId, "RENDERING", {
      startedAt: new Date().toISOString(),
    });
    await job.updateProgress(10);

    const outputPath = await engine.render(
      {
        templateFilePath: payload.templateFilePath,
        manifest: payload.manifest,
        fieldValues: payload.fieldValues,
        outputVariantId: payload.outputVariantId,
        jobId: payload.jobId,
      },
      async (progress) => {
        // Report progress back to BullMQ and web API
        await job.updateProgress(progress.progress);

        if (progress.phase === "ENCODING") {
          await updateJobStatus(payload.jobId, "ENCODING", {
            progress: progress.progress,
          });
        } else if (progress.phase === "RENDERING") {
          await updateJobStatus(payload.jobId, "RENDERING", {
            progress: progress.progress,
          });
        }
      }
    );

    await job.updateProgress(100);
    await updateJobStatus(payload.jobId, "COMPLETED", {
      outputPath,
      completedAt: new Date().toISOString(),
    });

    console.log(`[Worker] Job ${payload.jobId} completed: ${outputPath}`);
    return { success: true, outputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Worker] Job ${payload.jobId} failed:`, errorMessage);

    await updateJobStatus(payload.jobId, "FAILED", {
      errorMessage,
    });

    throw error;
  }
}
