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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { variantIds } = body as { variantIds: string[] };

  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return NextResponse.json(
      { error: "variantIds array is required" },
      { status: 400 }
    );
  }

  const variants = await prisma.variant.findMany({
    where: {
      id: { in: variantIds },
      template: { organizationId: session.user.organizationId },
    },
    include: { template: true },
  });

  if (variants.length === 0) {
    return NextResponse.json({ error: "No variants found" }, { status: 404 });
  }

  const queueOk = await isQueueAvailable();
  const results: Array<{ variantId: string; jobId: string; status: string }> = [];
  const errors: Array<{ variantId: string; message: string }> = [];

  for (const variant of variants) {
    try {
      const renderJob = await prisma.renderJob.create({
        data: {
          variantId: variant.id,
          submittedById: session.user.id,
          status: "PENDING",
        },
      });

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

      let queued = false;
      if (queueOk) {
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
          // fall through to local
        }
      }

      if (!queued) {
        runLocalRender(
          renderJob.id,
          variant.template.templateFilePath,
          manifest,
          fieldValues,
          variant.outputVariantId ?? undefined,
          session.user.organizationId
        );
      }

      results.push({ variantId: variant.id, jobId: renderJob.id, status: queued ? "QUEUED" : "RENDERING" });
    } catch (err) {
      errors.push({ variantId: variant.id, message: (err as Error).message });
    }
  }

  return NextResponse.json({ results, errors }, { status: 200 });
}
