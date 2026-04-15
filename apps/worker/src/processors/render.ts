import { Job } from "bullmq";
import type { RenderJobPayload } from "@dco/shared";

// Database update helper - calls the web API to update job status
async function updateJobStatus(
  jobId: string,
  status: string,
  data?: Record<string, unknown>
) {
  const apiUrl = process.env.API_URL || "http://localhost:3000";
  const apiKey = process.env.WORKER_API_KEY || "worker-secret";

  try {
    await fetch(`${apiUrl}/api/worker/jobs/${jobId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ status, ...data }),
    });
  } catch (err) {
    console.error(`Failed to update job ${jobId} status:`, err);
  }
}

export async function processRenderJob(job: Job<RenderJobPayload>) {
  const payload = job.data;
  console.log(`[Render] Processing job ${payload.jobId}`);
  console.log(`[Render] Template: ${payload.manifest.name}`);
  console.log(`[Render] Template: ${payload.templateFilePath}`);

  try {
    // Update status to RENDERING
    await updateJobStatus(payload.jobId, "RENDERING", {
      startedAt: new Date().toISOString(),
    });
    await job.updateProgress(10);

    // TODO: Integrate nexrender when ready
    // For now, log the job details for testing
    console.log("[Render] Field values:", JSON.stringify(payload.fieldValues, null, 2));
    console.log("[Render] Output variant:", payload.outputVariantId || "default");

    // Simulate render progress
    // In production, this will be replaced by nexrender execution:
    //
    // import { render } from "@nexrender/core";
    // const result = await render(nexrenderJob, {
    //   workpath: "/tmp/nexrender",
    //   binary: "C:/Program Files/Adobe/Adobe After Effects 2024/Support Files/aerender.exe",
    //   skipCleanup: false,
    //   addLicense: false,
    //   onProgress: (job) => {
    //     updateJobStatus(payload.jobId, "RENDERING", { progress: job.renderProgress });
    //   },
    // });

    await job.updateProgress(50);

    // Update status to ENCODING (FFmpeg post-process step)
    await updateJobStatus(payload.jobId, "ENCODING");
    await job.updateProgress(80);

    // TODO: actual output path from nexrender
    const outputPath = `storage/renders/${payload.jobId}.mp4`;

    await job.updateProgress(100);

    // Update status to COMPLETED
    await updateJobStatus(payload.jobId, "COMPLETED", {
      outputPath,
      completedAt: new Date().toISOString(),
    });

    console.log(`[Render] Job ${payload.jobId} completed`);
    return { success: true, outputPath };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Render] Job ${payload.jobId} failed:`, errorMessage);

    await updateJobStatus(payload.jobId, "FAILED", {
      errorMessage,
    });

    throw error;
  }
}
