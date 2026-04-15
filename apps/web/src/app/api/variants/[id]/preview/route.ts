import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseManifest, parseFieldValues } from "@/lib/json";
import { renderPreview } from "@/lib/aerender";
import { getPreviewOutputPath } from "@/lib/storage";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import type { RenderJobPayload } from "@dco/shared";

function getRenderMode() {
  return process.env.RENDER_MODE || "auto";
}

async function tryEnqueuePreview(payload: RenderJobPayload): Promise<boolean> {
  try {
    const { getRenderQueue } = await import("@/lib/queue");
    const queue = getRenderQueue();
    await queue.add("preview", payload, {
      jobId: payload.jobId,
      priority: 1, // Higher priority than regular renders
    });
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: variantId } = await params;

  const variant = await prisma.variant.findFirst({
    where: {
      id: variantId,
      template: { organizationId: session.user.organizationId },
    },
    include: { template: true },
  });

  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  let fieldValues = parseFieldValues(variant.fieldValues);
  try {
    const body = await req.json();
    if (body.fieldValues) {
      fieldValues = { ...fieldValues, ...body.fieldValues };
    }
  } catch {
    // No body — use saved values
  }

  const manifest = parseManifest(variant.template.manifest);
  const mode = getRenderMode();

  // Try async dispatch when mode is "queue" or "auto"
  if (mode === "queue" || mode === "auto") {
    const previewJob = await prisma.renderJob.create({
      data: {
        variantId: variant.id,
        submittedById: session.user.id,
        status: "PENDING",
      },
    });

    const payload: RenderJobPayload = {
      jobId: previewJob.id,
      variantId: variant.id,
      templateId: variant.template.id,
      templateFilePath: variant.template.templateFilePath,
      manifest,
      fieldValues,
      outputVariantId: variant.outputVariantId ?? undefined,
      type: "preview",
      orgId: session.user.organizationId,
    };

    const queued = await tryEnqueuePreview(payload);

    if (queued) {
      await prisma.renderJob.update({
        where: { id: previewJob.id },
        data: { status: "QUEUED" },
      });
      return NextResponse.json(
        { jobId: previewJob.id, status: "QUEUED" },
        { status: 202 }
      );
    }

    // Clean up if we can't queue and mode is "queue"
    await prisma.renderJob.delete({ where: { id: previewJob.id } }).catch(() => {});
    if (mode === "queue") {
      return NextResponse.json({ error: "Queue unavailable" }, { status: 503 });
    }
    // Fall through to local render for "auto"
  }

  // Local render (sync)
  try {
    const previewPath = await renderPreview(
      {
        templateFilePath: variant.template.templateFilePath,
        manifest,
        fieldValues,
        outputVariantId: variant.outputVariantId ?? undefined,
        orgId: session.user.organizationId,
      },
      variantId
    );

    const pngBuffer = await readFile(previewPath);

    return new NextResponse(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Preview failed";
    console.error("[Preview Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: variantId } = await params;
  const cachePath = getPreviewOutputPath(session.user.organizationId, variantId);

  if (!existsSync(cachePath)) {
    return NextResponse.json({ error: "No preview available" }, { status: 404 });
  }

  const pngBuffer = await readFile(cachePath);
  return new NextResponse(pngBuffer, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-cache",
    },
  });
}
