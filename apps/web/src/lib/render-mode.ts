/**
 * Render mode configuration.
 *
 * RENDER_MODE env var controls how renders are dispatched:
 * - "local"  : Always render in-process (current behavior, no Redis needed)
 * - "queue"  : Always queue to BullMQ (requires Redis + worker running)
 * - "auto"   : Try queue first, fall back to local if Redis unavailable (default)
 */

import { getRenderQueue } from "./queue";
import type { RenderJobPayload } from "@dco/shared";
import { renderVideo, renderPreview, type RenderOptions } from "./aerender";
import { prisma } from "./db";

export type RenderMode = "local" | "queue" | "auto";

function getMode(): RenderMode {
  const mode = process.env.RENDER_MODE || "auto";
  if (mode === "local" || mode === "queue" || mode === "auto") return mode;
  return "auto";
}

/**
 * Try to enqueue a render job to BullMQ.
 * Returns true if successfully queued, false if Redis unavailable.
 */
async function tryEnqueue(jobId: string, payload: RenderJobPayload): Promise<boolean> {
  try {
    const queue = getRenderQueue();
    await queue.add("render-variant", payload, { jobId });
    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "QUEUED" },
    });
    return true;
  } catch {
    console.warn("[render-mode] Redis/queue unavailable, cannot enqueue");
    return false;
  }
}

export interface DispatchResult {
  mode: "queued" | "local";
  jobId: string;
  /** Only set if mode === "local" (synchronous render completed) */
  outputPath?: string;
}

/**
 * Dispatch a render job. Based on RENDER_MODE:
 * - queue: enqueue and return immediately
 * - local: render in-process and wait
 * - auto: try queue, fall back to local
 */
export async function dispatchRender(
  jobId: string,
  payload: RenderJobPayload,
  renderOptions: RenderOptions
): Promise<DispatchResult> {
  const mode = getMode();

  if (mode === "queue") {
    const queued = await tryEnqueue(jobId, payload);
    if (!queued) throw new Error("Redis unavailable and RENDER_MODE=queue");
    return { mode: "queued", jobId };
  }

  if (mode === "local") {
    return runLocal(jobId, renderOptions);
  }

  // auto: try queue first
  const queued = await tryEnqueue(jobId, payload);
  if (queued) return { mode: "queued", jobId };

  // Fall back to local
  return runLocal(jobId, renderOptions);
}

/**
 * Dispatch a preview render.
 */
export async function dispatchPreview(
  jobId: string | null,
  payload: RenderJobPayload | null,
  renderOptions: RenderOptions,
  variantId: string
): Promise<DispatchResult & { previewPath?: string }> {
  const mode = getMode();

  // Previews always run locally for now (fast feedback)
  // In Phase 3, previews will also be queued
  return runLocalPreview(renderOptions, variantId);
}

async function runLocal(jobId: string, options: RenderOptions): Promise<DispatchResult> {
  await prisma.renderJob.update({
    where: { id: jobId },
    data: { status: "RENDERING", startedAt: new Date() },
  });

  try {
    const outputPath = await renderVideo(options, jobId);

    await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        progress: 100,
        outputPath,
        completedAt: new Date(),
      },
    });

    return { mode: "local", jobId, outputPath };
  } catch (err) {
    await prisma.renderJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: err instanceof Error ? err.message : "Render failed",
      },
    });
    throw err;
  }
}

async function runLocalPreview(
  options: RenderOptions,
  variantId: string
): Promise<DispatchResult & { previewPath?: string }> {
  const previewPath = await renderPreview(options, variantId);
  return { mode: "local", jobId: "", previewPath };
}
