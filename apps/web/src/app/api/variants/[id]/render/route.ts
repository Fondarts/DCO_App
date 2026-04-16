import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getRenderQueue, isQueueAvailable } from "@/lib/queue";
import { renderVideo } from "@/lib/aerender";
import { parseManifest, parseFieldValues } from "@/lib/json";
import type { RenderJobPayload } from "@dco/shared";

async function runLocalRender(
  renderJobId: string,
  templateFilePath: string,
  manifest: ReturnType<typeof parseManifest>,
  fieldValues: Record<string, unknown>,
  outputVariantId: string | undefined,
  orgId: string
) {
  try {
    await prisma.renderJob.update({
      where: { id: renderJobId },
      data: { status: "RENDERING", startedAt: new Date() },
    });

    const outputPath = await renderVideo(
      { templateFilePath, manifest, fieldValues, outputVariantId, orgId },
      renderJobId
    );

    await prisma.renderJob.update({
      where: { id: renderJobId },
      data: { status: "COMPLETED", outputPath, completedAt: new Date() },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[local-render] Failed:", msg);
    await prisma.renderJob.update({
      where: { id: renderJobId },
      data: { status: "FAILED", errorMessage: msg },
    }).catch(() => {});
  }
}

export async function POST(
  _req: NextRequest,
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

  // Create render job record
  const renderJob = await prisma.renderJob.create({
    data: {
      variantId: variant.id,
      submittedById: session.user.id,
      status: "PENDING",
    },
  });

  // Build job payload
  const manifest = parseManifest(variant.template.manifest);
  const fieldValues = parseFieldValues(variant.fieldValues);
  const payload: RenderJobPayload = {
    jobId: renderJob.id,
    variantId: variant.id,
    templateId: variant.template.id,
    templateFilePath: variant.template.templateFilePath,
    manifest,
    fieldValues,
    outputVariantId: variant.outputVariantId ?? undefined,
  };

  // Try queue if Redis is available and compatible (>= 6.2)
  let queued = false;
  if (await isQueueAvailable()) {
    try {
      await getRenderQueue().add("render-variant", payload, {
        jobId: renderJob.id,
      });
      await prisma.renderJob.update({
        where: { id: renderJob.id },
        data: { status: "QUEUED" },
      });
      queued = true;
    } catch {
      // Redis error — will fallback to local
    }
  }

  // Fallback: run render locally in background
  if (!queued) {
    console.log("[render] Queue unavailable — running local render for job", renderJob.id);
    // Fire-and-forget: respond immediately, render runs in background
    runLocalRender(
      renderJob.id,
      variant.template.templateFilePath,
      manifest,
      fieldValues,
      variant.outputVariantId ?? undefined,
      session.user.organizationId
    );
  }

  return NextResponse.json(renderJob, { status: 201 });
}
