import { Job } from "bullmq";
import path from "path";
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

  const isPreview = payload.type === "preview";

  try {
    await updateJobStatus(payload.jobId, "RENDERING", {
      startedAt: new Date().toISOString(),
    });
    await job.updateProgress(10);

    const renderRequest = {
      templateFilePath: payload.templateFilePath,
      manifest: payload.manifest,
      fieldValues: payload.fieldValues,
      outputVariantId: payload.outputVariantId,
      jobId: payload.jobId,
    };

    const progressCallback = async (progress: { phase: string; progress: number }) => {
      await job.updateProgress(progress.progress);
      if (progress.phase === "ENCODING") {
        await updateJobStatus(payload.jobId, "ENCODING", { progress: progress.progress });
      } else if (progress.phase === "RENDERING") {
        await updateJobStatus(payload.jobId, "RENDERING", { progress: progress.progress });
      }
    };

    let outputPath: string;

    if (isPreview) {
      // Preview: render + extract frame
      const previewLocalPath = path.join(
        process.env.WORKER_WORKDIR || "./storage/tmp",
        `preview-${payload.variantId}.png`
      );
      outputPath = await engine.renderPreview(renderRequest, previewLocalPath, progressCallback);

      // Upload preview PNG to web server via API
      try {
        const { readFile } = await import("fs/promises");
        const pngData = await readFile(outputPath);
        const base64 = pngData.toString("base64");
        await fetch(`${API_URL}/api/worker/preview/${payload.variantId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({ imageBase64: base64 }),
        });
      } catch (uploadErr) {
        console.warn("[Worker] Preview upload failed:", uploadErr);
      }
    } else {
      // Full render
      outputPath = await engine.render(renderRequest, progressCallback);
      // Upload render to storage if using S3
      if (process.env.STORAGE_PROVIDER === "s3" && payload.orgId) {
        const { StorageKeys } = await import("@dco/shared");
        const renderKey = StorageKeys.render(payload.orgId, payload.jobId);
        await engine.uploadResult(outputPath, renderKey);
      }
    }

    await job.updateProgress(100);
    await updateJobStatus(payload.jobId, "COMPLETED", {
      outputPath,
      completedAt: new Date().toISOString(),
    });

    console.log(`[Worker] Job ${payload.jobId} (${isPreview ? "preview" : "render"}) completed: ${outputPath}`);
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
